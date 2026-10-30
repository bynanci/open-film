# SPDX-License-Identifier: Apache-2.0
"""Extract only bounded regular files from a previously hash-verified Gyan ZIP."""
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import sys
import zipfile


def extract(archive, output):
    with zipfile.ZipFile(archive) as source:
        entries = source.infolist()
        if not entries or len(entries) > 5000:
            raise ValueError("Invalid tool archive inventory")
        seen = set()
        total = 0
        for entry in entries:
            name = entry.filename
            path = PurePosixPath(name)
            if (not name or "\\" in name or path.is_absolute() or
                    any(part in ("", ".", "..") or ":" in part or
                        part.rstrip(" .") != part or
                        re.match(r"^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(?:\.|$)", part, re.I)
                        for part in name.rstrip("/").split("/")) or
                    name.rstrip("/").casefold() in seen):
                raise ValueError("Unsafe or ambiguous tool archive path")
            seen.add(name.rstrip("/").casefold())
            mode = entry.external_attr >> 16
            if stat.S_IFMT(mode) not in (0, stat.S_IFREG, stat.S_IFDIR):
                raise ValueError("Unexpected tool archive link or special file")
            total += entry.file_size
            if entry.file_size > 256 * 1024 ** 2 or total > 512 * 1024 ** 2:
                raise ValueError("Tool archive exceeds resource limits")
        output.mkdir()
        try:
            for entry in entries:
                target = output.joinpath(*PurePosixPath(entry.filename).parts)
                if entry.is_dir():
                    target.mkdir(parents=True, exist_ok=True)
                    continue
                target.parent.mkdir(parents=True, exist_ok=True)
                with source.open(entry) as reader, target.open("xb") as writer:
                    shutil.copyfileobj(reader, writer, 1024 * 1024)
                if target.stat().st_size != entry.file_size:
                    raise ValueError("Tool archive entry size changed")
        except BaseException:
            shutil.rmtree(output)
            raise


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("Usage: extract-render-qa-tools.py <verified-zip> <new-output>")
    extract(Path(sys.argv[1]), Path(os.path.abspath(sys.argv[2])))
