#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Verify the reviewed, complete GLib 0.18.5 source. Constants are review anchors."""
import argparse
import gzip
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import stat
import subprocess
import sys
import tempfile

ARCHIVE_SHA = '233daaf6e83ae6a12a52055f568f9d7cf4671dabb78ff9560ab6da230ce00ee5'
PATCH_SHA = 'a742bf59f1b00af0f434623b34e2fd969dc8697d37c796efdf909dd9eb19b854'
PRISTINE_SHA = '2a95cf8a0a2cc534f828c9b6bf78fb9b5ffb41f356608e902144a8da3eb1fc0f'
PATCHED_SHA = '9e187d4f6bca0afa6c96a9db1dc76e379a2dd26bf3122d82fb928504e3943882'
LOCK_SHA = '2e36795c727a50337aa8fe7aa9b20a40bedd99ecf53c265036ae07f13b6c0698'
LOCK_BLOB = 'b4b8b94363f731001e2b42bf74778d79f725a1e4'
BASE = '73f9df9810770d52cab0cc2978e55ef8301f884e'
VENDOR = 'vendor/glib-0.18.5'
INPUTS = 'third-party/glib-0.18.5'
# README/provenance anchors are filled when materializing the approved inputs.
INPUT_HASHES = {
    'glib-0.18.5.crate': ARCHIVE_SHA,
    'upstream-05dff0ee.patch': PATCH_SHA,
    'pristine-inventory.canonical.json': PRISTINE_SHA,
    'patched-inventory.canonical.json': PATCHED_SHA,
    'original-registry-Cargo.lock': LOCK_SHA,
    'provenance.json': '6701fdbdde8d2ecac25a4ded0898200a0c8e85269a8bc47999ffd97cdcd67cb0',
    'README.md': '05595e1c92d0592d83133b15546c2d2f0c6c76ce8e7e68e28c76ec1df1e348d4',
}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def canonical(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False) + '\n').encode()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def safe_path(name):
    require(name and not name.startswith('/') and '\\' not in name and ':' not in name, 'unsafe path')
    parts = name.split('/')
    require(all(p not in ('', '.', '..') and not p.endswith((' ', '.')) for p in parts), 'unsafe path component')
    require(len(parts) <= 16, 'path depth limit')
    require(len(name.encode('utf-8')) <= 240, 'path length limit')
    require(all(not any(ord(c) < 32 for c in p) for p in parts), 'unsafe path character')
    return parts


def parse_archive(data):
    """Bounded USTAR parser; tests call this before artifact trust validation.

    Only the archive's actual format is accepted: regular files, no extension
    records, exactly one root. Never delegates extraction to tar or follows links.
    """
    require(len(data) <= 400_000, 'compressed archive size limit')
    try:
        with gzip.GzipFile(fileobj=io.BytesIO(data)) as stream:
            raw = stream.read(3_000_001)
    except (OSError, EOFError) as exc:
        raise ValueError('invalid gzip archive') from exc
    require(len(raw) <= 3_000_000, 'expanded archive limit')
    offset, expanded, records = 0, 0, {}
    spellings = {}
    while offset + 512 <= len(raw):
        header = raw[offset:offset + 512]
        if header == bytes(512):
            require(raw[offset:] == bytes(len(raw) - offset), 'nonzero archive trailer')
            require(len(raw) - offset >= 1024, 'missing tar end blocks')
            break
        require(header[156:157] in (b'0', b'\0'), 'archive member must be regular')
        try:
            checksum = int(header[148:156].strip(b'\0 '), 8)
            require(sum(header[:148]) + 256 + sum(header[156:]) == checksum, 'tar checksum mismatch')
            mode = int(header[100:108].strip(b'\0 '), 8)
            size = int(header[124:136].strip(b'\0 '), 8)
            name = header[:100].split(b'\0', 1)[0].decode('utf-8')
            prefix = header[345:500].split(b'\0', 1)[0].decode('utf-8')
        except (UnicodeError, ValueError) as exc:
            raise ValueError('invalid tar header/checksum') from exc
        require(header[257:263] in (b'ustar\0', b'ustar '), 'unsupported tar format')
        require(mode == 0o644, 'unexpected archive mode')
        name = prefix + '/' + name if prefix else name
        parts = safe_path(name)
        require(parts[0] == 'glib-0.18.5' and len(parts) > 1, 'unexpected archive root path')
        path = '/'.join(parts[1:])
        require(path not in records, 'duplicate archive member')
        for i in range(1, len(parts)):
            spelling = '/'.join(parts[1:i + 1])
            folded = spelling.casefold()
            require(folded not in spellings or spellings[folded] == spelling, 'case colliding path')
            spellings[folded] = spelling
        require(len(records) < 128, 'archive member count limit')
        expanded += size
        require(0 <= size <= 1_717_584 and expanded <= 1_717_584, 'expanded member byte limit')
        offset += 512
        require(offset + size <= len(raw), 'truncated archive member')
        records[path] = raw[offset:offset + size]
        offset += ((size + 511) // 512) * 512
    else:
        raise ValueError('missing archive terminator')
    require(bool(records), 'empty archive')
    for path in records:
        require(not any(str(parent) in records for parent in PurePosixPath(path).parents if str(parent) != '.'), 'file/directory path collision')
    return records


def file_inventory(files):
    return [dict(path=p, type='file', mode='0644', size=len(files[p]), sha256=sha(files[p]))
            for p in sorted(files, key=lambda x: x.encode('utf-8'))]


def no_link_parents(path):
    path = path.absolute()
    for component in (path, *path.parents):
        require(not component.is_symlink(), f'linked parent: {component}')
    return path


def inventory_tree(root):
    no_link_parents(root)
    require(root.is_dir(), f'missing tree: {root}')
    files, directories = {}, set()
    for directory, names, filenames in os.walk(root, followlinks=False):
        for name in names + filenames:
            path = Path(directory) / name
            relative = path.relative_to(root).as_posix()
            safe_path(relative)
            info = path.lstat()
            require(not stat.S_ISLNK(info.st_mode), f'link in tree: {relative}')
            if stat.S_ISDIR(info.st_mode):
                directories.add(relative)
                if sys.platform.startswith('linux'):
                    require(stat.S_IMODE(info.st_mode) == 0o755, f'wrong directory mode: {relative}')
            else:
                require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1, f'special or hardlinked file: {relative}')
                if sys.platform.startswith('linux'):
                    require(stat.S_IMODE(info.st_mode) == 0o644, f'wrong file mode: {relative}')
                files[relative] = path.read_bytes()
    implied = {str(parent) for p in files for parent in PurePosixPath(p).parents if str(parent) != '.'}
    require(directories == implied, 'unexpected/missing/empty tree directory')
    folded = [p.casefold() for p in files.keys() | directories]
    require(len(folded) == len(set(folded)), 'case colliding tree')
    return file_inventory(files)


