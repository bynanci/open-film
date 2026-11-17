"""Official OTIO, source, and decoded A/V sync gate; no DaVinci Resolve process."""
import array
import hashlib
import json
import math
import pathlib
import subprocess
import sys
import urllib.parse
from urllib.request import url2pathname
import xml.etree.ElementTree as ET
from fractions import Fraction

import opentimelineio as otio

root = pathlib.Path(sys.argv[1])
manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
assets = {asset["id"]: asset for asset in manifest["assets"]}

# Independent literal expectations: do not derive these offsets from the
# Composition, generated manifest, renderer output, or a measured-delay baseline.
SYNC_CASES = {
    "sync-30": {
        "rateNumerator": 30, "rateDenominator": 1,
        "sourceVideoAssetId": "sync-30-video", "sourceAudioAssetId": "sync-30-audio",
        "sourceMarkerFrame": 30, "sourceMarkerSample": 48000,
        "trimInFrame": 12, "placementFrame": 24,
        "recordMarkerFrame": 42, "recordMarkerSample": 67200,
        "sourceFrameCount": 120, "durationFrames": 120, "clipFrames": 90,
        "markerSamples": 2400, "sampleRate": 48000,
        "renderedVideo": "sync-30.mp4", "fullMix": "sync-30.wav",
        "aacUncertaintySamples": 1024,
    },
    "sync-fractional": {
        "rateNumerator": 30000, "rateDenominator": 1001,
        "sourceVideoAssetId": "sync-fractional-video", "sourceAudioAssetId": "sync-fractional-audio",
        "sourceMarkerFrame": 30, "sourceMarkerSample": 48048,
        "trimInFrame": 10, "placementFrame": 15,
        "recordMarkerFrame": 35, "recordMarkerSample": 56056,
        "sourceFrameCount": 120, "durationFrames": 120, "clipFrames": 90,
        "markerSamples": 2400, "sampleRate": 48000,
        "renderedVideo": "sync-fractional.mp4", "fullMix": "sync-fractional.wav",
        "aacUncertaintySamples": 1024,
    },
}
assert manifest["syncCases"] == SYNC_CASES, "sync fixture contract changed"


def close(actual, expected, context):
    assert math.isfinite(actual) and abs(actual - expected) < 1e-7, (context, actual, expected)


def local_source(uri):
    parsed = urllib.parse.urlparse(uri)
    assert parsed.scheme == "file" and parsed.netloc in ("", "localhost"), f"nonlocal source: {uri}"
    path = pathlib.Path(url2pathname(parsed.path))
    assert path.is_file(), f"missing source: {uri}"
    assert not path.is_symlink(), f"symlink source: {uri}"
    return path


# Source existence and content are independent of parser acceptance.
probed = {}
for asset in assets.values():
    path = local_source(asset["uri"])
    assert hashlib.sha256(path.read_bytes()).hexdigest() == asset["contentHash"], f"source hash changed: {path}"
    probe = json.loads(subprocess.run(["ffprobe", "-v", "error", "-show_format", "-show_streams", "-of", "json", str(path)], check=True, capture_output=True, text=True, encoding="utf-8").stdout)
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
        if "timing" in expected:
            assert track.metadata["openfilm"]["timing"] == expected["timing"]
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
            secondary_id = original_clip.get("layout", {}).get("secondary", {}).get("assetId")
            if secondary_id:
                secondary = assets[secondary_id]
                references = plain_clip["metadata"]["openfilm"]["secondaryMediaReferences"]
                assert len(references) == 1
                assert references[0]["assetId"] == secondary_id
                assert references[0]["target_url"] == secondary["uri"]
                assert references[0]["contentHash"] == secondary["contentHash"]
                assert references[0]["mediaType"] == "image"
                local_source(references[0]["target_url"])
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


