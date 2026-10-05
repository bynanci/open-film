"""Official OTIO parser and real-source gate. This does not launch DaVinci Resolve."""
import hashlib
import json
import math
import pathlib
import subprocess
import sys
import urllib.parse
import xml.etree.ElementTree as ET
from fractions import Fraction

import opentimelineio as otio

root = pathlib.Path(sys.argv[1])
manifest = json.loads((root / "manifest.json").read_text())
assets = {asset["id"]: asset for asset in manifest["assets"]}


def close(actual, expected, context):
    assert math.isfinite(actual) and abs(actual - expected) < 1e-7, (context, actual, expected)


def local_source(uri):
    parsed = urllib.parse.urlparse(uri)
    assert parsed.scheme == "file" and parsed.netloc in ("", "localhost"), f"nonlocal source: {uri}"
    path = pathlib.Path(urllib.parse.unquote(parsed.path))
    assert path.is_file(), f"missing source: {uri}"
    assert not path.is_symlink(), f"symlink source: {uri}"
    return path


# Source existence and content are independent of parser acceptance.
probed = {}
for asset in assets.values():
    path = local_source(asset["uri"])
    assert hashlib.sha256(path.read_bytes()).hexdigest() == asset["contentHash"], f"source hash changed: {path}"
    probe = json.loads(subprocess.run(["ffprobe", "-v", "error", "-show_format", "-show_streams", "-of", "json", str(path)], check=True, capture_output=True, text=True).stdout)
    assert probe.get("streams"), f"undecodable source: {path}"
    if asset["mediaType"] != "image":
        duration = float(probe["format"]["duration"])
        close(duration, asset["duration"], "actual source duration")
        probed[asset["id"]] = duration


def check_timeline(timeline, original, report, settings):
    assert isinstance(timeline, otio.schema.Timeline)
    close(timeline.duration().to_seconds(), original["duration"], "timeline duration")
    assert len(timeline.tracks) == len(original["tracks"])
    serialized = json.loads(otio.adapters.write_to_string(timeline, "otio_json"))
    metadata = serialized["metadata"]["openfilm"]
    assert metadata["composition"] == original, "full original edits were changed"
    assert metadata["compatibility"] == report
    assert metadata["settings"] == settings
    close(timeline.global_start_time.rate, settings["frameRate"], "project rational rate")
    assert report["realNleVerified"] is False
    assert report["advancedEdits"] == "metadata-only"
    assert not timeline.tracks.effects
    for track, expected in zip(timeline.tracks, original["tracks"]):
        assert isinstance(track, otio.schema.Track)
        assert track.kind == ("Audio" if expected["type"] in ("audio", "music") else "Video")
        assert track.metadata["openfilm"]["trackType"] == expected["type"]
        close(track.duration().to_seconds(), original["duration"], "track gaps/duration")
        expected_clips = {clip["id"]: clip for clip in expected["clips"]}
        seen = set()
        for child in track:
            assert isinstance(child, (otio.schema.Clip, otio.schema.Gap))
            assert not child.effects, "metadata-only effects must not masquerade as native effects"
            if isinstance(child, otio.schema.Gap):
                assert child.duration().to_seconds() > 0
                continue
            data = child.metadata["openfilm"]
            original_clip = expected_clips[data["clipId"]]
            seen.add(data["clipId"])
            plain_clip = json.loads(otio.adapters.write_to_string(child, "otio_json"))
            assert plain_clip["metadata"]["openfilm"]["clip"] == original_clip
            asset = assets[original_clip["assetId"]]
            assert isinstance(child.media_reference, otio.schema.ExternalReference)
            assert child.media_reference.target_url == asset["uri"]
            local_source(child.media_reference.target_url)
            source_in = original_clip.get("sourceIn", 0)
            speed = original_clip.get("transform", {}).get("speed", 1)
            source_out = original_clip.get("sourceOut", source_in + original_clip["timelineDuration"] * speed)
            native_duration = original_clip["timelineDuration"] if asset["mediaType"] == "image" else min(original_clip["timelineDuration"], source_out - source_in)
            close(track.range_of_child(child).start_time.to_seconds(), original_clip["timelineStart"], "record start")
            close(child.source_range.start_time.to_seconds(), source_in, "source in")
            close(child.source_range.start_time.rate, settings["frameRate"], "source rational rate")
            close(child.source_range.duration.rate, settings["frameRate"], "duration rational rate")
            close(child.duration().to_seconds(), native_duration, "native cut duration")
            if asset["mediaType"] != "image":
                assert source_in + native_duration <= probed[asset["id"]] + 1e-7, "native cut invented source frames"
                assert source_out <= probed[asset["id"]] + 1e-7, "metadata trim exceeds real source"
                close(child.media_reference.available_range.duration.to_seconds(), probed[asset["id"]], "actual available range")
            padding = original_clip["timelineDuration"] - native_duration
            if padding > 1e-7:
                pad = track[track.index(child) + 1]
                assert isinstance(pad, otio.schema.Gap)
                assert pad.name == f"Retime padding for {original_clip['id']}"
                assert pad.metadata["openfilm"]["reason"] == "metadata-only-speed-padding"
                close(pad.duration().to_seconds(), padding, "retime padding")
                close(track.range_of_child(pad).start_time.to_seconds(), original_clip["timelineStart"] + native_duration, "retime padding start")
        assert seen == set(expected_clips), "clips were lost or duplicated"


for name, original in manifest["compositions"].items():
    path = root / f"{name}.otio"
    report = json.loads((root / f"{name}.otio.report.json").read_text())
    settings = manifest["settingsByComposition"][name]
    timeline = otio.adapters.read_from_file(str(path))
    check_timeline(timeline, original, report, settings)
    roundtrip_path = root / f"{name}.roundtrip.otio"
    otio.adapters.write_to_file(timeline, str(roundtrip_path))
    restored = otio.adapters.read_from_file(str(roundtrip_path))
    check_timeline(restored, original, report, settings)

# Keep the existing FCPXML parser/resource check; no downstream NLE claim.
xml = ET.parse(root / "cuts.fcpxml").getroot()
assert xml.tag == "fcpxml" and xml.attrib["version"] == "1.10"
resources = {element.attrib["id"]: element for element in xml.find("resources")}
sequence = xml.find("./library/event/project/sequence")
assert Fraction(sequence.attrib["duration"][:-1]) == manifest["compositions"]["cuts"]["duration"]
xml_clips = sequence.findall(".//asset-clip")
expected = [clip for track in manifest["compositions"]["cuts"]["tracks"] for clip in sorted(track["clips"], key=lambda item: item["timelineStart"])]
assert len(xml_clips) == len(expected)
for clip, original_clip in zip(xml_clips, expected):
    asset = assets[original_clip["assetId"]]
    assert resources[clip.attrib["ref"]].find("media-rep").attrib["src"] == asset["uri"]
    close(float(Fraction(clip.attrib["start"][:-1])), original_clip.get("sourceIn", 0), "FCPXML source in")
    close(float(Fraction(clip.attrib["duration"][:-1])), original_clip["timelineDuration"], "FCPXML duration")
    close(float(Fraction(clip.attrib["offset"][:-1])), original_clip["timelineStart"], "FCPXML offset")

print(json.dumps({"officialParser": f"OpenTimelineIO {otio.__version__}", "readWriteRead": "passed", "realSourceFiles": len(assets), "sourceHashesAndBounds": "passed", "cutStillAudioGapMultiTrack": "passed", "advancedEdits": "metadata-only; manual recreation required", "realResolveImport": "not verified"}))
