#!/usr/bin/env python3
"""Portable Resolve QA handoff. Python 3.9+, standard library; never certifies playback.

The API bridge is loaded only from an installed Resolve Scripting/Modules directory.
Consult that installation's README.txt for its supported version/edition/API surface.
"""
import argparse
import datetime
import hashlib
import importlib.util
import json
import math
import os
import pathlib
import platform
import sys
import uuid

SCHEMA = 1
MANUAL_CHECKS = [
    "First/last video frames and source-out timing", "Still-image appearance",
    "Audio playback, channel routing and levels", "Layer compositing and gap playback",
    "Audio source-in/out timing (API time units are not assumed)",
    "Color/HDR interpretation", "UI media relinking if intentionally moved after import",
    "Speed, gain/mute, transform, crossfade, titles and locks: manual recreation only",
]


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def digest(path):
    with pathlib.Path(path).open("rb") as stream:
        result = hashlib.sha256()
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(block)
        return result.hexdigest()


def read_json(path):
    return json.loads(pathlib.Path(path).read_text(encoding="utf-8"))


def write_json(path, value):
    path = pathlib.Path(path)
    temporary = path.with_name(path.name + ".writing")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def member(root, relative):
    """Reject traversal, Windows absolute paths and symlink members on every OS."""
    root = pathlib.Path(root).resolve()
    value = pathlib.PurePosixPath(relative)
    if not relative or "\\" in relative or value.is_absolute() or pathlib.PureWindowsPath(relative).drive or ".." in value.parts:
        raise ValueError("Unsafe bundle path: " + relative)
    path = root.joinpath(*value.parts)
    if any(part.is_symlink() for part in [path, *path.parents] if part != root and root in part.parents):
        raise ValueError("Symlink bundle member: " + relative)
    if not path.is_file():
        raise ValueError("Missing bundle file: " + relative)
    return path


def load_bundle(root):
    root = pathlib.Path(root).resolve()
    bundle = read_json(root / "bundle.json")
    if bundle.get("schemaVersion") != SCHEMA or bundle.get("kind") != "openfilm-resolve-qa":
        raise ValueError("Unsupported bundle schema; regenerate with pnpm test:interchange --output.")
    for item in bundle["files"]:
        if digest(member(root, item["path"])) != item["sha256"]:
            raise ValueError("Bundle hash mismatch: " + item["path"])
    for asset in bundle["assets"]:
        if digest(member(root, asset["relativePath"])) != asset["sha256"]:
            raise ValueError("Media hash mismatch: " + asset["relativePath"])
    return bundle


def rewrite_urls(value, replacements):
    if isinstance(value, str):
        return replacements.get(value, value)
    if isinstance(value, list):
        return [rewrite_urls(item, replacements) for item in value]
    if isinstance(value, dict):
        target = value.get("target_url")
        if target is not None and target not in replacements:
            raise ValueError("Unlisted OTIO source reference: " + str(target))
        return {key: rewrite_urls(item, replacements) for key, item in value.items()}
    return value


def fresh_directory(root, prefix):
    path = pathlib.Path(root) / (prefix + "-" + uuid.uuid4().hex[:12])
    path.mkdir(parents=False, exist_ok=False)
    return path


def prepare(root):
    root = pathlib.Path(root).resolve()
    bundle = load_bundle(root)
    replacements = {asset["originalUri"]: member(root, asset["relativePath"]).as_uri() for asset in bundle["assets"]}
    # Validate every document before creating output; never rewrite the originals.
    documents = {item["name"]: rewrite_urls(read_json(member(root, item["path"])), replacements) for item in bundle["fixtures"]}
    output = fresh_directory(root, "prepared")
    files = []
    for item in bundle["fixtures"]:
        target = output / (item["name"] + ".otio")
        write_json(target, documents[item["name"]])
        files.append({"name": item["name"], "path": target.name, "sha256": digest(target), "frameRate": item["frameRate"]})
    write_json(output / "prepared.json", {
        "schemaVersion": SCHEMA, "preparedAt": now(), "bundleSha256": digest(root / "bundle.json"),
        "bundleRoot": str(root), "openfilm": bundle["openfilm"], "fixtures": files,
        "media": [{"id": item["id"], "uri": replacements[item["originalUri"]], "sha256": item["sha256"]} for item in bundle["assets"]],
        "realResolveVerified": False,
    })
    return output


