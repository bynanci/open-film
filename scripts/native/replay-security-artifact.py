# SPDX-License-Identifier: Apache-2.0
"""Replay authenticated retained source evidence; never a distribution approval.

Only reviewed tool policy executes. Artifact bytes and candidate code are data.
"""
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import struct
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile

ZIP_BYTES = 200 * 1024**2
ZIP_TOTAL = 300 * 1024**2
ZIP_ENTRIES = 10000
RAW_BYTES = 8 * 1024**2
TOTAL_BYTES = 32 * 1024**2
PAYLOAD_BYTES = 48 * 1024**2


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def parse_json(data):
    def unique(items):
        result = {}
        for key, value in items:
            require(key not in result, 'Duplicate JSON key')
            result[key] = value
        return result
    return json.loads(data, object_pairs_hook=unique,
                      parse_constant=lambda _: (_ for _ in ()).throw(ValueError('Nonfinite JSON value')))


def verify_transport(run, artifact, workflow, expected):
    repo = dict(id=expected['repository_id'], full_name=expected['repository'])
    paths = ('.github/workflows/security.yml', '.github/workflows/native-security.yml')
    require(run.get('id') == expected['source_run_id'] and
            run.get('workflow_id') == workflow.get('id') == expected['source_workflow_id'] and
            run.get('head_sha') == expected['candidate_sha'] and
            run.get('status') == 'completed' and run.get('conclusion') == 'success' and
            type(run.get('run_attempt')) is int and run['run_attempt'] > 0 and
            run.get('path') == workflow.get('path') and run['path'] in paths and
            all(run.get(key, {}).get(field) == value for key in ('repository', 'head_repository') for field, value in repo.items()),
            'Source run/workflow/repository identity mismatch')
    if run['path'] == paths[0]:
        require(any(x.get('sha') == expected['candidate_sha'] and
                    x.get('path') == expected['repository'] + '/' + paths[1] + '@' + expected['candidate_sha']
                    for x in run.get('referenced_workflows', [])), 'Source native workflow reference mismatch')
    require(artifact.get('id') == expected['source_artifact_id'] and
            artifact.get('name') == 'native-security-' + expected['candidate_sha'] and artifact.get('expired') is False and
            artifact.get('digest') == 'sha256:' + expected['source_archive_sha256'] and
            type(artifact.get('size_in_bytes')) is int and 0 < artifact['size_in_bytes'] <= ZIP_BYTES and
            all(artifact.get('workflow_run', {}).get(k) == v for k, v in dict(
                id=expected['source_run_id'], head_sha=expected['candidate_sha'], repository_id=expected['repository_id'],
                head_repository_id=expected['repository_id']).items()), 'Source artifact identity/digest/size mismatch')


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def fetch(url, token, maximum, output=None):
    """Manual redirects: credentials go to API only; storage URLs never logged."""
    opener = urllib.request.build_opener(NoRedirect(), urllib.request.ProxyHandler({}))
    deadline = time.monotonic() + 180
    sink = io.BytesIO() if output is None else output.open('xb')
    with sink:
        for redirect in range(4):
            parsed = urllib.parse.urlsplit(url)
            api = parsed.hostname == 'api.github.com'
            storage = bool(re.fullmatch(r'productionresultssa[a-z0-9]*\.blob\.core\.windows\.net', parsed.hostname or ''))
            require(parsed.scheme == 'https' and not parsed.username and not parsed.password and
                    parsed.port is None and not parsed.fragment and (api or storage), 'Unsafe download destination')
            require(redirect == 0 or not api, 'Redirect back to API refused')
            headers = {'Accept': 'application/vnd.github+json', 'User-Agent': 'openfilm-source-replay'}
            if api:
                headers['Authorization'] = 'Bearer ' + token
                headers['X-GitHub-Api-Version'] = '2022-11-28'
            try:
                try:
                    response = opener.open(urllib.request.Request(url, headers=headers), timeout=30)
                except urllib.error.HTTPError as error:
                    response = error
                with response:
                    if response.status in (301, 302, 303, 307, 308):
                        require(redirect < 3 and response.headers.get('Location'), 'Download redirect limit')
                        url = response.headers['Location']
                        continue
                    require(response.status == 200, 'Authenticated download failed')
                    size = 0
                    while True:
                        require(time.monotonic() <= deadline, 'Download time limit')
                        chunk = response.read(min(1024**2, maximum - size + 1))
                        if not chunk:
                            return sink.getvalue() if output is None else None
                        size += len(chunk)
                        require(size <= maximum, 'Download byte limit')
                        sink.write(chunk)
            except (urllib.error.URLError, OSError, TimeoutError):
                raise ValueError('Download transport failed') from None
        raise ValueError('Download redirect limit')


