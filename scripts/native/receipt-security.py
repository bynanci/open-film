# SPDX-License-Identifier: Apache-2.0
"""Replay existing native security policy; no scanner/signature results invented."""
import importlib.util
import json
from pathlib import Path
import sys

POLICY = Path(__file__).resolve().parents[1] / "security/native-admission.py"
spec = importlib.util.spec_from_file_location("native_admission", POLICY)
policy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(policy)


def replay(repository, value):
    raw_scans = value.pop("scans")
    value = {key: json.loads(raw, object_pairs_hook=policy.no_duplicates) for key, raw in value.items()}
    for name, report in value["audit"]["reports"].items():
        report["raw"] = policy.parse_raw(raw_scans[name]["stdout"])
        report["stderr"] = raw_scans[name]["stderr"]
        report["validatedBytes"] = True
    source = policy.source.verify_source(repository)
    policy.require(source == value["source"], "source admission differs from actual checkout")
    lock = (repository / policy.closure.APP / "Cargo.lock").read_bytes()
    closure = policy.closure.verify_closure(value["metadata"], lock, repository, source)
    policy.require(all(value["closure"].get(k) == v for k, v in closure.items()), "retained closure differs from actual source/metadata")
    for report in value["audit"]["reports"].values():
        policy.validate_shape(report["raw"])
    result = policy.evaluate_native(value["source"], value["closure"], value["regression"], value["audit"])
    policy.require(result["admission"] == "pass", "native security replay blocked: " + "; ".join(result["reasons"]))
    return result


if __name__ == "__main__":
    data = sys.stdin.buffer.read(32 * 1024 ** 2 + 1)
    policy.require(len(data) <= 32 * 1024 ** 2, "security replay byte limit")
    value = json.loads(data, object_pairs_hook=policy.no_duplicates)
    print(json.dumps(replay(Path(sys.argv[1]).resolve(), value), sort_keys=True, separators=(",", ":"), ensure_ascii=False))
