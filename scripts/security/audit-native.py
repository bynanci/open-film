#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Capture unedited, same-DB audits of actual, current registry and historical locks."""
import argparse
import datetime
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import tomllib

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('controls',HERE/'run-glib-controls.py')
controls=importlib.util.module_from_spec(spec);spec.loader.exec_module(controls)
closure=controls.closure;source=closure.source;require=source.require
REGISTRY='registry+https://github.com/rust-lang/crates.io-index'
DB_URL='https://github.com/RustSec/advisory-db.git'
PATCH_SECTION='[patch.crates-io]\nglib = { path = "../../../vendor/glib-0.18.5" }\n'


def graph_identity(metadata,registry):
    packages=metadata['packages'];by_id={p['id']:p for p in packages}
    require(len(by_id)==len(packages),'duplicate package ID')
    glib=[p for p in packages if p['name']=='glib'];require(len(glib)==1,'duplicate/missing GLib')
    require(glib[0]['version']=='0.18.5' and glib[0]['source']==(REGISTRY if registry else None),'control GLib source/version mismatch')
    def identity(p):return (p['name'],p['version'],None if p['name']=='glib' else p['source'])
    nodes=[]
    for node in metadata['resolve']['nodes']:
        deps=sorted([dict(name=d['name'],package=identity(by_id[d['pkg']]),kinds=d['dep_kinds']) for d in node['deps']],key=lambda x:source.canonical(x))
        nodes.append(dict(package=identity(by_id[node['id']]),features=sorted(node['features']),deps=deps))
    return dict(packages=sorted([identity(p) for p in packages],key=lambda p:source.canonical(p)),
                root=identity(by_id[metadata['resolve']['root']]),nodes=sorted(nodes,key=lambda p:source.canonical(p)))


def lock_identity(data,registry):
    lock=tomllib.loads(data.decode());packages=lock['package'];glib=[p for p in packages if p['name']=='glib']
    require(len(glib)==1 and glib[0]['version']=='0.18.5','control lock GLib version mismatch')
    if registry:require(glib[0].get('source')==REGISTRY and glib[0].get('checksum')==source.ARCHIVE_SHA,'registry control has wrong GLib source/checksum')
    else:require('source' not in glib[0] and 'checksum' not in glib[0],'actual lock GLib not path')
    normalized=[]
    for package in packages:
        entry=dict(package)
        if entry['name']=='glib':entry.pop('source',None);entry.pop('checksum',None)
        normalized.append(entry)
    return sorted(normalized,key=lambda p:source.canonical(p))


def compare_graphs(actual,registry,actual_lock,registry_lock):
    require(lock_identity(actual_lock,False)==lock_identity(registry_lock,True),'current registry complete lock graph differs')
    require(graph_identity(actual,False)==graph_identity(registry,True),'current registry metadata/feature graph differs')
    return True


def capture_current_registry_control(control,output,manifest_text,original_lock,must):
    parsed=tomllib.loads(manifest_text);require('patch' not in parsed,'registry control retains a Cargo patch')
    (control/'Cargo.toml').write_text(manifest_text)
    (control/'Cargo.lock').write_bytes(original_lock)
    command=['cargo','+1.99.0','metadata','--format-version','1','--filter-platform',closure.TARGET,
             '--manifest-path',str(control/'Cargo.toml')]
    raw=must(command,'current-registry-metadata',control.parent)
    current=json.loads(raw);current_lock=(control/'Cargo.lock').read_bytes()
    (output/'current-registry-Cargo.toml').write_text(manifest_text)
    (output/'current-registry-Cargo.lock').write_bytes(current_lock)
    return current,current_lock


def verify_advisory_bundle(bundle,expected_commit):
    """Verify offline replay from the ordinary artifact file, without its .git."""
    with tempfile.TemporaryDirectory(prefix='openfilm-advisory-bundle-') as private:
        database=Path(private)/'database.git'
        subprocess.run(['git','-c','core.hooksPath=/dev/null','clone','--bare','--',str(Path(bundle).resolve()),str(database)],check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=30)
        actual=subprocess.check_output(['git','rev-parse','HEAD'],cwd=database,text=True,timeout=30).strip()
        require(actual==expected_commit,'database bundle commit differs')


def retain_advisory_bundle(database,bundle,expected_commit):
    """Retain the already fetched shallow database; never fetch more history."""
    database=Path(database);bundle=Path(bundle).absolute()
    require(not bundle.exists() and not bundle.is_symlink(),'database bundle destination already exists')
    actual=subprocess.check_output(['git','rev-parse','HEAD'],cwd=database,text=True,timeout=30).strip()
    require(actual==expected_commit,'database changed before bundling')
    subprocess.run(['git','bundle','create',str(bundle),'HEAD'],cwd=database,check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=30)
    verify_advisory_bundle(bundle,expected_commit)