def check_sync_timeline(name, timeline):
    reference = SYNC_CASES.get(name)
    if reference is None:
        return
    rate = Fraction(reference["rateNumerator"], reference["rateDenominator"])
    assert len(timeline.tracks) == 2
    close(timeline.global_start_time.rate, float(rate), "sync project rate")
    close(timeline.duration().rescaled_to(float(rate)).value, 120, "sync duration frames")
    for track, asset_id in zip(timeline.tracks, (reference["sourceVideoAssetId"], reference["sourceAudioAssetId"])):
        clips = [child for child in track if isinstance(child, otio.schema.Clip)]
        assert len(clips) == 1
        clip = clips[0]
        assert clip.media_reference.target_url == assets[asset_id]["uri"]
        close(clip.source_range.start_time.value, reference["trimInFrame"], "literal sync trim frame")
        close(clip.source_range.duration.value, 90, "literal sync clip frames")
        record_start = track.range_of_child(clip).start_time.rescaled_to(float(rate)).value
        close(record_start, reference["placementFrame"], "literal sync record frame")
        marker = record_start + 30 - clip.source_range.start_time.value
        close(marker, reference["recordMarkerFrame"], "literal sync marker frame")
        close(float(Fraction(reference["recordMarkerFrame"], 1) / rate * 48000), reference["recordMarkerSample"], "literal rational sync marker sample")
        if asset_id == reference["sourceAudioAssetId"]:
            source_in, source_out, record_in = (19200, 163200, 38400) if name == "sync-30" else (16016, 160160, 24024)
            data = json.loads(otio.adapters.write_to_string(clip, "otio_json"))["metadata"]["openfilm"]["clip"]
            assert data["audioTiming"] == {
                "version": 1, "sampleRate": 48000,
                "sourceInSample": source_in, "sourceOutSample": source_out,
                "timelineStartSample": record_in,
            }, (name, "literal canonical sound handles and record offset", data["audioTiming"])


for name, original in manifest["compositions"].items():
    path = root / f"{name}.otio"
    report = json.loads((root / f"{name}.otio.report.json").read_text(encoding="utf-8"))
    settings = manifest["settingsByComposition"][name]
    timeline = otio.adapters.read_from_file(str(path))
    check_timeline(timeline, original, report, settings)
    check_sync_timeline(name, timeline)
    roundtrip_path = root / f"{name}.roundtrip.otio"
    otio.adapters.write_to_file(timeline, str(roundtrip_path))
    restored = otio.adapters.read_from_file(str(roundtrip_path))
    check_timeline(restored, original, report, settings)
    check_sync_timeline(name, restored)


def probe_media(path):
    return json.loads(subprocess.run(["ffprobe", "-v", "error", "-show_streams", "-of", "json", str(path)], check=True, capture_output=True, text=True, encoding="utf-8").stdout)


