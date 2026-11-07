# SPDX-License-Identifier: Apache-2.0
"""Real parser and whole-tree fault controls; never modify the checked-in source."""
import gzip
import importlib.util
import io
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('glib_source', HERE / 'verify-glib-source.py')
source = importlib.util.module_from_spec(spec)
spec.loader.exec_module(source)
ROOT = HERE.parent.parent


def archive(entries):
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode='w', format=tarfile.USTAR_FORMAT) as handle:
        for name, kind, data, mode in entries:
            entry = tarfile.TarInfo(name)
            entry.mode = mode
            entry.type = kind
            entry.size = len(data) if kind == tarfile.REGTYPE else 0
            entry.linkname = 'glib-0.18.5/file' if kind in (tarfile.SYMTYPE, tarfile.LNKTYPE) else ''
            handle.addfile(entry, io.BytesIO(data) if entry.size else None)
    return gzip.compress(stream.getvalue())


class ParserTests(unittest.TestCase):
    def refuse(self, entries, message):
        with self.assertRaisesRegex(ValueError, message):
            source.parse_archive(archive(entries))

    def test_valid_parser_reaches_contents(self):
        parsed = source.parse_archive(archive([('glib-0.18.5/src/file', tarfile.REGTYPE, b'content', 0o644)]))
        self.assertEqual(parsed['src/file'], b'content')

    def test_duplicate_member(self):
        self.refuse([('glib-0.18.5/file', tarfile.REGTYPE, b'', 0o644)] * 2, 'duplicate')

    def test_case_collision(self):
        self.refuse([(f'glib-0.18.5/{p}', tarfile.REGTYPE, b'', 0o644) for p in ('Src/a', 'src/b')], 'case')

    def test_escape_member(self):
        for p in ('../escape', '/escape', 'glib-0.18.5/../escape', 'glib-0.18.5/a\\b', 'glib-0.18.5/C:/x', 'glib-0.18.5/a//b'):
            with self.subTest(p=p):
                self.refuse([(p, tarfile.REGTYPE, b'', 0o644)], 'path')

    def test_excessive_depth(self):
        self.refuse([('glib-0.18.5/' + '/'.join(['a'] * 18), tarfile.REGTYPE, b'', 0o644)], 'depth')

    def test_special_file(self):
        for kind in (tarfile.SYMTYPE, tarfile.LNKTYPE, tarfile.CHRTYPE, tarfile.FIFOTYPE, tarfile.DIRTYPE):
            with self.subTest(kind=kind):
                self.refuse([('glib-0.18.5/file', kind, b'', 0o644)], 'regular')

    def test_wrong_mode(self):
        self.refuse([('glib-0.18.5/file', tarfile.REGTYPE, b'', 0o755)], 'mode')

    def test_oversized_archive(self):
        self.refuse([('glib-0.18.5/file', tarfile.REGTYPE, b'x' * 3_000_001, 0o644)], 'expanded')

    def test_corrupt_header(self):
        data = bytearray(gzip.decompress(archive([('glib-0.18.5/file', tarfile.REGTYPE, b'', 0o644)])))
        data[10] ^= 1
        with self.assertRaisesRegex(ValueError, 'checksum'):
            source.parse_archive(gzip.compress(data))


class SourceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for name in ('vendor/glib-0.18.5', 'third-party/glib-0.18.5'):
            shutil.copytree(ROOT / name, self.root / name)
        self.vendor = self.root / 'vendor/glib-0.18.5'
        self.inputs = self.root / 'third-party/glib-0.18.5'

    def refuse(self):
        with self.assertRaises(ValueError):
            source.verify_source(self.root)

    def test_approved_source(self):
        result = source.verify_source(self.root)
        self.assertTrue(result['verified'])
        self.assertEqual(result['fileCount'], 121)
        self.assertEqual(result['version'], '0.18.5')
        self.assertEqual(result['patchedTreeSHA256'], '9e187d4f6bca0afa6c96a9db1dc76e379a2dd26bf3122d82fb928504e3943882')

    def test_extra_file(self):
        (self.vendor / 'extra').write_bytes(b'extra')
        self.refuse()

    def test_missing_file(self):
        (self.vendor / 'README.md').unlink()
        self.refuse()

    def test_extra_empty_directory(self):
        (self.vendor / 'extra').mkdir()
        self.refuse()

    def test_source_mutation(self):
        with (self.vendor / 'src/variant_iter.rs').open('ab') as handle:
            handle.write(b'\n')
        self.refuse()

    def test_notice_mutation(self):
        (self.vendor / 'COPYRIGHT').write_text('partial notice\n')
        self.refuse()

    def test_inventory_and_source_both_mutated(self):
        (self.vendor / 'LICENSE').write_text('replacement\n')
        inventory = source.inventory_tree(self.vendor)
        (self.inputs / 'patched-inventory.canonical.json').write_bytes(source.canonical(inventory))
        self.refuse()

    def test_symlink(self):
        p = self.vendor / 'src/variant_iter.rs'
        p.unlink()
        p.symlink_to(self.inputs / 'README.md')
        self.refuse()

    def test_symlink_parent(self):
        moved = self.root / 'real-vendor'
        (self.root / 'vendor').rename(moved)
        (self.root / 'vendor').symlink_to(moved, target_is_directory=True)
        self.refuse()

    def test_hardlink(self):
        os.link(self.vendor / 'LICENSE', self.root / 'other-license')
        self.refuse()

    def test_wrong_tree_mode(self):
        (self.vendor / 'LICENSE').chmod(0o600)
        self.refuse()

    def test_wrong_patch(self):
        (self.inputs / 'upstream-05dff0ee.patch').write_bytes(b'unknown patch')
        self.refuse()

    def test_partial_patch(self):
        p = self.vendor / 'src/variant_iter.rs'
        p.write_bytes(p.read_bytes().replace(b'&mut p,', b'&p,'))
        self.refuse()

    def test_changed_version(self):
        p = self.vendor / 'Cargo.toml'
        p.write_bytes(p.read_bytes().replace(b'version = "0.18.5"', b'version = "0.18.6"', 1))
        self.refuse()

    def test_unknown_provenance_file(self):
        (self.inputs / 'other').write_text('not reviewed')
        self.refuse()

    def test_cli_never_emits_success_on_failure(self):
        (self.vendor / 'LICENSE').unlink()
        output = self.root / 'evidence.json'
        output.write_text('{"verified":true}')
        run = subprocess.run([sys.executable, str(HERE / 'verify-glib-source.py'), '--repository', str(self.root), '--output', str(output)], capture_output=True)
        self.assertNotEqual(run.returncode, 0)
        self.assertFalse(output.exists())

    def test_no_digest_override(self):
        run = subprocess.run([sys.executable, str(HERE / 'verify-glib-source.py'), '--expected-archive-sha256', '0' * 64], capture_output=True)
        self.assertNotEqual(run.returncode, 0)


if __name__ == '__main__':
    unittest.main()