def regular(path, maximum):
    for parent in [path, *path.parents]:
        require(not parent.is_symlink(), 'Symlink input/parent')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as source:
        info = os.fstat(source.fileno())
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_size <= maximum, 'Input type/link/byte limit')
        data = source.read(maximum + 1)
        after = os.fstat(source.fileno())
    current = path.lstat()
    keys = ('st_dev', 'st_ino', 'st_mode', 'st_nlink', 'st_size', 'st_mtime_ns', 'st_ctime_ns')
    require(len(data) == info.st_size and len(data) <= maximum and
            all(getattr(after, key) == getattr(info, key) == getattr(current, key) for key in keys),
            'Input changed during read')
    return data


def safe_name(name, directory=False):
    value = name[:-1] if directory and name.endswith('/') else name
    path = PurePosixPath(value)
    require(value and not path.is_absolute() and str(path) == value and
            not any(p in ('.', '..') for p in path.parts) and '\\' not in value and ':' not in value and '\x00' not in value,
            'Unsafe snapshot path')
    return value


def extract_snapshot(archive, destination, artifact, expected):
    data = regular(archive, ZIP_BYTES)
    require(len(data) == artifact['size_in_bytes'] and sha(data) == expected['source_archive_sha256'] and
            artifact['digest'] == 'sha256:' + sha(data), 'Archive size/digest mismatch')
    require(not destination.exists() and not destination.is_symlink(), 'Occupied extraction destination')
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        entries = z.infolist()
        require(len(entries) <= ZIP_ENTRIES and sum(i.file_size for i in entries) <= ZIP_TOTAL, 'ZIP entry/expanded byte limit')
        names = {}
        for item in entries:
            name = safe_name(item.filename, item.is_dir())
            require(name not in names and item.orig_filename == item.filename, 'ZIP duplicate/alias')
            mode = stat.S_IFMT(item.external_attr >> 16)
            require(mode in (0, stat.S_IFDIR if item.is_dir() else stat.S_IFREG) and not item.flag_bits & 1 and
                    (not item.is_dir() or item.file_size == 0), 'ZIP link/type/encryption forbidden')
            extra = item.extra
            while extra:
                require(len(extra) >= 4, 'Malformed ZIP metadata')
                tag, size = struct.unpack('<HH', extra[:4])
                require(tag in (0x0001, 0x5455, 0x7875) and len(extra) >= size+4, 'Unsupported ZIP link metadata')
                extra = extra[size+4:]
            names[name] = item.is_dir()
        for name in names:
            require(all(names.get(str(p), True) for p in PurePosixPath(name).parents if str(p) != '.'), 'ZIP file-parent collision')
        for parent in destination.parents:
            require(not parent.is_symlink(), 'Unsafe destination parent')
        destination.mkdir()
        try:
            for item in entries:
                output = destination / safe_name(item.filename, item.is_dir())
                if item.is_dir():
                    output.mkdir(parents=True, exist_ok=True)
                else:
                    output.parent.mkdir(parents=True, exist_ok=True)
                    with z.open(item) as source, output.open('xb') as target:
                        written = 0
                        while chunk := source.read(1024**2):
                            written += len(chunk)
                            require(written <= item.file_size, 'ZIP member byte limit')
                            target.write(chunk)
                        require(written == item.file_size, 'ZIP truncated member')
        except BaseException:
            shutil.rmtree(destination)
            raise
    return destination