def load_prepared(root, prepared, fixture):
    root, prepared = pathlib.Path(root).resolve(), pathlib.Path(prepared).resolve()
    bundle = load_bundle(root)
    record = read_json(prepared / "prepared.json")
    if record["bundleSha256"] != digest(root / "bundle.json") or record["bundleRoot"] != str(root):
        raise ValueError("Bundle moved or changed after preparation; run prepare again at its new location.")
    item = next((item for item in record["fixtures"] if item["name"] == fixture), None)
    if item is None:
        raise ValueError("Unknown fixture: " + fixture)
    path = member(prepared, item["path"])
    if digest(path) != item["sha256"]:
        raise ValueError("Prepared timeline changed; run prepare again instead of overwriting evidence.")
    return bundle, path, read_json(path)


def seconds(value):
    return float(value["value"]) / float(value["rate"])


def expectations(document, bundle, root):
    """Use the native OTIO cut ranges, not metadata-only speed/effect requests."""
    rate = float(document["global_start_time"]["rate"])
    assets = {item["id"]: item for item in read_json(member(root, "manifest.json"))["assets"]}
    media = {item["id"]: item for item in bundle["assets"]}
    counters = {"video": 0, "audio": 0}
    tracks = []
    for track in document["tracks"]["children"]:
        kind = "audio" if track["kind"] == "Audio" else "video"
        counters[kind] += 1
        cursor = 0.0
        clips = []
        for child in track["children"]:
            duration = seconds(child["source_range"]["duration"])
            if child["OTIO_SCHEMA"].startswith("Clip."):
                metadata = child["metadata"]["openfilm"]
                asset = assets[metadata["assetId"]]
                identity = media[metadata["assetId"]]
                clips.append({
                    "id": metadata["clipId"], "mediaType": asset["mediaType"],
                    "sourcePath": str(member(root, identity["relativePath"])), "sourceSha256": identity["sha256"],
                    "startFrame": cursor * rate, "durationFrames": duration * rate,
                    "sourceInSeconds": seconds(child["source_range"]["start_time"]),
                    "sourceFrameRate": asset.get("frameRate"),
                })
            cursor += duration
        tracks.append({"kind": kind, "index": counters[kind], "durationFrames": cursor * rate, "clips": clips})
    return {"frameRate": rate, "tracks": tracks, "durationFrames": max((track["durationFrames"] for track in tracks), default=0)}


def comparison(name, expected, actual, tolerance=0):
    if actual is None:
        return {"name": name, "status": "unavailable", "expected": expected, "actual": None}
    if isinstance(expected, (int, float)) and not isinstance(expected, bool):
        try:
            number = float(actual)
            passed = math.isfinite(number) and abs(number - expected) <= tolerance
        except (ValueError, TypeError):
            passed = False
    else:
        passed = actual == expected
    return {"name": name, "status": "passed" if passed else "mismatch", "expected": expected, "actual": actual, "tolerance": tolerance}


def compare_observation(expected, observed):
    """Strict comparisons preserve fractional-frame mismatches instead of rounding away evidence."""
    checks = [comparison("projectFrameRate", expected["frameRate"], observed.get("frameRate"), 0.0001)]
    checks.append(comparison("timelineDurationFrames", expected["durationFrames"], observed.get("durationFrames"), 0.0001))
    for kind in ["video", "audio"]:
        checks.append(comparison(kind + "TrackCount", sum(track["kind"] == kind for track in expected["tracks"]), observed.get("trackCounts", {}).get(kind)))
    for track in expected["tracks"]:
        actual = next((item for item in observed.get("tracks", []) if item["kind"] == track["kind"] and item["index"] == track["index"]), None)
        prefix = f'{track["kind"]}{track["index"]}'
        checks.append(comparison(prefix + ".clipCount", len(track["clips"]), len(actual["clips"]) if actual is not None else None))
        for index, clip in enumerate(track["clips"]):
            item = actual["clips"][index] if actual is not None and index < len(actual["clips"]) else {}
            label = prefix + "." + clip["id"]
            for key in ["startFrame", "durationFrames", "sourceSha256"]:
                checks.append(comparison(label + "." + key, clip[key], item.get(key), 0.0001 if key != "sourceSha256" else 0))
            # Do not infer source timing from handles. Older APIs and audio units require manual QA.
            if clip["mediaType"] == "video" and clip.get("sourceFrameRate"):
                checks.append(comparison(label + ".sourceStartFrame", clip["sourceInSeconds"] * clip["sourceFrameRate"], item.get("sourceStartFrame"), 0.0001))
    return checks


