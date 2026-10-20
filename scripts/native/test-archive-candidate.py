"""Regression for installer permissions after Actions artifact transfer."""
import hashlib
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest

ARCHIVER = Path(__file__).with_name("archive-candidate.py")


class InstallerArchiveTests(unittest.TestCase):
    def test_transport_preserves_executables_and_app_bundle_contents(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            bundle = root / "bundle"
            appimage = bundle / "appimage/OpenFilm.AppImage"
            executable = bundle / "macos/OpenFilm.app/Contents/MacOS/OpenFilm"
            for path in (appimage, executable):
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b"synthetic executable")
                path.chmod(0o755)
            (bundle / "candidate.json").write_text('{"workstationQA":"not-run"}')
            if sys.platform != "win32":
                os.symlink("OpenFilm", executable.with_name("Current"))
            archive = root / "upload/installers.tar"
            result = subprocess.run(
                [sys.executable, str(ARCHIVER), str(bundle), str(archive)],
                capture_output=True,
            )
            self.assertEqual(result.returncode, 0, result.stderr.decode())
            # Actions discards the outer archive file's executable bit only.
            archive.chmod(0o644)
            with tarfile.open(archive) as source:
                for path in (appimage, executable):
                    entry = source.getmember("bundle/" + path.relative_to(bundle).as_posix())
                    self.assertEqual(source.extractfile(entry).read(), path.read_bytes())
                    if sys.platform != "win32":
                        self.assertEqual(entry.mode & 0o777, 0o755)
                self.assertIn("bundle/candidate.json", source.getnames())
                if sys.platform != "win32":
                    link = source.getmember("bundle/macos/OpenFilm.app/Contents/MacOS/Current")
                    self.assertTrue(link.issym())
                    self.assertEqual(link.linkname, "OpenFilm")
            receipt = archive.with_suffix(".tar.sha256").read_text()
            self.assertEqual(receipt, hashlib.sha256(archive.read_bytes()).hexdigest() + "  installers.tar\n")


if __name__ == "__main__":
    unittest.main()
