# SPDX-License-Identifier: Apache-2.0
"""Synthetic transport tests; never native OS evidence or distribution approval."""
import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import stat
import os
import shutil
import subprocess
import sys
import datetime
import warnings
import tempfile
import unittest
from unittest.mock import patch
import zipfile

os.umask(0o022)
HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location('replay_transport', HERE / 'replay-security-artifact.py')
m = importlib.util.module_from_spec(SPEC) if Path(SPEC.origin).exists() else None
if m:
    SPEC.loader.exec_module(m)


class TransportTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(m, 'The bounded source replay helper is not implemented')
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.expected = dict(repository='bynanci/open-film', repository_id=17, candidate_sha='a'*40,
                             source_run_id=100, source_workflow_id=200, source_artifact_id=300,
                             source_archive_sha256='b'*64)
        repo = dict(id=17, full_name='bynanci/open-film')
        self.run = dict(id=100, workflow_id=200, head_sha='a'*40, status='completed', conclusion='success',
                        repository=repo.copy(), head_repository=repo.copy(), path='.github/workflows/security.yml',
                        event='workflow_dispatch', run_attempt=1, referenced_workflows=[dict(
                            path='bynanci/open-film/.github/workflows/native-security.yml@'+'a'*40, sha='a'*40)])
        self.artifact = dict(id=300, name='native-security-'+'a'*40, expired=False, size_in_bytes=10,
                             digest='sha256:'+'b'*64, workflow_run=dict(id=100, head_sha='a'*40, repository_id=17, head_repository_id=17))
        self.workflow = dict(id=200, path='.github/workflows/security.yml')

    def test_identity_and_every_authenticated_binding(self):
        m.verify_transport(self.run, self.artifact, self.workflow, self.expected)
        faults = [('run', 'id', 101), ('run', 'workflow_id', 201), ('run', 'head_sha', 'c'*40),
                  ('run', 'status', 'in_progress'), ('run', 'conclusion', 'failure'), ('run', 'path', 'evil.yml'),
                  ('run', 'referenced_workflows', []), ('run', 'run_attempt', 0),
                  ('artifact', 'id', 301), ('artifact', 'name', 'other'), ('artifact', 'expired', True),
                  ('artifact', 'digest', 'sha256:'+'c'*64), ('artifact', 'size_in_bytes', 201*1024**2),
                  ('workflow', 'id', 201), ('workflow', 'path', 'other.yml')]
        for group, key, value in faults:
            with self.subTest(group=group, key=key):
                r, a, w = map(copy.deepcopy, (self.run, self.artifact, self.workflow))
                dict(run=r, artifact=a, workflow=w)[group][key] = value
                with self.assertRaises(ValueError): m.verify_transport(r, a, w, self.expected)
        for group, key in [('repository', 'id'), ('repository', 'full_name'), ('head_repository', 'id'), ('head_repository', 'full_name')]:
            r = copy.deepcopy(self.run); r[group][key] = 'foreign'
            with self.assertRaises(ValueError): m.verify_transport(r, self.artifact, self.workflow, self.expected)
        for key in self.artifact['workflow_run']:
            a = copy.deepcopy(self.artifact); a['workflow_run'][key] = 'foreign'
            with self.assertRaises(ValueError): m.verify_transport(self.run, a, self.workflow, self.expected)

    def archive(self, members):
        path = self.root / 'input.zip'
        with zipfile.ZipFile(path, 'w', compression=zipfile.ZIP_DEFLATED) as z:
            for name, value, mode in members:
                info = zipfile.ZipInfo(name); info.external_attr = mode << 16
                with warnings.catch_warnings():
                    warnings.simplefilter('ignore', UserWarning)
                    z.writestr(info, value)
        self.artifact.update(size_in_bytes=path.stat().st_size, digest='sha256:'+hashlib.sha256(path.read_bytes()).hexdigest())
        self.expected['source_archive_sha256'] = self.artifact['digest'][7:]
        return path

    def test_real_zip_extract_preserves_bytes_and_never_overwrites(self):
        data = b'{"seconds":1.0}\n'
        archive = self.archive([('audit/', b'', stat.S_IFDIR|0o755), ('audit/raw.json', data, stat.S_IFREG|0o644)])
        destination = self.root/'out'
        m.extract_snapshot(archive, destination, self.artifact, self.expected)
        self.assertEqual((destination/'audit/raw.json').read_bytes(), data)
        with self.assertRaises((ValueError, FileExistsError)): m.extract_snapshot(archive, destination, self.artifact, self.expected)
        self.assertEqual((destination/'audit/raw.json').read_bytes(), data)

    def test_zip_unsafe_paths_types_collisions_and_size_fail_closed(self):
        for name in ('../escape', '/absolute', './alias', 'a//b', 'a/../b', 'a\\b', 'a:b', ''):
            if not name: continue  # ZIP cannot serialize an empty member using this API.
            with self.subTest(name=name):
                archive = self.archive([(name, b'x', stat.S_IFREG|0o644)])
                with self.assertRaises(ValueError): m.extract_snapshot(archive, self.root/'out', self.artifact, self.expected)
                self.assertFalse((self.root/'out').exists())
        for mode in (stat.S_IFLNK, stat.S_IFIFO, stat.S_IFSOCK, stat.S_IFBLK):
            archive = self.archive([('unsafe', b'../target', mode|0o777)])
            with self.assertRaises(ValueError): m.extract_snapshot(archive, self.root/'out', self.artifact, self.expected)
        for members in ([('a', b'x', stat.S_IFREG), ('a/b', b'y', stat.S_IFREG)], [('a/b', b'x', stat.S_IFREG), ('a', b'y', stat.S_IFREG)], [('same', b'x', stat.S_IFREG), ('same', b'y', stat.S_IFREG)]):
            archive = self.archive(members)
            with self.assertRaises(ValueError): m.extract_snapshot(archive, self.root/'out', self.artifact, self.expected)
        archive = self.archive([('file', b'12345', stat.S_IFREG)])
        for constant, value in [('ZIP_TOTAL', 4), ('ZIP_ENTRIES', 0), ('ZIP_BYTES', 4)]:
            with patch.object(m, constant, value), self.assertRaises(ValueError): m.extract_snapshot(archive, self.root/'out', self.artifact, self.expected)
        self.expected['source_archive_sha256'] = '0'*64
        with self.assertRaises(ValueError): m.extract_snapshot(archive, self.root/'out', self.artifact, self.expected)
        self.assertFalse((self.root/'escape').exists())

    def test_redirect_never_sends_api_credentials_to_storage(self):
        seen = []
        class Response(io.BytesIO):
            def __init__(self, status, headers, data=b''):
                super().__init__(data); self.status=status; self.headers=headers
        class Opener:
            def open(self, request, timeout):
                seen.append((request.full_url, dict(request.header_items())))
                if len(seen)==1: return Response(302, {'Location':'https://productionresultssa1.blob.core.windows.net/container/signed?secret=not-logged'})
                return Response(200, {}, b'zip')
        with patch.object(m.urllib.request, 'build_opener', return_value=Opener()):
            self.assertEqual(m.fetch('https://api.github.com/repos/bynanci/open-film/actions/artifacts/300/zip', 'private-token', 10), b'zip')
        self.assertEqual(seen[0][1].get('Authorization'), 'Bearer private-token')
        self.assertNotIn('Authorization', seen[1][1]); self.assertNotIn('Cookie', seen[1][1])
        for bad in ('http://storage.example/file', 'https://127.0.0.1/a', 'https://api.github.com.evil/a', 'https://user@productionresultssa1.blob.core.windows.net/a', 'https://productionresultssa1.blob.core.windows.net:444/a'):
            class Bad:
                def open(self, request, timeout): return Response(302, {'Location':bad})
            with patch.object(m.urllib.request, 'build_opener', return_value=Bad()), self.assertRaises(ValueError): m.fetch('https://api.github.com/repos/x/y', 'private-token', 10)
        class Oversize:
            def open(self, request, timeout): return Response(200, {}, b'123456')
        with patch.object(m.urllib.request, 'build_opener', return_value=Oversize()), self.assertRaises(ValueError): m.fetch('https://api.github.com/repos/x/y', 'private-token', 5)

    def test_extra_link_metadata_corruption_and_input_links_are_rejected(self):
        archive=self.archive([('file', b'data', stat.S_IFREG)])
        target=self.root/'hardlink'; os.link(archive,target)
        with self.assertRaises(ValueError): m.extract_snapshot(archive,self.root/'out',self.artifact,self.expected)
        target.unlink()
        target.symlink_to(archive)
        with self.assertRaises(ValueError): m.extract_snapshot(target,self.root/'out',self.artifact,self.expected)
        with zipfile.ZipFile(archive,'w') as z:
            info=zipfile.ZipInfo('file'); info.extra=b'\x0d\x00\x00\x00'
            z.writestr(info,b'data')
        self.artifact.update(size_in_bytes=archive.stat().st_size,digest='sha256:'+hashlib.sha256(archive.read_bytes()).hexdigest())
        self.expected['source_archive_sha256']=self.artifact['digest'][7:]
        with self.assertRaisesRegex(ValueError,'metadata'): m.extract_snapshot(archive,self.root/'out',self.artifact,self.expected)
        archive.write_bytes(b'not a ZIP')
        self.artifact.update(size_in_bytes=archive.stat().st_size,digest='sha256:'+hashlib.sha256(archive.read_bytes()).hexdigest())
        self.expected['source_archive_sha256']=self.artifact['digest'][7:]
        with self.assertRaises(zipfile.BadZipFile): m.extract_snapshot(archive,self.root/'out',self.artifact,self.expected)

    def test_json_duplicate_keys_fail(self):
        with self.assertRaises(ValueError): m.parse_json(b'{"a":1,"a":2}')


class ReplayTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.repo = HERE.parents[1]

    def fixture(self):
        root = self.directory/'candidate'
        subprocess.run([sys.executable, str(self.repo/'tests/fixtures/native-security-replay.py'), str(root)], check=True, capture_output=True)
        # Bind the six policy files as source bytes, never execute candidate code.
        for name in m.POLICY_FILES:
            dest = root/name; dest.parent.mkdir(parents=True, exist_ok=True); shutil.copyfile(self.repo/name, dest)
        git(root, 'add', 'scripts')
        git(root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'Policy identity fixture')
        candidate = git(root, 'rev-parse', 'HEAD')
        for name in ('audit/audit.json', 'closure.json', 'controls/regression.json'):
            path = root/'evidence'/name; value = json.loads(path.read_bytes()); value['candidateSHA']=candidate
            path.write_text(json.dumps(value, separators=(',', ':')))
        subprocess.run([sys.executable, str(self.repo/'scripts/security/native-admission.py'), '--repository', str(root), '--evidence-dir', str(root/'evidence'), '--output', str(root/'evidence/admission.json')], check=True, capture_output=True)
        return root, candidate

    def test_real_policy_replay_from_fresh_independent_checkout_preserves_originals(self):
        root, candidate = self.fixture()
        payload, admission, pins = m.build_payload(root/'evidence')
        originals = {p['path']: (root/'evidence'/p['path']).read_bytes() for p in pins}
        producer = self.directory/'producer'; root.rename(producer)
        git(self.directory, 'clone', '--no-local', str(producer), str(root))
        result = m.replay_snapshot(self.repo, root, payload, admission)
        self.assertEqual(result, admission)
        self.assertEqual(git(root, 'rev-parse', 'HEAD'), candidate)
        for name, data in originals.items():
            self.assertEqual(__import__('base64').b64decode(json.loads(payload)['files'][name]), data)
        self.assertEqual(git(root, 'status', '--porcelain'), '')
        self.assertFalse((root/'evidence').exists())

    def test_each_policy_blob_and_working_bytes_must_match_before_execution(self):
        root, _ = self.fixture()
        self.assertEqual(len(m.verify_policy(self.repo, root)), 6)
        for name in m.POLICY_FILES:
            path = root/name; data=path.read_bytes(); path.write_bytes(data+b'\n# different policy\n')
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, 'policy'):
                m.verify_policy(self.repo, root)
            path.write_bytes(data)
        path = root/m.POLICY_FILES[0]; path.write_bytes(path.read_bytes()+b'\n')
        git(root, 'add', str(path)); git(root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'Changed policy')
        with self.assertRaisesRegex(ValueError, 'policy'): m.verify_policy(self.repo, root)

    def test_original_mutations_and_entire_admission_equality_fail(self):
        root, _ = self.fixture()
        payload, admission, _ = m.build_payload(root/'evidence')
        for field in ('sourceRemediation', 'reports', 'evidenceDigests'):
            altered = copy.deepcopy(admission); altered[field] = 'optimistic-but-different'
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, 'differs'):
                m.replay_snapshot(self.repo, root, payload, altered)
        for name in ('metadata.json', 'audit/current-registry-Cargo.lock', 'audit/historical-Cargo.lock', 'audit/actual-metadata.stdout', 'audit/advisory-db.bundle'):
            p=root/'evidence'/name; saved=p.read_bytes(); p.write_bytes(b'{}' if name.endswith(('json','stdout')) else b'changed')
            with self.subTest(name=name), self.assertRaises((ValueError, subprocess.CalledProcessError)):
                value, original, _ = m.build_payload(root/'evidence'); m.replay_snapshot(self.repo, root, value, original)
            p.write_bytes(saved)
        p=root/'evidence/audit/audit.json'; saved=p.read_bytes()
        for hours in (-7, 1):
            audit=json.loads(saved); audit['dbFetchedAt']=(datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(hours=hours)).isoformat(); p.write_text(json.dumps(audit))
            with self.subTest(hours=hours), self.assertRaisesRegex(ValueError, 'replay'):
                value, original, _=m.build_payload(root/'evidence'); m.replay_snapshot(self.repo, root, value, original)
        p.write_bytes(saved)
        (root/'dirty').write_text('not candidate')
        with self.assertRaisesRegex(ValueError, 'replay'): m.replay_snapshot(self.repo, root, payload, admission)

    def test_original_path_preflight_and_runtime_credentials_are_not_forwarded(self):
        root, _ = self.fixture()
        m.preflight_metadata(root/'evidence', root)
        with self.assertRaisesRegex(ValueError, 'Original source paths'):
            m.preflight_metadata(root/'evidence', root.parent/'relocated')
        with patch.dict(os.environ, {'GH_TOKEN':'test-secret', 'GITHUB_TOKEN':'other-secret'}):
            self.assertFalse('GH_TOKEN' in m.git_environment(), 'Git child must not inherit GH_TOKEN')
            self.assertFalse('GITHUB_TOKEN' in m.git_environment(), 'Git child must not inherit GITHUB_TOKEN')

    def test_raw_subprocess_output_is_retained_and_matches_original(self):
        root, _ = self.fixture()
        payload, admission, _ = m.build_payload(root/'evidence')
        output=self.directory/'output'; output.mkdir()
        m.replay_snapshot(self.repo, root, payload, admission, output)
        self.assertEqual(json.loads((output/'replay.stdout').read_bytes()), admission)
        self.assertEqual((output/'replay.stderr').read_bytes(), b'')

    def test_payload_rejects_raw_hash_escape_duplicate_roles_and_bounds(self):
        root, _ = self.fixture(); evidence=root/'evidence'
        p=evidence/'audit/audit.json'; saved=p.read_bytes()
        for name in ('../outside', 'actual.stdout/../other', '/absolute', 'actual.stderr'):
            audit=json.loads(saved); audit['reports']['actual']['stdoutFile']=name; p.write_text(json.dumps(audit))
            with self.assertRaises(ValueError): m.build_payload(evidence)
        p.write_bytes(saved)
        for key, value in [('RAW_BYTES', 10), ('TOTAL_BYTES', 10), ('PAYLOAD_BYTES', 10)]:
            with patch.object(m, key, value), self.assertRaises(ValueError): m.build_payload(evidence)
        p=evidence/'audit/actual.stdout'; p.write_bytes(p.read_bytes()+b' ')
        with self.assertRaisesRegex(ValueError, 'digest'): m.build_payload(evidence)

    def test_fresh_full_clone_historical_objects_and_no_external_git_execution(self):
        candidate=git(self.repo, 'rev-parse', 'HEAD'); target=self.directory/'clone'
        sentinel=self.directory/'executed'; malicious=self.directory/'global.gitconfig'
        malicious.write_text('[filter "evil"]\n smudge = touch '+str(sentinel)+'\n[core]\n hooksPath = '+str(self.directory/'hooks')+'\n')
        hooks=self.directory/'hooks'; hooks.mkdir(); hook=hooks/'post-checkout'; hook.write_text('#!/bin/sh\ntouch '+str(sentinel)+'\n'); hook.chmod(0o755)
        # The actual full-history clone exercises the pinned historical object check.
        with patch.dict(os.environ, {'GIT_CONFIG_GLOBAL':str(malicious), 'GIT_CONFIG_COUNT':'1', 'GIT_CONFIG_KEY_0':'core.hooksPath', 'GIT_CONFIG_VALUE_0':str(hooks)}):
            m.prepare_candidate(target, candidate, str(self.repo))
        self.assertFalse(sentinel.exists()); self.assertEqual(git(target, 'rev-parse', '--is-shallow-repository'), 'false')
        self.assertEqual(git(target, 'cat-file', '-t', m.HISTORICAL_BASE), 'commit')
        self.assertEqual(git(target, 'cat-file', '-t', m.HISTORICAL_LOCK), 'blob')
        with self.assertRaisesRegex(ValueError, 'Occupied'): m.prepare_candidate(target, candidate, str(self.repo))
        link=self.directory/'link'; link.symlink_to(target, target_is_directory=True)
        with self.assertRaises(ValueError): m.prepare_candidate(link/'nested', candidate, str(self.repo))
        # A separate real checkout confirms configured smudge cannot execute.
        attrs=target/'.gitattributes'; attrs.write_text('* filter=evil\n'); (target/'trigger').write_text('payload')
        git(target,'add','.'); git(target,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','Filter fixture')
        with patch.dict(os.environ, {'GIT_CONFIG_GLOBAL':str(malicious)}):
            m.prepare_candidate(self.directory/'filtered', git(target,'rev-parse','HEAD'), str(target))
        self.assertFalse(sentinel.exists())


def git(root, *args):
    return subprocess.check_output(['git', *args], cwd=root, text=True, stderr=subprocess.DEVNULL).strip()

class WorkflowTests(unittest.TestCase):
    def test_standalone_replay_has_read_permissions_and_existing_ci_runs_tests(self):
        workflow=HERE.parents[1]/'.github/workflows/native-security-replay.yml'
        self.assertTrue(workflow.exists(), 'Standalone replay workflow not implemented')
        text=workflow.read_text()
        self.assertIn('workflow_dispatch:', text)
        for trigger in ('workflow_call:', 'pull_request:', 'push:', 'schedule:'):
            self.assertNotIn(trigger, text)
        for name in ('candidate_sha', 'source_run_id', 'source_workflow_id', 'source_artifact_id', 'source_archive_sha256'):
            self.assertIn(name+':', text)
        self.assertIn('contents: read', text); self.assertIn('actions: read', text)
        self.assertNotIn(': write', text)
        self.assertIn('replay-security-artifact.py', text)
        self.assertIn('GIT_CONFIG_NOSYSTEM', text)
        self.assertIn('source-replay-tools', text)
        self.assertNotIn('actions/checkout', text)
        self.assertNotIn('pnpm build', text)
        self.assertNotIn('secrets.', text)
        ci=(HERE.parents[1]/'.github/workflows/ci.yml').read_text()
        self.assertIn('python scripts/native/test-replay-security-artifact.py', ci)
        self.assertIn('fetch-depth: 0', ci.split('  native-shell:', 1)[1])

    def test_cli_rejects_malformed_inputs_before_any_api_or_checkout(self):
        for key, value in [('SOURCE_RUN_ID', '1;touch nope'), ('CANDIDATE_SHA', '../bad'), ('SOURCE_ARCHIVE_SHA256', '0'), ('GITHUB_REPOSITORY', 'foreign/project')]:
            env=dict(GITHUB_REPOSITORY='bynanci/open-film', GITHUB_REPOSITORY_ID='1405832980', CANDIDATE_SHA='a'*40,
                     SOURCE_RUN_ID='1', SOURCE_WORKFLOW_ID='2', SOURCE_ARTIFACT_ID='3', SOURCE_ARCHIVE_SHA256='b'*64)
            env[key]=value
            with patch.dict(os.environ, env), self.assertRaises(ValueError): m.expected_inputs()

if __name__ == '__main__': unittest.main()