def classify(checks):
    if any(item["status"] == "mismatch" for item in checks):
        return "mismatch"
    if not checks or any(item["status"] != "passed" for item in checks):
        return "partial"
    return "api-checks-passed-manual-qa-required"


def api_location(explicit=None):
    if explicit:
        return pathlib.Path(explicit).expanduser()
    if os.environ.get("RESOLVE_SCRIPT_API"):
        return pathlib.Path(os.environ["RESOLVE_SCRIPT_API"])
    if sys.platform == "darwin":
        return pathlib.Path("/Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/Scripting")
    if sys.platform == "win32":
        return pathlib.Path(os.environ.get("PROGRAMDATA", r"C:\ProgramData")) / "Blackmagic Design/DaVinci Resolve/Support/Developer/Scripting"
    return pathlib.Path("/opt/resolve/Developer/Scripting")


def connect(explicit=None):
    directory = api_location(explicit).resolve()
    module = directory / "Modules" / "DaVinciResolveScript.py"
    info = {"os": platform.platform(), "python": platform.python_version(), "apiModule": str(module), "status": "blocked"}
    if not module.is_file():
        info["reason"] = "Installed Resolve scripting module not found. Use manual UI QA, or pass --api /installed/Developer/Scripting."
        return None, info
    info["apiModuleSha256"] = digest(module)
    readme = directory / "README.txt"
    if readme.is_file():
        info["installedReadmeSha256"] = digest(readme)
    # The vendor module locates fusionscript using RESOLVE_SCRIPT_LIB or installation defaults.
    try:
        sys.path.insert(0, str(module.parent))
        specification = importlib.util.spec_from_file_location("DaVinciResolveScript", module)
        bridge = importlib.util.module_from_spec(specification)
        specification.loader.exec_module(bridge)
        resolve = bridge.scriptapp("Resolve")
        if resolve is None:
            raise RuntimeError("Resolve is not running or external scripting is unavailable/disabled in this version or edition.")
        info.update({"status": "connected", "version": resolve.GetVersionString(), "versionFields": resolve.GetVersion(), "product": resolve.GetProductName()})
        return resolve, info
    except Exception as error:
        info["reason"] = str(error)
        info["nextAction"] = "Use a supported Studio installation with local scripting enabled, or the manual import checklist. Do not enable network scripting."
        return None, info


def optional(obj, method, *args):
    try:
        function = getattr(obj, method, None)
        return function(*args) if callable(function) else None
    except Exception:
        return None


def require_owned(manager, name):
    current = manager.GetCurrentProject()
    if current is None or current.GetName() != name:
        raise RuntimeError("The active project changed. Stopped without saving or closing another project.")
    return current


def observe(project, timeline, modern):
    start = timeline.GetStartFrame()
    result = {"name": timeline.GetName(), "frameRate": optional(timeline, "GetSetting", "timelineFrameRate") or optional(project, "GetSetting", "timelineFrameRate"),
              "startFrame": start, "endFrame": timeline.GetEndFrame(), "tracks": [], "trackCounts": {}}
    result["durationFrames"] = result["endFrame"] - start
    for kind in ["video", "audio"]:
        count = timeline.GetTrackCount(kind)
        result["trackCounts"][kind] = count
        for index in range(1, count + 1):
            clips = []
            for item in timeline.GetItemListInTrack(kind, index) or []:
                media = optional(item, "GetMediaPoolItem")
                properties = optional(media, "GetClipProperty") if media is not None else {}
                properties = properties if isinstance(properties, dict) else {}
                source = properties.get("File Path")
                arguments = (True,) if modern else ()
                item_start = optional(item, "GetStart", *arguments)
                clips.append({"name": optional(item, "GetName"), "startFrame": item_start - start if item_start is not None else None,
                              "durationFrames": optional(item, "GetDuration", *arguments), "endFrame": optional(item, "GetEnd", *arguments),
                              "sourceStartFrame": optional(item, "GetSourceStartFrame") if modern else None,
                              "sourceEndFrame": optional(item, "GetSourceEndFrame") if modern else None,
                              "sourceStartTimeRaw": optional(item, "GetSourceStartTime") if modern else None,
                              "sourceEndTimeRaw": optional(item, "GetSourceEndTime") if modern else None,
                              "sourcePath": source, "sourceSha256": digest(source) if source and pathlib.Path(source).is_file() else None,
                              "mediaProperties": properties})
            clips.sort(key=lambda clip: clip["startFrame"] if clip["startFrame"] is not None else math.inf)
            result["tracks"].append({"kind": kind, "index": index, "clips": clips})
    return result