# A closed, explicitly reviewed transitive policy import set.
POLICY_FILES = ('scripts/native/receipt-security.py',) + tuple(
    'scripts/security/' + name + '.py' for name in
    ('native-admission', 'verify-glib-closure', 'verify-glib-source', 'run-glib-controls', 'audit-native'))
HISTORICAL_BASE = '73f9df9810770d52cab0cc2978e55ef8301f884e'
HISTORICAL_LOCK = 'b4b8b94363f731001e2b42bf74778d79f725a1e4'
ORIGINAL_ROOT = Path('/home/runner/work/open-film/open-film')
FIXED_FILES = ('source.json', 'closure.json', 'controls/regression.json', 'metadata.json', 'audit/audit.json',
               'audit/actual-metadata.stdout', 'audit/current-registry-metadata.stdout',
               'audit/current-registry-Cargo.lock', 'audit/historical-Cargo.lock', 'audit/advisory-db.bundle')


def build_payload(evidence):
    import base64
    files, pins = {}, []
    total = 0
    def retain(name, digest=None):
        nonlocal total
        safe_name(name)
        require(name not in files, 'Duplicate raw evidence role')
        data = regular(evidence / name, RAW_BYTES)
        require(digest is None or sha(data) == digest, 'Raw scanner digest mismatch')
        total += len(data)
        require(total <= TOTAL_BYTES, 'Raw evidence total byte limit')
        files[name] = base64.b64encode(data).decode('ascii')
        pins.append(dict(path=name, size=len(data), sha256=sha(data)))
        return data
    for name in FIXED_FILES:
        retain(name)
    audit = parse_json(regular(evidence/'audit/audit.json', RAW_BYTES))
    require(isinstance(audit.get('reports'), dict) and set(audit['reports']) == {'actual', 'currentRegistry', 'historical'}, 'Expected three raw audit reports')
    for report in audit['reports'].values():
        for kind in ('stdout', 'stderr'):
            name = safe_name(report[kind+'File'])
            require('/' not in name, 'Scanner output must be a direct leaf')
            retain('audit/'+name, report[kind+'SHA256'])
    admission = parse_json(regular(evidence/'admission.json', RAW_BYTES))
    payload = json.dumps(dict(schemaVersion=1, files=files), separators=(',', ':')).encode()
    require(len(payload) <= PAYLOAD_BYTES, 'Payload byte limit')
    return payload, admission, pins


def git_environment():
    env = {key: value for key, value in os.environ.items() if not key.startswith('GIT_') and key not in ('GH_TOKEN', 'GITHUB_TOKEN')}
    env.update(GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL='/dev/null', GIT_ATTR_NOSYSTEM='1',
               GIT_TERMINAL_PROMPT='0', GIT_LFS_SKIP_SMUDGE='1', PYTHONDONTWRITEBYTECODE='1')
    return env


def git(directory, *args):
    import subprocess
    return subprocess.check_output(['git', '-c', 'core.hooksPath=/dev/null', '-c', 'init.templateDir=',
                                    '-c', 'core.attributesFile=/dev/null', '-c', 'protocol.ext.allow=never',
                                    '-c', 'protocol.file.allow=always', *args], cwd=directory,
                                   env=git_environment(), stderr=subprocess.PIPE, timeout=180)


def empty_root(root):
    require(root.is_absolute() and root == root.resolve(), 'Noncanonical candidate path')
    for parent in root.parents:
        require(parent.is_dir() and not parent.is_symlink(), 'Unsafe candidate parent')
    require(not root.is_symlink() and (not root.exists() or root.is_dir() and not any(root.iterdir())), 'Occupied candidate path')


