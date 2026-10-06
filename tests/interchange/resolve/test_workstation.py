"""Offline portability/evidence regressions. No test here establishes Resolve QA."""
import importlib.util
import json
import pathlib
import shutil
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
RUNNER = pathlib.Path(__file__).resolve().parents[3] / "scripts/resolve-qa/resolve_qa.py"
specification = importlib.util.spec_from_file_location("resolve_qa", RUNNER)
qa = importlib.util.module_from_spec(specification)
specification.loader.exec_module(qa)


def rational(seconds, rate=24):
    return {"value": seconds * rate, "rate": rate}


def fixture(root):
    media = root / "media files" / "旅行  #1 & café.mp4"
    media.parent.mkdir(parents=True)
    media.write_bytes(b"unit-test bytes, not a decodable or Resolve-verified media fixture")
    original = "file:///D:/Original%20media/%E6%97%85%E8%A1%8C%20%20%231%20%26%20caf%C3%A9.mp4"
    source = {"OTIO_SCHEMA": "Clip.1", "source_range": {"start_time": rational(0.5), "duration": rational(1)},
              "metadata": {"openfilm": {"assetId": "video", "clipId": "clip", "clip": {"timelineDuration": 2, "transform": {"speed": 0.5}}}},
              "media_reference": {"target_url": original}}
    timeline = {"global_start_time": rational(0), "tracks": {"children": [{"kind": "Video", "children": [
        {"OTIO_SCHEMA": "Gap.1", "source_range": {"duration": rational(2)}}, source,
        {"OTIO_SCHEMA": "Gap.1", "source_range": {"duration": rational(1)}}]}]}}
    qa.write_json(root / "cuts.otio", timeline)
    qa.write_json(root / "manifest.json", {"assets": [{"id": "video", "mediaType": "video", "frameRate": 24}]})
    bundle = {"schemaVersion": 1, "kind": "openfilm-resolve-qa", "openfilm": {"checkoutSha": "a" * 40, "candidateSha": "b" * 40, "dirtyFiles": []},
              "assets": [{"id": "video", "originalUri": original, "relativePath": media.relative_to(root).as_posix(), "sha256": qa.digest(media)}],
              "fixtures": [{"name": "cuts", "path": "cuts.otio", "frameRate": 24}],
              "files": [{"path": name, "sha256": qa.digest(root / name)} for name in ["cuts.otio", "manifest.json"]], "realResolveVerified": False}
    qa.write_json(root / "bundle.json", bundle)
    return bundle, media, timeline


class WorkstationTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="openfilm-workstation-test-")
        self.root = pathlib.Path(self.temporary.name) / "relocated 日本 # &"
        self.root.mkdir()
        self.bundle, self.media, self.document = fixture(self.root)

    def tearDown(self):
        self.temporary.cleanup()

    def test_relocates_windows_origin_to_local_urls_and_preserves_all_original_bytes(self):
        before = {item: item.read_bytes() for item in self.root.rglob("*") if item.is_file()}
        prepared = qa.prepare(self.root)
        url = qa.read_json(prepared / "cuts.otio")["tracks"]["children"][0]["children"][1]["media_reference"]["target_url"]
        self.assertEqual(url, self.media.resolve().as_uri())
        self.assertIn("%23", url)
        self.assertIn("%26", url)
        self.assertIn("%20%20", url)
        self.assertIn("%E6%97%85", url)
        self.assertEqual(before, {item: item.read_bytes() for item in before})
        self.assertFalse(qa.read_json(prepared / "prepared.json")["realResolveVerified"])
        self.assertNotEqual(qa.prepare(self.root), prepared)

    def test_preparation_must_be_repeated_after_another_move(self):
        prepared = qa.prepare(self.root)
        destination = self.root.with_name("moved again")
        shutil.move(self.root, destination)
        with self.assertRaisesRegex(ValueError, "moved or changed"):
            qa.load_prepared(destination, destination / prepared.name, "cuts")
        new = qa.prepare(destination)
        qa.load_prepared(destination, new, "cuts")

    def test_source_tamper_fails_before_creating_prepared_output(self):
        self.media.write_bytes(b"changed")
        with self.assertRaisesRegex(ValueError, "hash mismatch"):
            qa.prepare(self.root)
        self.assertEqual(list(self.root.glob("prepared-*")), [])

    def test_timeline_tamper_fails_hash_check(self):
        (self.root / "cuts.otio").write_text("{}")
        with self.assertRaisesRegex(ValueError, "hash mismatch"):
            qa.prepare(self.root)

    def test_modified_prepared_timeline_cannot_be_used_as_original_evidence(self):
        prepared = qa.prepare(self.root)
        (prepared / "cuts.otio").write_text("{}")
        with self.assertRaisesRegex(ValueError, "Prepared timeline changed"):
            qa.load_prepared(self.root, prepared, "cuts")

    def test_unknown_source_url_is_not_silently_left_on_another_machine(self):
        self.document["tracks"]["children"][0]["children"][1]["media_reference"]["target_url"] = "file:///unknown/source.mp4"
        with self.assertRaisesRegex(ValueError, "Unlisted OTIO"):
            qa.rewrite_urls(self.document, {self.bundle["assets"][0]["originalUri"]: self.media.as_uri()})

    def test_traversal_windows_drive_and_symlinks_are_rejected(self):
        for value in ["../outside.mp4", "/tmp/outside.mp4", "C:/outside.mp4", r"media files\outside.mp4"]:
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, "Unsafe bundle"):
                qa.member(self.root, value)
        link = self.root / "alias.mp4"
        try:
            link.symlink_to(self.media)
        except OSError:
            self.skipTest("OS does not permit test symlinks")
        with self.assertRaisesRegex(ValueError, "Symlink"):
            qa.member(self.root, link.name)

    def expected(self):
        return qa.expectations(self.document, self.bundle, self.root)

    def observation(self):
        expected = self.expected()
        clip = expected["tracks"][0]["clips"][0]
        return {"frameRate": 24, "durationFrames": 96, "trackCounts": {"video": 1, "audio": 0}, "tracks": [
            {"kind": "video", "index": 1, "clips": [{"startFrame": 48, "durationFrames": 24, "sourceSha256": clip["sourceSha256"], "sourceStartFrame": 12}]}]}

    def test_expected_timing_is_native_cut_not_metadata_only_retime(self):
        expected = self.expected()
        self.assertEqual(expected["tracks"][0]["clips"][0]["durationFrames"], 24)
        self.assertEqual(expected["durationFrames"], 96)

    def test_comparison_pass_still_requires_manual_application_checks(self):
        checks = qa.compare_observation(self.expected(), self.observation())
        self.assertTrue(all(item["status"] == "passed" for item in checks))
        self.assertEqual(qa.classify(checks), "api-checks-passed-manual-qa-required")

    def test_fractional_rounding_and_wrong_source_hash_are_mismatches(self):
        expected, observed = self.expected(), self.observation()
        expected["tracks"][0]["clips"][0]["startFrame"] = 47.952047952
        observed["tracks"][0]["clips"][0]["sourceSha256"] = "wrong-source"
        checks = qa.compare_observation(expected, observed)
        self.assertEqual(qa.classify(checks), "mismatch")
        self.assertEqual(sum(item["status"] == "mismatch" for item in checks), 2)

    def test_unavailable_source_start_is_not_reported_as_verified_trim(self):
        observed = self.observation()
        observed["tracks"][0]["clips"][0].pop("sourceStartFrame")
        checks = qa.compare_observation(self.expected(), observed)
        self.assertEqual(qa.classify(checks), "partial")
        self.assertEqual(checks[-1]["status"], "unavailable")

    def test_manual_template_is_not_application_evidence(self):
        prepared = qa.prepare(self.root)
        output = qa.manual_record(self.root, prepared, "cuts")
        evidence = qa.read_json(output / "manual-evidence.json")
        self.assertEqual(evidence["status"], "not-run")
        self.assertEqual(evidence["evidenceType"], "manual-template-not-observed")
        self.assertFalse(evidence["realNleVerified"])
        self.assertEqual(evidence["openfilm"], self.bundle["openfilm"])

    def test_missing_resolve_returns_blocked_nonzero_with_written_evidence(self):
        prepared = qa.prepare(self.root)
        result = subprocess.run([sys.executable, str(RUNNER), "run", "--bundle", str(self.root), "--prepared", str(prepared), "--api", str(self.root / "no-installed-api")], capture_output=True, text=True)
        self.assertEqual(result.returncode, 2, result.stderr)
        output = pathlib.Path(json.loads(result.stdout)["output"])
        evidence = qa.read_json(output / "evidence.json")
        self.assertEqual(evidence["status"], "blocked")
        self.assertFalse(evidence["realNleVerified"])
        self.assertNotIn("beforeSave", evidence)
        self.assertIn("not found", evidence["environment"]["reason"])

    def test_probe_missing_api_does_not_create_or_modify_a_project(self):
        result = subprocess.run([sys.executable, str(RUNNER), "probe", "--api", str(self.root / "missing")], capture_output=True, text=True)
        self.assertEqual(result.returncode, 2)
        self.assertEqual(json.loads(result.stdout)["status"], "blocked")

    def test_active_project_guard_never_creates_or_closes_a_project(self):
        # A guard-only double; it produces blocked evidence, never verification.
        class Manager:
            def GetCurrentProject(self):
                return object()
            def CreateProject(self, name):
                raise AssertionError("Must not create a project while another is open")
        resolve = types.SimpleNamespace(GetProjectManager=lambda: Manager())
        with patch.object(qa, "connect", return_value=(resolve, {"status": "guard-test-double"})):
            output, code = qa.run(self.root, qa.prepare(self.root), "cuts")
        self.assertEqual(code, 2)
        self.assertEqual(qa.read_json(output / "evidence.json")["status"], "blocked")

    def test_lost_project_manager_capability_writes_blocked_evidence(self):
        def disconnected():
            raise RuntimeError("Resolve disconnected")
        for getter in [lambda: None, disconnected, lambda: types.SimpleNamespace(GetCurrentProject=disconnected)]:
            with self.subTest(getter=getter), patch.object(qa, "connect", return_value=(types.SimpleNamespace(GetProjectManager=getter), {"status": "failure-test-double"})):
                output, code = qa.run(self.root, qa.prepare(self.root), "cuts")
                evidence = qa.read_json(output / "evidence.json")
                self.assertEqual(code, 2)
                self.assertEqual(evidence["status"], "blocked")
                self.assertFalse(evidence["realNleVerified"])

    def test_native_export_false_or_missing_file_cannot_pass(self):
        # Only failure classification is exercised: these are not application observations.
        for export_result in [False, True]:
            class Project:
                def GetName(self):
                    return self.name
                def SetSetting(self, key, value):
                    return True
                def GetMediaPool(self):
                    return types.SimpleNamespace(ImportTimelineFromFile=lambda *args: object())
                def GetCurrentTimeline(self):
                    return object()
            class Manager:
                project = None
                saved_project = None
                def GetCurrentProject(self):
                    return self.project
                def CreateProject(self, name):
                    self.project = Project()
                    self.project.name = name
                    self.saved_project = self.project
                    return self.project
                def SaveProject(self):
                    return True
                def ExportProject(self, *args):
                    return export_result
                def CloseProject(self, project):
                    self.project = None
                    return True
                def LoadProject(self, name):
                    self.project = self.saved_project
                    return self.project
            manager = Manager()
            resolve = types.SimpleNamespace(GetProjectManager=lambda: manager)
            with self.subTest(export_result=export_result), patch.object(qa, "connect", return_value=(resolve, {"status": "failure-test-double", "versionFields": [20, 2, 0]})), patch.object(qa, "observe", return_value=self.observation()):
                output, code = qa.run(self.root, qa.prepare(self.root), "cuts")
            evidence = qa.read_json(output / "evidence.json")
            self.assertEqual(code, 2)
            self.assertEqual(evidence["status"], "mismatch")
            self.assertEqual(evidence["nativeProjectArtifact"]["status"], "mismatch")
            self.assertNotIn("nativeProject", evidence)
            self.assertFalse(evidence["realNleVerified"])

    def test_unsaved_qa_project_is_never_closed(self):
        # Failure-only double; it proves no data-loss action occurs, not API success.
        class Project:
            def GetName(self):
                return self.name
            def SetSetting(self, key, value):
                return True
            def GetMediaPool(self):
                return types.SimpleNamespace(ImportTimelineFromFile=lambda *args: object())
        class Manager:
            project = None
            def GetCurrentProject(self):
                return self.project
            def CreateProject(self, name):
                self.project = Project()
                self.project.name = name
                return self.project
            def SaveProject(self):
                return False
            def CloseProject(self, project):
                raise AssertionError("Must not close after failed save")
            def ExportProject(self, *args):
                raise AssertionError("Must not export after failed save")
        manager = Manager()
        resolve = types.SimpleNamespace(GetProjectManager=lambda: manager)
        with patch.object(qa, "connect", return_value=(resolve, {"status": "failure-test-double", "versionFields": [20, 2, 0]})), patch.object(qa, "observe", return_value=self.observation()):
            output, code = qa.run(self.root, qa.prepare(self.root), "cuts")
        self.assertEqual(code, 2)
        evidence = qa.read_json(output / "evidence.json")
        self.assertFalse(evidence["saved"])
        self.assertFalse(evidence["realNleVerified"])
        self.assertNotIn("closedAfterSave", evidence)
        self.assertIn("Saving", evidence["reason"])


if __name__ == "__main__":
    unittest.main()
