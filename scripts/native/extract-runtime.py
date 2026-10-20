"""Extract a reviewed local runtime archive without links or path traversal."""
import os
from pathlib import Path, PurePosixPath
import shutil
import sys
import tarfile

archive, destination = sys.argv[1:]
root = Path(destination).resolve()
root.mkdir(parents=True, exist_ok=True)
with tarfile.open(archive, "r:") as source:
    members = source.getmembers()
    if len(members) > 20000 or sum(item.size for item in members) > 4 * 1024**3:
        raise ValueError("Runtime archive exceeds limits")
    seen = set()
    for item in members:
        name = item.name.removeprefix("./").rstrip("/")
        if not name and item.isdir():
            continue
        parts = PurePosixPath(name).parts
        if (not parts or name.startswith("/") or "\\" in name or ":" in name
                or any(part in (".", "..") for part in parts)
                or not (item.isfile() or item.isdir()) or name in seen):
            raise ValueError("Unsafe runtime archive entry")
        seen.add(name)
        target = root.joinpath(*parts)
        if not target.resolve().is_relative_to(root):
            raise ValueError("Runtime archive escapes destination")
        if item.isdir():
            target.mkdir(parents=True, exist_ok=True)
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        with source.extractfile(item) as data, target.open("xb") as output:
            shutil.copyfileobj(data, output)
        os.chmod(target, 0o755 if item.mode & 0o111 else 0o644)
