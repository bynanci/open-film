# SPDX-License-Identifier: Apache-2.0
"""Private synthetic protocol fixture; never OS evidence or distribution approval."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

REPO = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("admission_tests", REPO / "scripts/security/test-native-admission.py")
tests = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tests)
policy = tests.m
root = Path(sys.argv[1])
root.mkdir(parents=True, exist_ok=True)

def git(directory, *args):
    return subprocess.check_output(["git", "-c", "user.name=Synthetic Fixture", "-c", "user.email=fixture@example.invalid", *args], cwd=directory, text=True).strip()

def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(policy.source.canonical(value))

for name in ("vendor/glib-0.18.5", "third-party/glib-0.18.5"):
    shutil.copytree(REPO / name, root / name)
for folder, _, files in os.walk(root):
    Path(folder).chmod(0o755)
    for name in files: (Path(folder) / name).chmod(0o644)
app = root / policy.closure.APP
app.mkdir(parents=True)
for name in ("Cargo.lock", "Cargo.toml"):
    shutil.copyfile(REPO / policy.closure.APP / name, app / name)
(root / ".gitignore").write_text("evidence/\n")
git(root, "init", "-q")
git(root, "add", ".")
git(root, "commit", "-qm", "Synthetic source fixture")
candidate = git(root, "rev-parse", "HEAD")
source = policy.source.verify_source(root)
metadata = dict(version=1, workspace_root=str(app), workspace_members=["root"], resolve=dict(root="root", nodes=[]), packages=[])
packages = [("root", "openfilm-desktop", "1.0.0", None, str(app / "Cargo.toml")), ("glib", "glib", "0.18.5", None, str(root / policy.source.VENDOR / "Cargo.toml"))]
packages += [(name, name, version, policy.REGISTRY, str(root / "cache" / name / "Cargo.toml")) for name, version in policy.closure.FAMILY.items() if name != "glib"]
for identity, name, version, origin, path in packages:
    metadata["packages"].append(dict(id=identity, name=name, version=version, source=origin, manifest_path=path))
    deps = [dict(name=n.replace("-", "_"), pkg=n, dep_kinds=[dict(kind=None, target=None)]) for n in policy.closure.FAMILY] if identity == "root" else []
    metadata["resolve"]["nodes"].append(dict(id=identity, features=[], deps=deps, dependencies=[d["pkg"] for d in deps]))
lock = (app / "Cargo.lock").read_bytes()
closure = policy.closure.verify_closure(metadata, lock, root, source)
closure["candidateSHA"] = candidate
fixture = tests.AdmissionTests()
fixture.setUp()
_, _, regression, audit = fixture.fixture()
for item in (regression, audit):
    item.update(candidateSHA=candidate, lockSHA256=policy.source.sha(lock), sourceSHA256=policy.source.sha(policy.source.canonical(source)))
regression["expectedSourceSHA256"] = regression["sourceSHA256"]
evidence = root / "evidence"
ad = evidence / "audit"
db = ad / "advisory-db"
db.mkdir(parents=True)
(db / "SYNTHETIC-NOT-AN-ADVISORY-DATABASE").write_text("Synthetic structural test only\n")
git(db, "init", "-q")
git(db, "add", ".")
git(db, "commit", "-qm", "Synthetic database identity")
audit["dbCommit"] = git(db, "rev-parse", "HEAD")
git(db, "bundle", "create", str(ad / "advisory-db.bundle"), "HEAD")
for name, report in audit["reports"].items():
    raw = policy.source.canonical(report.pop("raw"))
    report.pop("stderr")
    report.pop("validatedBytes")
    report.update(dbCommit=audit["dbCommit"], stdoutFile=name + ".stdout", stderrFile=name + ".stderr", stdoutSHA256=policy.source.sha(raw), stderrSHA256=policy.source.sha(b""), seconds=1.0)
    (ad / (name + ".stdout")).write_bytes(raw)
    (ad / (name + ".stderr")).write_bytes(b"")
registry = copy.deepcopy(metadata)
registry["packages"][1]["source"] = policy.REGISTRY
registry_lock = lock.replace(b'name = "glib"\nversion = "0.18.5"\n', ('name = "glib"\nversion = "0.18.5"\nsource = "' + policy.REGISTRY + '"\nchecksum = "' + policy.source.ARCHIVE_SHA + '"\n').encode())
(ad / "current-registry-Cargo.lock").write_bytes(registry_lock)
(ad / "historical-Cargo.lock").write_bytes((root / policy.source.INPUTS / "original-registry-Cargo.lock").read_bytes())
for path, value in ((evidence / "source.json", source), (evidence / "closure.json", closure), (evidence / "controls/regression.json", regression), (evidence / "metadata.json", metadata), (ad / "audit.json", audit), (ad / "actual-metadata.stdout", metadata), (ad / "current-registry-metadata.stdout", registry)):
    save(path, value)
# Expected admission is produced by the original complete CLI, not a hand-built
# optimistic result. Every byte remains synthetic structural fixture evidence.
subprocess.run([sys.executable, str(REPO / "scripts/security/native-admission.py"), "--repository", str(root), "--evidence-dir", str(evidence), "--output", str(evidence / "admission.json")], check=True, stdout=subprocess.DEVNULL)
print(candidate)