def prepare_candidate(root, candidate, origin):
    empty_root(root)
    # Full clone: do not substitute a depth-one fixture for historical provenance.
    git(root.parent, 'clone', '--no-checkout', '--no-local', '--', origin, str(root))
    git(root, 'checkout', '--detach', candidate)
    require(git(root, 'rev-parse', 'HEAD').decode().strip() == candidate and not git(root, 'status', '--porcelain', '--untracked-files=all'), 'Candidate checkout identity/cleanliness mismatch')
    require(git(root, 'rev-parse', '--is-shallow-repository').strip() == b'false', 'Shallow candidate history')
    require(git(root, 'cat-file', '-t', HISTORICAL_BASE).strip() == b'commit' and
            git(root, 'cat-file', '-t', HISTORICAL_LOCK).strip() == b'blob' and
            git(root, 'rev-parse', HISTORICAL_BASE+':apps/desktop/src-tauri/Cargo.lock').decode().strip() == HISTORICAL_LOCK,
            'Missing/mismatched historical source objects')


def verify_policy(tools, repository):
    identities = []
    for name in POLICY_FILES:
        blobs = [git(root, 'rev-parse', 'HEAD:'+name).decode().strip() for root in (tools, repository)]
        data = [regular(root/name, RAW_BYTES) for root in (tools, repository)]
        require(blobs[0] == blobs[1] and data[0] == data[1] and
                all(git(root, 'show', 'HEAD:'+name) == value for root, value in zip((tools, repository), data)),
                'Changed tool/candidate policy identity: '+name)
        identities.append(dict(path=name, gitBlob=blobs[0], sha256=sha(data[0])))
    return identities


def replay_snapshot(tools, repository, payload, admission, output=None):
    import subprocess
    import sys
    verify_policy(tools, repository)
    try:
        result = subprocess.run([sys.executable, '-I', '-B', str(tools/'scripts/native/receipt-security.py'), str(repository)],
                                input=payload, capture_output=True, env=git_environment(), timeout=60, check=False)
    except subprocess.TimeoutExpired:
        raise ValueError('Source replay timed out') from None
    require(len(result.stdout) <= PAYLOAD_BYTES and len(result.stderr) <= RAW_BYTES, 'Source replay output limit')
    if output is not None:
        for name, data in (('replay.stdout', result.stdout), ('replay.stderr', result.stderr)):
            with (output/name).open('xb') as target:
                target.write(data)
    require(result.returncode == 0, 'Source replay failed: '+result.stderr.decode(errors='replace')[-4000:])
    value = parse_json(result.stdout)
    require(json.dumps(value, sort_keys=True, separators=(',', ':')) == json.dumps(admission, sort_keys=True, separators=(',', ':')), 'Replayed entire admission differs')
    return value


def expected_inputs():
    result = {'repository': os.environ['GITHUB_REPOSITORY']}
    require(result['repository'] == 'bynanci/open-film', 'Unexpected repository for original workspace allowlist')
    for key in ('repository_id', 'source_run_id', 'source_workflow_id', 'source_artifact_id'):
        value = os.environ['GITHUB_REPOSITORY_ID' if key == 'repository_id' else key.upper()]
        require(re.fullmatch(r'[1-9][0-9]{0,19}', value), 'Malformed numeric identity')
        result[key] = int(value)
    for key, length in (('candidate_sha', 40), ('source_archive_sha256', 64)):
        value = os.environ[key.upper()]
        require(re.fullmatch('[a-f0-9]{'+str(length)+'}', value), 'Malformed SHA identity')
        result[key] = value
    return result


def preflight_metadata(evidence, root):
    metadata = parse_json(regular(evidence/'metadata.json', RAW_BYTES))
    app = root/'apps/desktop/src-tauri'
    packages = metadata['packages']
    roots = [p for p in packages if p['id'] == metadata['resolve']['root']]
    glib = [p for p in packages if p['name'] == 'glib']
    require(metadata['workspace_root'] == str(app) and len(roots) == len(glib) == 1 and
            roots[0]['manifest_path'] == str(app/'Cargo.toml') and
            glib[0]['manifest_path'] == str(root/'vendor/glib-0.18.5/Cargo.toml'),
            'Original source paths do not match allowlisted fresh workspace')


def save_json(path, value):
    with path.open('x') as output:
        output.write(json.dumps(value, sort_keys=True, indent=2, allow_nan=False)+'\n')


