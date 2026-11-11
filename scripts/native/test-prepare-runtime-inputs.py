"""Run the real intake transport boundary using synthetic, non-distribution data."""
import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('prepare', Path(__file__).with_name('prepare-runtime-inputs.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class TransportTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.archive = self.root / 'inputs.tar'
        self.destination = self.root / 'extracted'
        self.content = b'{"fixture":true}\n'
        with tarfile.open(self.archive, 'w') as archive:
            item = tarfile.TarInfo('runtime-inputs.local.json')
            item.size = len(self.content)
            archive.addfile(item, io.BytesIO(self.content))
        self.expected = {'repository': 'owner/project', 'repositoryId': 17, 'sha': 'a' * 40, 'runId': 100, 'artifactId': 200, 'workflowId': 300, 'artifactName': 'reviewed-runtime-inputs-win32-x64', 'archiveSha256': hashlib.sha256(self.archive.read_bytes()).hexdigest(), 'inputsSha256': hashlib.sha256(self.content).hexdigest()}
        self.run = {'id': 100, 'workflow_id': 300, 'head_sha': 'a' * 40, 'status': 'completed', 'conclusion': 'success', 'repository': {'id': 17, 'full_name': 'owner/project'}, 'head_repository': {'id': 17, 'full_name': 'owner/project'}}
        self.artifact = {'id': 200, 'name': 'reviewed-runtime-inputs-win32-x64', 'expired': False, 'workflow_run': {'id': 100, 'head_sha': 'a' * 40, 'repository_id': 17, 'head_repository_id': 17}}

    def test_extracts_only_pinned_same_repository_successful_run(self):
        module.prepare(self.archive, self.destination, self.run, self.artifact, self.expected)
        self.assertEqual((self.destination / 'runtime-inputs.local.json').read_bytes(), self.content)

    def test_wrong_identity_or_digest_never_extracts(self):
        for fault in ['fork', 'repository', 'run', 'workflow', 'commit', 'failed', 'artifact', 'artifact-run', 'artifact-commit', 'expired', 'name', 'archive-hash']:
            with self.subTest(fault=fault):
                run, artifact, expected = map(copy.deepcopy, [self.run, self.artifact, self.expected])
                if fault == 'fork': run['head_repository']['id'] = 18
                if fault == 'repository': run['repository']['full_name'] = 'other/project'
                if fault == 'run': run['id'] = 101
                if fault == 'workflow': run['workflow_id'] = 301
                if fault == 'commit': run['head_sha'] = 'b' * 40
                if fault == 'failed': run['conclusion'] = 'failure'
                if fault == 'artifact': artifact['id'] = 201
                if fault == 'artifact-run': artifact['workflow_run']['id'] = 101
                if fault == 'artifact-commit': artifact['workflow_run']['head_sha'] = 'b' * 40
                if fault == 'expired': artifact['expired'] = True
                if fault == 'name': artifact['name'] = 'unreviewed'
                if fault == 'archive-hash': expected['archiveSha256'] = '0' * 64
                with self.assertRaisesRegex(ValueError, 'identity|digest'):
                    module.prepare(self.archive, self.destination, run, artifact, expected)
                self.assertFalse(self.destination.exists())

    def test_changed_inputs_json_does_not_survive_extraction(self):
        self.expected['inputsSha256'] = '0' * 64
        with self.assertRaisesRegex(ValueError, 'input.*digest'):
            module.prepare(self.archive, self.destination, self.run, self.artifact, self.expected)
        self.assertFalse(self.destination.exists())

    def test_archive_links_rejected_by_existing_extractor(self):
        with tarfile.open(self.archive, 'w') as archive:
            item = tarfile.TarInfo('runtime-inputs.local.json')
            item.type = tarfile.SYMTYPE
            item.linkname = '../outside'
            archive.addfile(item)
        self.expected['archiveSha256'] = hashlib.sha256(self.archive.read_bytes()).hexdigest()
        with self.assertRaisesRegex(ValueError, 'extraction'):
            module.prepare(self.archive, self.destination, self.run, self.artifact, self.expected)
        self.assertFalse(self.destination.exists())

if __name__ == '__main__':
    unittest.main()
