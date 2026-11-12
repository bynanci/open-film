# SPDX-License-Identifier: Apache-2.0
"""Materialize pinned originals and reuse the COMPLETE native admission boundary."""
import base64
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import sys
import tempfile

POLICY = Path(__file__).resolve().parents[1] / "security/native-admission.py"
spec = importlib.util.spec_from_file_location("native_admission", POLICY)
policy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(policy)


def preflight_source_path(repository, metadata):
    # This is an explicit constraint, not a relocation adapter. Do not change
    # original bytes/IDs or replace the complete closure checks below.
    app = repository / policy.closure.APP
    packages = metadata["packages"]
    root = [p for p in packages if p["id"] == metadata["resolve"]["root"]]
    glib = [p for p in packages if p["name"] == "glib"]
    policy.require(
        metadata["workspace_root"] == str(app)
        and len(root) == 1 and root[0]["manifest_path"] == str(app / "Cargo.toml")
        and len(glib) == 1 and glib[0]["manifest_path"] == str(repository / policy.source.VENDOR / "Cargo.toml"),
        "Source admission requires its original absolute checkout path: workspace_root and root/GLib manifest paths must match this Linux checkout. Use a fresh isolated runner at the reviewed original path; do not rewrite pinned metadata or overwrite an existing checkout.",
    )


def replay(repository, value):
    policy.require(set(value) == {"schemaVersion", "files"} and value["schemaVersion"] == 1, "unknown security replay schema")
    files = value["files"]
    policy.require(isinstance(files, dict) and len(files) <= 128, "security snapshot file limit")
    with tempfile.TemporaryDirectory(prefix="openfilm-admission-replay-") as private:
        directory = Path(private)
        total = 0
        for name, encoded in files.items():
            path = PurePosixPath(name)
            policy.require(isinstance(name, str) and name and not path.is_absolute() and str(path) == name and not any(p in (".", "..") for p in path.parts) and "\\" not in name and ":" not in name, "security snapshot path escape")
            data = base64.b64decode(encoded, validate=True)
            total += len(data)
            policy.require(len(data) <= 8 * 1024 ** 2 and total <= 32 * 1024 ** 2, "security snapshot byte limit")
            output = directory / name
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_bytes(data)
        preflight_source_path(repository, json.loads((directory / "metadata.json").read_bytes(), object_pairs_hook=policy.no_duplicates))
        audit = json.loads((directory / "audit/audit.json").read_bytes(), object_pairs_hook=policy.no_duplicates)
        policy.auditor.restore_advisory_snapshot(directory / "audit", directory / "audit/advisory-db", audit)
        result = policy.verify_admission(repository, directory)
        policy.require(result["admission"] == "pass", "native security replay blocked: " + "; ".join(result["reasons"]))
        return result


if __name__ == "__main__":
    isolated = policy.auditor.advisory_git_environment()
    os.environ.clear()
    os.environ.update(isolated)
    data = sys.stdin.buffer.read(48 * 1024 ** 2 + 1)
    policy.require(len(data) <= 48 * 1024 ** 2, "security replay byte limit")
    value = json.loads(data, object_pairs_hook=policy.no_duplicates)
    print(json.dumps(replay(Path(sys.argv[1]).resolve(), value), sort_keys=True, separators=(",", ":"), ensure_ascii=False))