def capture_audits(repository,output):
    repository=Path(repository).resolve();output=Path(output).resolve();output.mkdir(parents=True,exist_ok=True)
    record=dict(schemaVersion=1,candidateSHA=closure.candidate(repository),verified=False,dbFresh=False,reports={},errors=[],currentRegistryGraphEquivalent=False)
    def capture(command,name,cwd=repository,timeout=1200):return controls.capture(command,cwd,output/name,timeout)
    def must(command,name,cwd=repository,timeout=1200):
        run=capture(command,name,cwd,timeout);require(run['returncode']==0 and not run['timeout'],name+' failed; raw process retained');return run['stdout']
    try:
        before=source.verify_source(repository);closure.environment(repository)
        record['sourceSHA256']=source.sha(source.canonical(before))
        lock=(repository/closure.APP/'Cargo.lock').read_bytes();record['lockSHA256']=closure.verify_lock(lock,repository)
        original=(repository/source.INPUTS/'original-registry-Cargo.lock').read_bytes()
        require(source.sha(original)==source.LOCK_SHA,'original lock digest mismatch')
        blob=hashlib.sha1(b'blob '+str(len(original)).encode()+b'\0'+original).hexdigest();require(blob==source.LOCK_BLOB,'original lock Git blob mismatch')
        git_original=subprocess.check_output(['git','show',source.BASE+':'+closure.APP+'/Cargo.lock'],cwd=repository)
        require(git_original==original,'original lock commit differs')
        record.update(originalLockSHA256=source.LOCK_SHA,originalLockBlob=blob)
        version=must(['cargo','+1.99.0','audit','--version'],'scanner-version',timeout=60).decode().strip()
        record['scannerVersion']=version;require(version=='cargo-audit-audit 0.22.2','unreviewed cargo-audit version')
        help_text=must(['cargo','+1.99.0','audit','--help'],'scanner-help',timeout=60).decode()
        require(all(flag in help_text for flag in ('--db','--no-fetch','--file','--json','--deny')),'required scanner arguments unsupported')
        db=output/'advisory-db';require(not db.exists(),'fresh database destination already exists')
        must(['git','clone','--depth','1',DB_URL,str(db)],'db-fetch',timeout=180)
        db_commit=must(['git','rev-parse','HEAD'],'db-commit',db,60).decode().strip()
        require(len(db_commit)==40 and all(c in '0123456789abcdef' for c in db_commit),'invalid DB Git commit')
        record.update(dbCommit=db_commit,dbFresh=True,dbFetchedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),dbURL=DB_URL)
        record['glibAdvisorySHA256']=source.sha((db/'crates/glib/RUSTSEC-2024-0429.md').read_bytes())
        require(record['glibAdvisorySHA256']=='0c1ab1d4a0ebe5948e362728b31613ab588b84a0284dadbc119f7424fdd9c6d0','GLib advisory semantics changed; review required')
        metadata=json.loads(must(['cargo','+1.99.0','metadata','--locked','--format-version','1','--filter-platform',closure.TARGET,'--manifest-path',str(repository/closure.APP/'Cargo.toml')],'actual-metadata'))
        (output/'actual-Cargo.lock').write_bytes(lock)
        (output/'historical-Cargo.lock').write_bytes(original)
        locks={'actual':output/'actual-Cargo.lock','historical':output/'historical-Cargo.lock'}
        # Build the current registry control through Cargo itself. The source
        # manifest changes only by disabling this exact reviewed path patch.
        with tempfile.TemporaryDirectory(prefix='openfilm-current-registry-') as private:
            control=Path(private)/'src-tauri'
            shutil.copytree(repository/closure.APP,control,ignore=shutil.ignore_patterns('target','gen','resources'))
            text=(control/'Cargo.toml').read_text();require(text.count(PATCH_SECTION)==1,'unexpected source patch declaration')
            text=text.replace(PATCH_SECTION,'')
            # Main already pins the reviewed Tokio fix. Start from its exact
            # registry lock and let metadata add the newly declared Linux test
            # dependency to the root package. `cargo update -p tokio` can
            # reselect unrelated broad-bound edges and invalidate the control.
            record['currentRegistrySeedSHA256']=source.LOCK_SHA
            current,current_lock=capture_current_registry_control(control,output,text,original,must)
            record['currentRegistryGraphEquivalent']=compare_graphs(metadata,current,lock,current_lock)
            record['currentRegistryLockSHA256']=source.sha(current_lock)
            record['currentRegistryManifestSHA256']=source.sha(text.encode())
            locks['currentRegistry']=output/'current-registry-Cargo.lock'
        for name,path in locks.items():
            command=['cargo','+1.99.0','audit','--db',str(db),'--no-fetch','--file',str(path),'--json','--deny','unsound']
            run=capture(command,name)
            process=controls.serial(run)
            process.update(dependencyCount=len(tomllib.loads(path.read_text())['package']),stdoutFile=name+'.stdout',stderrFile=name+'.stderr',dbCommit=db_commit,lockSHA256=source.sha(path.read_bytes()))
            record['reports'][name]=process
            (output/(name+'.process.json')).write_bytes(source.canonical(process))
        require(subprocess.check_output(['git','rev-parse','HEAD'],cwd=db,text=True).strip()==db_commit,'database changed during scans')
        require(source.verify_source(repository)==before,'source changed during scans')
        require((repository/closure.APP/'Cargo.lock').read_bytes()==lock,'lock changed during scans')
        retain_advisory_bundle(db,output/'advisory-db.bundle',db_commit)
        record['verified']=True
    except (ValueError,OSError,KeyError,TypeError,subprocess.SubprocessError) as exc:record['errors'].append(str(exc))
    (output/'audit.json').write_bytes(source.canonical(record));return record


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--repository',required=True,type=Path);parser.add_argument('--output',required=True,type=Path)
    args=parser.parse_args();record=capture_audits(args.repository,args.output)
    print('Captured native raw audits' if record['verified'] else 'Native audit capture blocked; inspect audit.json')
    return 0 if record['verified'] else 1

if __name__=='__main__':sys.exit(main())