def decode_video(path, reference):
    stream = next(stream for stream in probe_media(path)["streams"] if stream["codec_type"] == "video")
    assert (stream["width"], stream["height"]) == (160, 90), (path, "unexpected video dimensions")
    rate = Fraction(reference["rateNumerator"], reference["rateDenominator"])
    assert Fraction(stream["avg_frame_rate"]) == rate, (path, "unexpected rational video rate")
    time_base = Fraction(stream["time_base"])
    start_pts, duration_ts = int(stream["start_pts"]), int(stream["duration_ts"])
    assert start_pts == 0, (path, "video stream must start at PTS zero", start_pts)
    assert duration_ts * time_base == Fraction(120, 1) / rate, (path, "exact video stream duration", duration_ts, str(time_base))
    # Inspect each presented frame's integer timestamp, rather than inferring
    # presentation timing from an average rate and decoded ordinal alone.
    frames = json.loads(subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-read_intervals", "%+#121", "-show_frames", "-show_entries", "frame=best_effort_timestamp", "-of", "json", str(path)], check=True, capture_output=True, text=True, encoding="utf-8").stdout)["frames"]
    assert len(frames) == 120, (path, "presentation timestamp count", len(frames))
    presentation_timestamps = [int(frame["best_effort_timestamp"]) for frame in frames]
    for index, timestamp in enumerate(presentation_timestamps):
        assert timestamp * time_base == Fraction(index, 1) / rate, (path, "exact frame presentation time", index, timestamp, str(time_base))
    # Bound the complete decode to one more than the largest allowed source.
    # An overlong file fails the exact frame count without unbounded allocation.
    decoded = subprocess.run(["ffmpeg", "-v", "error", "-threads", "1", "-i", str(path), "-map", "0:v:0", "-frames:v", "121", "-fps_mode", "passthrough", "-pix_fmt", "gray", "-f", "rawvideo", "-"], check=True, capture_output=True).stdout
    frame_bytes = 160 * 90
    assert len(decoded) == 120 * frame_bytes, (path, "decoded frame count", len(decoded) / frame_bytes)
    means = [sum(decoded[start:start + frame_bytes]) / frame_bytes for start in range(0, len(decoded), frame_bytes)]
    assert all(mean < 8 or mean > 240 for mean in means), (path, "unexpected intermediate frame content")
    return {
        "decodedFrames": len(means),
        "flashFrames": [frame for frame, mean in enumerate(means) if mean > 240],
        "presentationTiming": {
            "timeBase": str(time_base), "startPts": start_pts,
            "durationTs": duration_ts, "durationSeconds": str(duration_ts * time_base),
            "frameBestEffortTimestamps": presentation_timestamps,
        },
    }


def decode_audio(path, codec):
    stream = next(stream for stream in probe_media(path)["streams"] if stream["codec_type"] == "audio")
    assert stream["codec_name"] == codec, (path, "unexpected audio codec", stream)
    assert stream["sample_rate"] == "48000" and stream["channels"] == 2, (path, "unexpected audio shape")
    if codec == "aac":
        assert stream["profile"] == "LC", (path, "AAC uncertainty assumes LC's 1024-sample frame")
    decoded = subprocess.run(["ffmpeg", "-v", "error", "-threads", "1", "-i", str(path), "-map", "0:a:0", "-t", "5", "-ar", "48000", "-ac", "2", "-f", "f32le", "-"], check=True, capture_output=True).stdout
    assert len(decoded) % 8 == 0
    samples = array.array("f")
    samples.frombytes(decoded)
    if sys.byteorder != "little":
        samples.byteswap()
    assert all(math.isfinite(value) for value in samples), (path, "nonfinite decoded PCM")
    return samples


def check_aac_stream_timing(path, expected_samples):
    stream = next(stream for stream in probe_media(path)["streams"] if stream["codec_type"] == "audio")
    time_base = Fraction(stream["time_base"])
    start_pts, duration_ts = int(stream["start_pts"]), int(stream["duration_ts"])
    assert time_base == Fraction(1, 48000), (path, "AAC stream sample timebase", str(time_base))
    assert start_pts == 0, (path, "AAC stream must start at PTS zero", start_pts)
    assert duration_ts == expected_samples, (path, "exact AAC presentation sample count", duration_ts, expected_samples)
    return {
        "timeBase": str(time_base), "startPts": start_pts,
        "durationTs": duration_ts, "durationSeconds": str(duration_ts * time_base),
    }


def audio_observation(samples, threshold):
    active = [sample for sample in range(len(samples) // 2) if max(abs(samples[sample * 2]), abs(samples[sample * 2 + 1])) > threshold]
    assert active, "missing decoded tone marker"
    return {"decodedSamples": len(samples) // 2, "firstAudibleSample": active[0], "lastAudibleSample": active[-1]}


def check_pcm_marker(samples, observation, onset, count, context):
    assert observation["decodedSamples"] == count, (context, "full PCM sample count", observation, count)
    assert observation["firstAudibleSample"] == onset, (context, "absolute PCM onset", observation, onset)
    assert observation["lastAudibleSample"] == onset + 2399, (context, "absolute PCM marker end", observation, onset + 2399)
    assert max(abs(samples[index] - samples[index + 1]) for index in range(0, len(samples), 2)) < 1e-7, (context, "stereo marker mismatch")
    tone = samples[onset * 2:(onset + 2400) * 2:2]
    cosine = [math.cos(2 * math.pi * 1000 * sample / 48000) for sample in range(2400)]
    correlation = sum(a * b for a, b in zip(tone, cosine)) / math.sqrt(sum(a * a for a in tone) * sum(b * b for b in cosine))
    assert correlation > 0.99999, (context, "decoded marker is not the known 1 kHz tone", correlation)


sync_evidence = {}
decoded_sync_audio = {}
for name, reference in SYNC_CASES.items():
    source_video = local_source(assets[reference["sourceVideoAssetId"]]["uri"])
    source_audio = local_source(assets[reference["sourceAudioAssetId"]]["uri"])
    source_pcm = decode_audio(source_audio, "pcm_s24le")
    mix_pcm = decode_audio(root / reference["fullMix"], "pcm_s24le")
    aac_pcm = decode_audio(root / reference["renderedVideo"], "aac")
    decoded_sync_audio[name] = (source_pcm, mix_pcm)
    sync_evidence[name] = {
        "sourceVideo": decode_video(source_video, reference),
        "renderedVideo": decode_video(root / reference["renderedVideo"], reference),
        "sourcePcm": audio_observation(source_pcm, 1e-6),
        "fullMixPcm": audio_observation(mix_pcm, 1e-6),
        "mp4Aac": {
            **audio_observation(aac_pcm, 0.01),
            "presentationTiming": check_aac_stream_timing(root / reference["renderedVideo"], 192000 if name == "sync-30" else 192192),
        },
        "expectedSourceMarkerFrame": reference["sourceMarkerFrame"],
        "expectedRecordMarkerFrame": reference["recordMarkerFrame"],
        "expectedSourceMarkerSample": reference["sourceMarkerSample"],
        "expectedRecordMarkerSample": reference["recordMarkerSample"],
        "pcmUncertaintySamples": 0,
        "aacUncertaintySamples": 1024,
        "aacUncertaintyReason": "AAC LC uses 1024-sample transform frames; lossy pre-echo/ringing may move the 0.01-amplitude onset/end. This allowance never applies to PCM or video.",
    }

# Retain actual observations even when a strict absolute-timing assertion fails.
(root / "sync-evidence.json").write_text(json.dumps({"synthetic": True, "realResolveVerified": False, "cases": sync_evidence}, indent=2) + "\n", encoding="utf-8")
for name, reference in SYNC_CASES.items():
    observation = sync_evidence[name]
    source_pcm, mix_pcm = decoded_sync_audio[name]
    source_count = 192000 if name == "sync-30" else 192192
    assert observation["sourceVideo"]["flashFrames"] == [30], (name, "literal source flash", observation)
    assert observation["renderedVideo"]["flashFrames"] == [reference["recordMarkerFrame"]], (name, "literal record flash", observation)
    check_pcm_marker(source_pcm, observation["sourcePcm"], reference["sourceMarkerSample"], source_count, f"{name} source")
    check_pcm_marker(mix_pcm, observation["fullMixPcm"], reference["recordMarkerSample"], source_count, f"{name} full mix")
    aac = observation["mp4Aac"]
    assert source_count <= aac["decodedSamples"] <= source_count + 1024, (name, "AAC decoded length", aac)
    assert abs(aac["firstAudibleSample"] - reference["recordMarkerSample"]) <= 1024, (name, "AAC onset outside declared codec uncertainty", aac)
    assert abs(aac["lastAudibleSample"] - (reference["recordMarkerSample"] + 2399)) <= 1024, (name, "AAC end outside declared codec uncertainty", aac)

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

print(json.dumps({"officialParser": f"OpenTimelineIO {otio.__version__}", "readWriteRead": "passed", "realSourceFiles": len(assets), "sourceHashesAndBounds": "passed", "cutStillAudioGapMultiTrack": "passed", "decodedAudioVideoSync": {"cases": 2, "videoFrameUncertainty": 0, "pcmSampleUncertainty": 0, "aacSampleUncertainty": 1024, "videoPresentationTimestamps": "exact", "aacStreamTiming": "exact", "evidence": "sync-evidence.json"}, "advancedEdits": "metadata-only; manual recreation required", "realResolveImport": "not verified"}))
