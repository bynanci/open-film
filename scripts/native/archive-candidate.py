"""Preserve installer modes and macOS bundle links across Actions uploads."""
import hashlib
from pathlib import Path
import sys
import tarfile

bundle, output = map(Path, sys.argv[1:])
bundle = bundle.resolve(strict=True)
output = output.resolve()
if not bundle.is_dir() or output.is_relative_to(bundle):
    raise ValueError("Installer archive must be outside the bundle directory")
output.parent.mkdir(parents=True, exist_ok=True)
with tarfile.open(output, "x", dereference=False) as archive:
    archive.add(bundle, arcname="bundle")
digest = hashlib.sha256()
with output.open("rb") as source:
    for chunk in iter(lambda: source.read(1024 * 1024), b""):
        digest.update(chunk)
output.with_suffix(output.suffix + ".sha256").write_text(
    digest.hexdigest() + "  " + output.name + "\n"
)