def write_tree(root, files):
    root.mkdir(parents=True, exist_ok=True)
    root.chmod(0o755)
    for relative, data in files.items():
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        for parent in path.parents:
            if parent == root:
                break
            parent.chmod(0o755)
        path.write_bytes(data)
        path.chmod(0o644)


def reconstruct(inputs, destination):
    archive = (inputs / 'glib-0.18.5.crate').read_bytes()
    require(sha(archive) == ARCHIVE_SHA, 'archive trust anchor mismatch')
    pristine = parse_archive(archive)
    require(len(pristine) == 121 and sum(map(len, pristine.values())) == 1717584, 'unexpected archive inventory')
    require(sha(canonical(file_inventory(pristine))) == PRISTINE_SHA, 'pristine tree mismatch')
    write_tree(destination, pristine)
    patch = (inputs / 'upstream-05dff0ee.patch').read_bytes()
    require(sha(patch) == PATCH_SHA, 'patch trust anchor mismatch')
    process = subprocess.run(['patch', '--batch', '--fuzz=0', '--no-backup-if-mismatch', '-p2'],
                             input=patch, cwd=destination, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    require(process.returncode == 0 and process.stdout.splitlines() == [b'patching file src/variant_iter.rs'] and not process.stderr,
            'patch did not apply exactly (offset/fuzz/reject forbidden)')
    inventory = inventory_tree(destination)
    require(sha(canonical(inventory)) == PATCHED_SHA, 'reconstructed patched tree mismatch')
    return inventory


def verify_source(repository):
    repository = no_link_parents(Path(repository).absolute())
    inputs, vendor = repository / INPUTS, repository / VENDOR
    inventory = inventory_tree(inputs)
    require({i['path']: i['sha256'] for i in inventory} == INPUT_HASHES, 'provenance input inventory mismatch')
    original = (inputs / 'original-registry-Cargo.lock').read_bytes()
    require(hashlib.sha1(b'blob ' + str(len(original)).encode() + b'\0' + original).hexdigest() == LOCK_BLOB, 'original lock Git blob mismatch')
    with tempfile.TemporaryDirectory(prefix='openfilm-glib-source-') as private:
        expected = reconstruct(inputs, Path(private) / 'expected')
    require(canonical(expected) == (inputs / 'patched-inventory.canonical.json').read_bytes(), 'supplied patched inventory mismatch')
    pristine = file_inventory(parse_archive((inputs / 'glib-0.18.5.crate').read_bytes()))
    require(canonical(pristine) == (inputs / 'pristine-inventory.canonical.json').read_bytes(), 'supplied pristine inventory mismatch')
    actual = inventory_tree(vendor)
    require(actual == expected, 'vendored source differs from exact reviewed reconstruction')
    return dict(schemaVersion=1, verified=True, archiveSHA256=ARCHIVE_SHA, patchSHA256=PATCH_SHA,
                pristineTreeSHA256=PRISTINE_SHA, patchedTreeSHA256=PATCHED_SHA, fileCount=121,
                vendor=VENDOR, version='0.18.5', linuxModesVerified=sys.platform.startswith('linux'))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repository', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    args.output.unlink(missing_ok=True)
    try:
        evidence = verify_source(args.repository)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_bytes(canonical(evidence))
    except (ValueError, OSError, subprocess.SubprocessError) as exc:
        print(f'GLib source refused: {exc}', file=sys.stderr)
        return 1
    print('Verified complete GLib 0.18.5 source; upstream version remains affected.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
