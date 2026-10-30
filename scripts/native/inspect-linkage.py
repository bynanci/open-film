#!/usr/bin/env python3
"""Inspect declared binaries without loading them or searching host libraries.

An executed receipt proves this bounded import-policy check. It is never an
installer, license, OS-portability or security approval on its own.
"""
import argparse
import hashlib
import json
import os
import re
import shutil
import stat
import subprocess
import sys
from pathlib import Path, PurePosixPath

LIMIT = 8 * 1024 * 1024


def file_hash(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for data in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(data)
    return digest.hexdigest()


def safe_path(value):
    if not isinstance(value, str) or not value or len(value) > 240 or "\\" in value or ":" in value:
        raise ValueError("unsafe binary destination")
    if value.startswith("/") or any(part in ("", ".", "..") or part.endswith((" ", ".")) or any(ord(c) < 32 for c in part) for part in value.split("/")):
        raise ValueError("unsafe binary destination")
    return value


def checked_file(root, value):
    safe_path(value)
    path = root
    for part in value.split("/"):
        path = path / part
        info = path.lstat()
        if stat.S_ISLNK(info.st_mode):
            raise ValueError("link in binary path")
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
        raise ValueError("binary must be an unlinked regular file")
    return path


def parse_linkage(platform, raw):
    if not isinstance(raw, str) or len(raw.encode()) > LIMIT:
        raise ValueError("missing or oversized tool observation")
    imports, runpaths, needed, provided = [], [], {}, []
    interpreter = None
    if platform == "linux":
        if re.search(r"\((?:FILTER|AUXILIARY|AUDIT|DEPAUDIT)\)", raw):
            raise ValueError("unmodeled ELF loader directive")
        machine = re.search(r"Machine:\s*(.+)", raw)
        architecture = {"Advanced Micro Devices X86-64": "x64", "AArch64": "arm64"}.get(machine.group(1).strip() if machine else "")
        imports = re.findall(r"\(NEEDED\).*?\[([^\]]+)\]", raw)
        for value in re.findall(r"\((?:RUNPATH|RPATH)\).*?\[([^\]]+)\]", raw):
            runpaths.extend(value.split(":"))
        match = re.search(r"Requesting program interpreter:\s*([^\]]+)", raw)
        interpreter = match.group(1).strip() if match else None
        current = None
        in_needs = False
        in_definitions = False
        for line in raw.splitlines():
            if line.startswith("Version needs section"):
                in_needs = True
                in_definitions = False
            elif line.startswith("Version definition section"):
                in_definitions = True
                in_needs = False
            elif line.startswith("Version "):
                in_needs = False
                in_definitions = False
            if in_definitions:
                match = re.search(r"Name:\s*(\S+)", line)
                if match:
                    provided.append(match.group(1))
            if in_needs:
                match = re.search(r"File:\s*(\S+)", line)
                if match:
                    current = match.group(1)
                    needed.setdefault(current, [])
                match = re.search(r"Name:\s*(\S+)", line)
                if match and current:
                    needed[current].append(match.group(1))
    elif platform == "win32":
        architecture = "x64" if re.search(r"8664 machine \(x64\)", raw, re.I) else "arm64" if re.search(r"AA64 machine \(ARM64\)", raw, re.I) else None
        in_dependencies = False
        for line in raw.splitlines():
            if re.search(r"following (?:delay load )?dependencies", line, re.I):
                in_dependencies = True
            elif line.strip() == "Summary":
                in_dependencies = False
            elif in_dependencies and re.fullmatch(r"\s+[^\s]+\.dll\s*", line, re.I):
                imports.append(line.strip())
            elif in_dependencies and line.strip():
                raise ValueError("unmodeled PE import record")
    elif platform == "darwin":
        if "Fat headers" in raw or "architecture " in raw:
            raise ValueError("unreviewed universal Mach-O")
        architecture = "arm64" if re.search(r"\bARM64\b", raw) else "x64" if re.search(r"\bX86_64\b", raw) else None
        imports = re.findall(r"^\s+(.+?) \(compatibility version .*\)$", raw, re.M)
        lines = raw.splitlines()
        for index, line in enumerate(lines):
            if line.strip() == "cmd LC_ID_DYLIB":
                for value in lines[index + 1:index + 5]:
                    match = re.search(r"name (.+?) \(offset \d+\)", value)
                    if match and match.group(1) in imports:
                        imports.remove(match.group(1))
            if line.strip() == "cmd LC_RPATH":
                for value in lines[index + 1:index + 5]:
                    match = re.search(r"path (.+?) \(offset \d+\)", value)
                    if match:
                        runpaths.append(match.group(1))
    else:
        raise ValueError("unsupported platform")
    if architecture is None:
        raise ValueError("missing or unsupported binary architecture")
    if len(imports) != len(set(imports)) or len(imports) > 512:
        raise ValueError("duplicate or oversized import inventory")
    return {"architecture": architecture, "imports": imports, "runpaths": runpaths, "symbolVersions": needed, "interpreter": interpreter, "providedSymbolVersions": provided}


def loader_path(importer, value, platform):
    prefix = "$ORIGIN" if platform == "linux" else "@loader_path"
    value = value.replace("${ORIGIN}", "$ORIGIN")
    if value != prefix and not value.startswith(prefix + "/"):
        raise ValueError("unreviewed loader path")
    tail = value[len(prefix):].lstrip("/")
    if tail:
        safe_path(tail)
    path = str(PurePosixPath(importer).parent / tail)
    return safe_path(path)


def inspect_observations(root, policy, observations, *, observation_mode="fixture", tool=None, policy_file_sha256=None):
    root = Path(root)
    if root.is_symlink():
        raise ValueError("linked runtime root")
    if policy.get("schemaVersion") != 1 or policy.get("platform") not in ("linux", "win32", "darwin") or policy.get("architecture") not in ("x64", "arm64"):
        raise ValueError("invalid linkage policy")
    baseline = policy.get("baseline", {})
    if any(not isinstance(baseline.get(key), str) or not baseline[key].strip() for key in ("os", "build", "architecture", "abi")) or baseline["architecture"] != policy["architecture"]:
        raise ValueError("explicit OS/build/architecture/ABI baseline required")
    files, entries = policy.get("files", {}), policy.get("entrypoints", [])
    if not isinstance(files, dict) or not 1 <= len(files) <= 256 or not isinstance(entries, list) or not entries or len(entries) != len(set(entries)):
        raise ValueError("bounded explicit binary inventory required")
    if len({path.lower() for path in files}) != len(files):
        raise ValueError("case-colliding binaries")
    for path, digest in files.items():
        if not re.fullmatch(r"[a-f0-9]{64}", str(digest)) or file_hash(checked_file(root, path)) != digest:
            raise ValueError("binary hash mismatch")
    systems = policy.get("systemImports", {})
    if not isinstance(systems, dict) or len(systems) > 512:
        raise ValueError("explicit system allowlist required")
    for name, receipt in systems.items():
        if not name or not isinstance(receipt, dict) or not receipt.get("reason") or not isinstance(receipt.get("symbolVersions"), list):
            raise ValueError("system import needs reviewed ABI evidence")
        if any(token in name for token in ("*", "?", "\\")):
            raise ValueError("system imports cannot be patterns")
        if "/" in name and not (policy["platform"] == "darwin" and name.startswith(("/usr/lib/", "/System/Library/"))) and not (policy["platform"] == "linux" and name.startswith(("/lib/", "/lib64/", "/usr/lib/"))):
            raise ValueError("developer path cannot be a system baseline")
    records, seen, pending = [], set(), list(entries)
    while pending:
        path = safe_path(pending.pop(0))
        if path in seen:
            continue
        if path not in files or path not in observations:
            raise ValueError("missing recursive import observation")
        seen.add(path)
        parsed = parse_linkage(policy["platform"], observations[path])
        if parsed["architecture"] != policy["architecture"]:
            raise ValueError("binary architecture mismatch")
        search = [] if policy["platform"] == "linux" else [str(PurePosixPath(path).parent)]
        search += [loader_path(path, value, policy["platform"]) for value in parsed["runpaths"]]
        resolved = []
        imports = parsed["imports"] + ([parsed["interpreter"]] if parsed["interpreter"] else [])
        for name in imports:
            system_name = next((allowed for allowed in systems if allowed == name or policy["platform"] == "win32" and allowed.casefold() == name.casefold()), None)
            candidates = []
            if name.startswith("@loader_path/"):
                candidates = [loader_path(path, name, "darwin")]
            elif name.startswith("@rpath/") and policy["platform"] == "darwin":
                suffix = safe_path(name[len("@rpath/"):])
                candidates = [safe_path(folder + "/" + suffix) for folder in search[1:]]
            elif "/" not in name and "\\" not in name:
                if policy["platform"] == "darwin" and system_name is None:
                    raise ValueError("unreviewed Mach-O install name")
                safe_path(name)
                candidates = [safe_path(folder + "/" + name) for folder in search]
            elif system_name is None:
                raise ValueError("absolute/developer or unsupported import path")
            matches = [candidate for candidate in candidates if candidate in files]
            if policy["platform"] == "win32":
                matches = [declared for declared in files if any(candidate.casefold() == declared.casefold() for candidate in candidates)]
            matches = list(dict.fromkeys(matches))
            if len(matches) > 1 or matches and system_name is not None:
                raise ValueError("ambiguous bundled/system import")
            if matches:
                imported = parse_linkage(policy["platform"], observations.get(matches[0], ""))
                if not set(parsed["symbolVersions"].get(name, [])).issubset(imported["providedSymbolVersions"]):
                    raise ValueError("bundled import does not provide required symbol versions")
                pending.append(matches[0]); resolved.append({"import":name,"kind":"bundled","path":matches[0]})
            elif system_name is not None:
                required = parsed["symbolVersions"].get(name, [])
                if not set(required).issubset(systems[system_name]["symbolVersions"]):
                    raise ValueError("system symbol versions exceed reviewed baseline")
                resolved.append({"import":name,"kind":"system","baselineImport":system_name,"requiredSymbolVersions":required})
            else:
                raise ValueError("unresolved import: " + name)
        records.append({"path":path,"sha256":files[path],**parsed,"resolved":resolved,"raw":observations[path]})
    if seen != set(files):
        raise ValueError("declared native binary was not inspected from any entrypoint")
    return {"schemaVersion":1,"verified":True,"distributionApproved":False,"observationMode":observation_mode,"platform":policy["platform"],"architecture":policy["architecture"],"baseline":baseline,"policySha256":hashlib.sha256(json.dumps(policy,sort_keys=True,separators=(",",":")).encode()).hexdigest(),"policyFileSha256":policy_file_sha256,"tool":tool,"binaries":records}


def inspect_linkage(root: Path, policy: dict, *, policy_file_sha256=None):
    platform = {"linux":"linux","win32":"win32","darwin":"darwin"}.get(sys.platform)
    if platform != policy.get("platform"):
        raise ValueError("execute linkage inspection on the target OS")
    program = {"linux":"readelf","win32":"dumpbin","darwin":"otool"}[platform]
    executable = shutil.which(program)
    if not executable:
        raise ValueError("target inspection tool unavailable: " + program)
    commands = {"linux":[["--file-header","--program-headers","--dynamic","--version-info"]],"win32":[["/HEADERS","/DEPENDENTS"]],"darwin":[["-hv"],["-L"],["-l"]]}[platform]
    observations, executions = {}, []
    for path in policy.get("files", {}):
        checked_file(root,path)
        raw = []
        for options in commands:
            arguments = [*options,path]
            result = subprocess.run([executable,*arguments],cwd=root,capture_output=True,timeout=30,check=False)
            if len(result.stdout) + len(result.stderr) > LIMIT:
                raise ValueError("oversized inspection output")
            executions.append({"binary":path,"arguments":arguments,"exitCode":result.returncode,"stdout":result.stdout.decode(errors="strict"),"stderr":result.stderr.decode(errors="strict")})
            if result.returncode:
                raise ValueError("inspection tool failed: " + path)
            raw.append(result.stdout.decode(errors="strict"))
        observations[path] = "\n".join(raw)
    version_args = ["--version"] if platform == "linux" else ["/?"] if platform == "win32" else ["-h"]
    version = subprocess.run([executable,*version_args],capture_output=True,timeout=10,check=False)
    tool = {"name":program,"sha256":file_hash(Path(executable).resolve()),"versionArguments":version_args,"versionExitCode":version.returncode,"versionStdout":version.stdout.decode(errors="replace")[:65536],"versionStderr":version.stderr.decode(errors="replace")[:65536],"executions":executions}
    return inspect_observations(root,policy,observations,observation_mode="executed",tool=tool,policy_file_sha256=policy_file_sha256)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", required=True, type=Path)
    parser.add_argument("--policy", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    raw = args.policy.read_bytes()
    if len(raw) > LIMIT:
        raise ValueError("oversized policy")
    evidence = inspect_linkage(args.root,json.loads(raw),policy_file_sha256=hashlib.sha256(raw).hexdigest())
    with args.output.open("x",encoding="utf8") as output:
        json.dump(evidence,output,indent=2); output.write("\n")


if __name__ == "__main__":
    main()