def main():
    import sys
    os.umask(0o022)
    expected = expected_inputs()
    require(len(sys.argv) == 1, 'Unexpected replay arguments')
    runner = Path(os.environ['RUNNER_TEMP'])
    tools = Path(__file__).resolve().parents[2]
    require(tools == runner/'source-replay-tools' and tools == tools.resolve(), 'Unexpected tool checkout')
    tool_sha = os.environ['GITHUB_SHA']
    require(re.fullmatch('[a-f0-9]{40}', tool_sha) and git(tools, 'rev-parse', 'HEAD').decode().strip() == tool_sha,
            'Dispatcher tool identity mismatch')
    require(Path(os.environ['GITHUB_WORKSPACE']) == ORIGINAL_ROOT, 'Unexpected original workspace')
    empty_root(ORIGINAL_ROOT)
    output = runner/'source-replay'
    empty_root(output)
    output.mkdir(exist_ok=True)
    token = os.environ['GH_TOKEN']
    api = 'https://api.github.com/repos/'+expected['repository']+'/actions/'
    def read_api(suffix):
        return parse_json(fetch(api+suffix, token, 2*1024**2))
    try:
        run = read_api('runs/'+str(expected['source_run_id']))
        artifact = read_api('artifacts/'+str(expected['source_artifact_id']))
        workflow = read_api('workflows/'+str(expected['source_workflow_id']))
        verify_transport(run, artifact, workflow, expected)
        for name, value in (('run.json', run), ('artifact.json', artifact), ('workflow.json', workflow)):
            save_json(output/name, value)
        archive = output/'artifact.zip'
        fetch(api+'artifacts/'+str(expected['source_artifact_id'])+'/zip', token, artifact['size_in_bytes'], archive)
        evidence = extract_snapshot(archive, output/'evidence', artifact, expected)
        preflight_metadata(evidence, ORIGINAL_ROOT)
        payload, admission, pins = build_payload(evidence)
        require(admission.get('candidateSHA') == expected['candidate_sha'], 'Retained admission candidate mismatch')
        with (output/'replay-payload.json').open('xb') as target:
            target.write(payload)
        save_json(output/'raw-pins.json', pins)
        prepare_candidate(ORIGINAL_ROOT, expected['candidate_sha'], 'https://github.com/'+expected['repository']+'.git')
        policies = verify_policy(tools, ORIGINAL_ROOT)
        save_json(output/'policy-identities.json', policies)
        result = replay_snapshot(tools, ORIGINAL_ROOT, payload, admission, output)
        save_json(output/'replayed-admission.json', result)
        save_json(output/'result.json', dict(schemaVersion=1, status='source-replay-verified', distributionApproved=False,
                  toolSha=tool_sha, candidateSha=expected['candidate_sha'], repository=expected['repository'],
                  sourceRunId=run['id'], sourceRunAttempt=run['run_attempt'], sourceEvent=run['event'],
                  sourceWorkflowId=workflow['id'], sourceArtifactId=artifact['id'], archiveSha256=expected['source_archive_sha256'],
                  originalRoot=str(ORIGINAL_ROOT), payloadSha256=sha(payload),
                  admissionSha256=sha(regular(evidence/'admission.json', RAW_BYTES)),
                  resultSha256=sha(regular(output/'replayed-admission.json', RAW_BYTES)),
                  command=['python3', '-I', '-B', str(tools/'scripts/native/receipt-security.py'), str(ORIGINAL_ROOT)]))
        print('Source replay verified; distributionApproved=false')
    except Exception as error:
        # API/transport exceptions contain no signed URLs or tokens. Never turn
        # failed transport, stale evidence or policy rejection into a success.
        save_json(output/'failure.json', dict(schemaVersion=1, status='failed', distributionApproved=False,
                                             errorType=type(error).__name__))
        raise


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Retain only sanitized failure detail: urllib errors can carry signed
        # storage URLs, so network failures are normalized inside fetch().
        print('Source replay failed: '+type(error).__name__, file=__import__('sys').stderr)
        raise SystemExit(1)