def manual_record(root, prepared, fixture):
    bundle, path, document = load_prepared(root, prepared, fixture)
    output = fresh_directory(root, "manual")
    write_json(output / "manual-evidence.json", {
        "schemaVersion": SCHEMA, "evidenceType": "manual-template-not-observed", "status": "not-run", "createdAt": now(),
        "openfilm": bundle["openfilm"], "bundleSha256": digest(pathlib.Path(root) / "bundle.json"),
        "fixture": str(path), "fixtureSha256": digest(path), "expected": expectations(document, bundle, root),
        "resolveVersion": None, "edition": None, "os": None, "importMethod": None, "projectFrameRate": None,
        "observations": [], "saveReopen": "not-run", "screenshots": [], "nativeProject": None,
        "manualChecks": [{"name": name, "status": "not-run", "notes": ""} for name in MANUAL_CHECKS],
        "realNleVerified": False,
    })
    return output


def run(root, prepared, fixture, explicit_api=None):
    bundle, path, document = load_prepared(root, prepared, fixture)
    output = fresh_directory(root, "run")
    expected = expectations(document, bundle, root)
    evidence = {"schemaVersion": SCHEMA, "evidenceType": "resolve-scripting-observation", "startedAt": now(), "status": "not-run",
                "openfilm": bundle["openfilm"], "bundleSha256": digest(pathlib.Path(root) / "bundle.json"), "fixture": str(path),
                "fixtureSha256": digest(path), "expected": expected, "realNleVerified": False,
                "manualChecks": [{"name": name, "status": "manual-verification-required"} for name in MANUAL_CHECKS]}
    evidence_path = output / "evidence.json"
    resolve, evidence["environment"] = connect(explicit_api)
    write_json(evidence_path, evidence)
    if resolve is None:
        evidence["status"] = "blocked"
        write_json(evidence_path, evidence)
        return output, 2
    name = "OpenFilm_QA_" + fixture + "_" + uuid.uuid4().hex[:12]
    try:
        manager = resolve.GetProjectManager()
        if manager is None:
            raise RuntimeError("Resolve Project Manager is unavailable. No project was created.")
        if manager.GetCurrentProject() is not None:
            evidence.update({"status": "blocked", "reason": "A project is open. Save and close it yourself, return to Project Manager, then retry. No project was modified."})
            write_json(evidence_path, evidence)
            return output, 2
        evidence["projectName"] = name
        project = manager.CreateProject(name)
        if project is None:
            raise RuntimeError("Resolve could not create a separate QA project. No existing project was opened.")
        require_owned(manager, name)
        fps = "29.97" if abs(expected["frameRate"] - 30000 / 1001) < 0.0001 else str(expected["frameRate"])
        evidence["setFrameRate"] = project.SetSetting("timelineFrameRate", fps)
        if not evidence["setFrameRate"]:
            raise RuntimeError("Resolve rejected the project frame rate; set up the fixture manually instead.")
        evidence["importMethod"] = "MediaPool.ImportTimelineFromFile"
        timeline = project.GetMediaPool().ImportTimelineFromFile(str(path), {"timelineName": name, "importSourceClips": True, "sourceClipsPath": str(pathlib.Path(root) / "media files")})
        if timeline is None:
            evidence["status"] = "manual-import-required"
            evidence["reason"] = "This installed API did not import OTIO. Use the manual UI procedure if this Resolve version offers OTIO; do not substitute another format. The new QA project is left open."
            write_json(evidence_path, evidence)
            return output, 2
        modern = tuple(evidence["environment"]["versionFields"][:3]) >= (19, 0, 2)
        require_owned(manager, name)
        evidence["beforeSave"] = observe(project, timeline, modern)
        evidence["checksBeforeSave"] = compare_observation(expected, evidence["beforeSave"])
        write_json(evidence_path, evidence)
        require_owned(manager, name)
        evidence["saved"] = manager.SaveProject()
        write_json(evidence_path, evidence)
        if not evidence["saved"]:
            raise RuntimeError("Saving the new QA project failed. It was left open; nothing was closed.")
        require_owned(manager, name)
        project_path = output / (name + ".drp")
        evidence["nativeProjectExported"] = manager.ExportProject(name, str(project_path), False)
        if evidence["nativeProjectExported"] and project_path.is_file():
            evidence["nativeProject"] = {"path": str(project_path), "sha256": digest(project_path)}
        evidence["nativeProjectArtifact"] = comparison("nativeProjectArtifact", True, bool(evidence["nativeProjectExported"] and project_path.is_file() and project_path.stat().st_size > 0))
        require_owned(manager, name)
        evidence["closedAfterSave"] = manager.CloseProject(project)
        if not evidence["closedAfterSave"]:
            raise RuntimeError("The saved QA project could not be closed; reopen verification has not run.")
        if manager.GetCurrentProject() is not None:
            raise RuntimeError("Another project became active. Stopped without replacing it.")
        reopened = manager.LoadProject(name)
        if reopened is None:
            raise RuntimeError("The saved QA project could not be reopened.")
        require_owned(manager, name)
        restored = reopened.GetCurrentTimeline()
        if restored is None:
            raise RuntimeError("Reopened project has no current timeline.")
        evidence["afterReopen"] = observe(reopened, restored, modern)
        evidence["checksAfterReopen"] = compare_observation(expected, evidence["afterReopen"])
        evidence["saveReopen"] = comparison("sameTimelineAfterReopen", evidence["beforeSave"], evidence["afterReopen"])
        evidence["status"] = classify(evidence["checksBeforeSave"] + evidence["checksAfterReopen"] + [evidence["saveReopen"], evidence["nativeProjectArtifact"]])
        # Leave the reopened QA project visible for real playback and screenshots.
    except Exception as error:
        evidence.update({"status": "blocked", "reason": str(error), "recovery": "The QA project is retained. Inspect it manually; this runner never deletes a project or closes an unsaved project."})
    evidence["finishedAt"] = now()
    write_json(evidence_path, evidence)
    return output, 0 if evidence["status"] == "api-checks-passed-manual-qa-required" else 2


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["prepare", "probe", "manual", "run"])
    parser.add_argument("--bundle", type=pathlib.Path, default=pathlib.Path(__file__).resolve().parent)
    parser.add_argument("--prepared", type=pathlib.Path)
    parser.add_argument("--fixture", choices=["cuts", "fractional", "edited"], default="cuts")
    parser.add_argument("--api", help="Installed Resolve Developer/Scripting folder; never download a replacement API module.")
    args = parser.parse_args()
    try:
        if args.command == "probe":
            _, info = connect(args.api)
            print(json.dumps(info, ensure_ascii=False, indent=2))
            return 0 if info["status"] == "connected" else 2
        if args.command == "prepare":
            output, code = prepare(args.bundle), 0
        else:
            if args.prepared is None:
                parser.error("--prepared is required. Run prepare after copying the bundle to this workstation.")
            if args.command == "manual":
                output, code = manual_record(args.bundle, args.prepared, args.fixture), 0
            else:
                output, code = run(args.bundle, args.prepared, args.fixture, args.api)
        print(json.dumps({"output": str(output), "realNleVerified": False, "note": "Review measured evidence and complete manual playback checks; parser/API success does not certify all capabilities."}, indent=2))
        return code
    except (OSError, ValueError, KeyError) as error:
        print(json.dumps({"status": "blocked", "reason": str(error), "realNleVerified": False}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
