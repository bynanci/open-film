"""Synthetic regression tests for permission-preserving runtime transport."""
import io
import runpy
from unittest import mock
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest

EXTRACTOR = Path(__file__).with_name("extract-runtime.py")

class RuntimeArchiveTests(unittest.TestCase):
    def check_archive(self, name, kind=tarfile.REGTYPE, accepted=False):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            archive = root / "runtime.tar"
            with tarfile.open(archive, "w") as output:
                entry = tarfile.TarInfo(name)
                entry.type = kind
                entry.mode = 0o755
                entry.size = 4 if kind == tarfile.REGTYPE else 0
                entry.linkname = "../../escape"
                output.addfile(entry, io.BytesIO(b"node") if entry.size else None)
            result = subprocess.run([sys.executable, str(EXTRACTOR), str(archive), str(root / "out")], capture_output=True)
            self.assertEqual(result.returncode == 0, accepted, result.stderr.decode())
            if accepted:
                target = root / "out" / name
                self.assertEqual(target.read_bytes(), b"node")
                if sys.platform != "win32":
                    self.assertEqual(target.stat().st_mode & 0o777, 0o755)
            self.assertFalse((root / "escape").exists())

    def test_actual_producer_tar_round_trip(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            staged = root / "staged-runtime"
            (staged / "bin").mkdir(parents=True)
            (staged / "bin/node").write_bytes(b"synthetic executable bytes")
            (staged / "bin/node").chmod(0o755)
            (staged / "runtime-manifest.json").write_bytes(b'{"synthetic":true}\n')
            (staged / ".retained-info").write_bytes(b"hidden ordinary file")
            archive = root / "runtime.tar"
            # Exact producer command in native-runtime-stage.yml (no shell glob).
            subprocess.run(["tar", "-cf", str(archive), "-C", str(staged), "."], check=True)
            with tarfile.open(archive, "r:") as captured:
                self.assertTrue(any(item.isdir() and item.name in (".", "./") for item in captured.getmembers()))
            result = subprocess.run([sys.executable, str(EXTRACTOR), str(archive), str(root / "out")], capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr.decode())
            for relative in ("bin/node", "runtime-manifest.json", ".retained-info"):
                self.assertEqual((root / "out" / relative).read_bytes(), (staged / relative).read_bytes())
            if sys.platform != "win32":
                self.assertEqual((root / "out/bin/node").stat().st_mode & 0o777, 0o755)
                self.assertEqual((root / "out/runtime-manifest.json").stat().st_mode & 0o777, 0o644)

    def test_only_benign_root_directory_headers_are_ignored(self):
        for name in (".", "./"):
            for kind in (tarfile.REGTYPE, tarfile.SYMTYPE, tarfile.LNKTYPE, tarfile.FIFOTYPE):
                with self.subTest(name=name, kind=kind):
                    self.check_archive(name, kind)
        for name in ("", "/", "/.", "././", "./../", "../"):
            with self.subTest(name=name):
                self.check_archive(name, tarfile.DIRTYPE)

    def test_root_marker_does_not_apply_permissions_or_allow_overwrite(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            destination = root / "out"
            destination.mkdir(mode=0o750)
            destination.chmod(0o750)
            (destination / "retained").write_bytes(b"existing bytes")
            archive = root / "runtime.tar"
            with tarfile.open(archive, "w") as output:
                marker = tarfile.TarInfo(".")
                marker.type = tarfile.DIRTYPE
                marker.mode = 0
                output.addfile(marker)
            subprocess.run([sys.executable, str(EXTRACTOR), str(archive), str(destination)], check=True)
            self.assertEqual((destination / "retained").read_bytes(), b"existing bytes")
            if sys.platform != "win32":
                self.assertEqual(destination.stat().st_mode & 0o777, 0o750)
            with tarfile.open(archive, "a") as output:
                entry = tarfile.TarInfo("retained")
                entry.size = 4
                output.addfile(entry, io.BytesIO(b"evil"))
            result = subprocess.run([sys.executable, str(EXTRACTOR), str(archive), str(destination)], capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual((destination / "retained").read_bytes(), b"existing bytes")

    def test_root_markers_still_count_toward_entry_limit(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            archive = root / "runtime.tar"
            with tarfile.open(archive, "w") as output:
                for _ in range(20001):
                    marker = tarfile.TarInfo(".")
                    marker.type = tarfile.DIRTYPE
                    output.addfile(marker)
            result = subprocess.run([sys.executable, str(EXTRACTOR), str(archive), str(root / "out")], capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn(b"Runtime archive exceeds limits", result.stderr)

    def test_root_payload_still_counts_toward_byte_limit(self):
        # Exercise metadata bounds without allocating a multi-GiB archive.
        with tempfile.TemporaryDirectory() as temporary:
            marker = tarfile.TarInfo(".")
            marker.type = tarfile.DIRTYPE
            marker.size = 4 * 1024**3 + 1
            with mock.patch.object(sys, "argv", [str(EXTRACTOR), "unused.tar", temporary]), mock.patch("tarfile.open") as opened:
                opened.return_value.__enter__.return_value.getmembers.return_value = [marker]
                with self.assertRaisesRegex(ValueError, "Runtime archive exceeds limits"):
                    runpy.run_path(str(EXTRACTOR), run_name="__main__")

    def test_executable_modes(self):
        self.check_archive("bin/node", accepted=True)

    def test_traversal_and_links(self):
        for name in ("../escape", "/escape", "C:/escape", "bin/../../escape", "bin\\escape"):
            with self.subTest(name=name):
                self.check_archive(name)
        for kind in (tarfile.SYMTYPE, tarfile.LNKTYPE, tarfile.FIFOTYPE):
            with self.subTest(kind=kind):
                self.check_archive("bin/node", kind)

if __name__ == "__main__":
    unittest.main()
