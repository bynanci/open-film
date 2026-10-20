"""Synthetic regression tests for permission-preserving runtime transport."""
import io
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
