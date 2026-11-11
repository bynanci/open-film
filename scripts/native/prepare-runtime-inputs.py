"""Authenticate pinned intake transport before the existing bounded extractor.

No payload is executed. Source API responses must come from this repository's
Actions API; hashes are independently supplied workflow-dispatch inputs.
Modified by OpenFilm contributors on 2026-11-11. See LICENSE and NOTICE.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys


def digest(path):
    value = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            value.update(chunk)
    return value.hexdigest()


def prepare(archive, destination, run, artifact, expected):
    repository = {'id': expected['repositoryId'], 'full_name': expected['repository']}
    identity = (
        run.get('id') == expected['runId'] and
        run.get('workflow_id') == expected['workflowId'] and
        run.get('head_sha') == expected['sha'] and
        run.get('status') == 'completed' and run.get('conclusion') == 'success' and
        all(run.get(key, {}).get(field) == value for key in ('repository', 'head_repository') for field, value in repository.items()) and
        artifact.get('id') == expected['artifactId'] and
        artifact.get('name') == expected['artifactName'] and artifact.get('expired') is False and
        all(artifact.get('workflow_run', {}).get(key) == value for key, value in {
            'id': expected['runId'], 'head_sha': expected['sha'],
            'repository_id': expected['repositoryId'], 'head_repository_id': expected['repositoryId'],
        }.items())
    )
    if not identity:
        raise ValueError('Source artifact/run/repository identity mismatch')
    for key in ('archiveSha256', 'inputsSha256'):
        if not isinstance(expected[key], str) or not re.fullmatch('[a-f0-9]{64}', expected[key]):
            raise ValueError('Invalid independently reviewed digest')
    if not archive.is_file() or archive.is_symlink() or archive.stat().st_size > 4 * 1024**3 or digest(archive) != expected['archiveSha256']:
        raise ValueError('Input archive digest mismatch or oversized archive')
    destination.mkdir(parents=True, exist_ok=False)
    try:
        result = subprocess.run([sys.executable, str(Path(__file__).with_name('extract-runtime.py')), str(archive), str(destination)], capture_output=True, text=True)
        if result.returncode:
            raise ValueError('Unsafe runtime input archive extraction')
        inputs = destination / 'runtime-inputs.local.json'
        if not inputs.is_file() or digest(inputs) != expected['inputsSha256']:
            raise ValueError('Runtime inputs JSON digest mismatch')
    except BaseException:
        shutil.rmtree(destination)
        raise


if __name__ == '__main__':
    archive, destination, run_file, artifact_file = map(Path, sys.argv[1:])
    expected = {
        'repository': os.environ['GITHUB_REPOSITORY'],
        'repositoryId': int(os.environ['GITHUB_REPOSITORY_ID']),
        'sha': os.environ['GITHUB_SHA'],
        'runId': int(os.environ['SOURCE_RUN_ID']),
        'artifactId': int(os.environ['SOURCE_ARTIFACT_ID']),
        'workflowId': int(os.environ['SOURCE_WORKFLOW_ID']),
        'artifactName': os.environ['SOURCE_ARTIFACT_NAME'],
        'archiveSha256': os.environ['INPUT_ARCHIVE_SHA256'],
        'inputsSha256': os.environ['INPUT_JSON_SHA256'],
    }
    prepare(archive, destination, json.loads(run_file.read_text()), json.loads(artifact_file.read_text()), expected)
    print(json.dumps({'transportVerified': True, 'executed': False, 'distributionApproved': False}))
