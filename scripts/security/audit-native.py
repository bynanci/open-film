#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Capture unedited, same-DB audits of actual, current registry and historical locks."""
import argparse
import datetime
import hashlib
import importlib.util
import json
import os
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


def advisory_git_environment() -> dict[str,str]:
    """DB operations cannot borrow caller credentials, configuration or objects."""
    env={key:value for key,value in os.environ.items() if not key.startswith('GIT_') and key not in ('GH_TOKEN','GITHUB_TOKEN')}
    env.update(GIT_CONFIG_NOSYSTEM='1',GIT_CONFIG_SYSTEM='/dev/null',GIT_CONFIG_GLOBAL='/dev/null',
               GIT_ATTR_NOSYSTEM='1',GIT_TERMINAL_PROMPT='0',GIT_LFS_SKIP_SMUDGE='1',
               GIT_NO_REPLACE_OBJECTS='1',GIT_NO_LAZY_FETCH='1',PYTHONDONTWRITEBYTECODE='1')
    return env


def advisory_git_command(*args:str,allow_https:bool=False) -> list[str]:
    command=['git','--no-replace-objects','-c','core.hooksPath=/dev/null','-c','init.templateDir=',
             '-c','core.attributesFile=/dev/null','-c','protocol.allow=never','-c','protocol.file.allow=always']
    if allow_https:command+=['-c','protocol.https.allow=always']
    return command+list(args)


def advisory_git(directory:Path,*args:str,timeout:int=30) -> bytes:
    return subprocess.check_output(advisory_git_command(*args),cwd=directory,env=advisory_git_environment(),stderr=subprocess.PIPE,timeout=timeout)


def _ordinary(path:Path) -> Path:
    path=source.no_link_parents(path)
    require(path.is_file(),'missing ordinary advisory file')
    return path


def _hex(value,size):
    return isinstance(value,str) and len(value)==size and all(c in '0123456789abcdef' for c in value)


def _boundary(data,commit):
    require(len(data)==41 and data[-1:]==b'\n' and data[:-1]==commit.encode('ascii'),'invalid original shallow boundary')


def read_advisory_state(database:Path,expected_commit:str,*,require_worktree:bool=False) -> tuple[str,bytes]:
    require(_hex(expected_commit,40),'invalid database commit')
    database=source.no_link_parents(Path(database))
    require(database.is_dir(),'missing advisory database')
    gitdir=database/'.git' if (database/'.git').exists() or (database/'.git').is_symlink() else database
    source.no_link_parents(gitdir);require(gitdir.is_dir(),'external advisory Git directory')
    # No file or directory inside the private object store may refer elsewhere.
    for parent,directories,files in os.walk(gitdir,followlinks=False):
        for name in directories+files:require(not (Path(parent)/name).is_symlink(),'linked advisory Git storage')
    for name in ('objects/info/alternates','objects/info/http-alternates','info/grafts','commondir'):
        require(not (gitdir/name).exists(),'external advisory object storage or grafts')
    require(not any((gitdir/'objects/pack').glob('*.promisor')),'partial advisory clone')
    _ordinary(gitdir/'config')
    # Inspect without includes before any object operation. Fresh clones have
    # only these inert keys; reject overrides such as fsck.*, filters or includes.
    configuration=advisory_git(database,'config','--file',str(gitdir/'config'),'--no-includes','--null','--list')
    for entry in configuration.split(b'\0'):
        if not entry:continue
        key=entry.split(b'\n',1)[0].decode().lower()
        require(key in ('core.repositoryformatversion','core.filemode','core.bare','core.logallrefupdates','remote.origin.url','remote.origin.fetch') or
                (key.startswith('branch.') and key.rsplit('.',1)[-1] in ('remote','merge')),'unsupported advisory Git configuration')
    actual_gitdir=Path(advisory_git(database,'rev-parse','--absolute-git-dir').decode().strip())
    require(actual_gitdir==gitdir,'external advisory Git directory')
    require(advisory_git(database,'rev-parse','--show-object-format').strip()==b'sha1','unsupported advisory object format')
    bare=advisory_git(database,'rev-parse','--is-bare-repository').strip()==b'true'
    require(bare==(gitdir==database) and not (require_worktree and bare),'unexpected advisory worktree')
    require(advisory_git(database,'rev-parse','HEAD').decode().strip()==expected_commit,'captured database changed')
    require(advisory_git(database,'cat-file','-t',expected_commit).strip()==b'commit','invalid advisory HEAD type')
    tree=advisory_git(database,'rev-parse','HEAD^{tree}').decode().strip();require(_hex(tree,40),'invalid advisory tree')
    boundary=_ordinary(gitdir/'shallow').read_bytes();_boundary(boundary,expected_commit)
    require(advisory_git(database,'rev-parse','--is-shallow-repository').strip()==b'true','database is not shallow')
    if not bare:require(not advisory_git(database,'status','--porcelain','--untracked-files=all'),'advisory worktree changed')
    return tree,boundary


def validate_advisory_snapshot_metadata(audit:dict) -> dict:
    require(isinstance(audit,dict) and type(audit.get('schemaVersion')) is int and audit['schemaVersion']==2,'audit schema v2 required')
    require(_hex(audit.get('dbCommit'),40),'invalid database commit')
    snapshot=audit.get('dbSnapshot')
    require(isinstance(snapshot,dict) and set(snapshot)=={'format','tree','bundle','shallow'},'invalid advisory snapshot fields')
    require(snapshot['format']=='git-shallow-bundle-v1' and _hex(snapshot['tree'],40),'invalid advisory snapshot format/tree')
    for kind in ('bundle','shallow'):
        pin=snapshot[kind]
        require(isinstance(pin,dict) and set(pin)=={'path','size','sha256'},'invalid advisory snapshot pin')
        require(pin['path']=='advisory-db.'+kind and type(pin['size']) is int and
                (1<=pin['size']<=8*1024**2 if kind=='bundle' else pin['size']==41) and _hex(pin['sha256'],64),'invalid advisory snapshot metadata')
    return snapshot


def read_advisory_snapshot(audit_directory:Path,audit:dict) -> tuple[Path,bytes]:
    snapshot=validate_advisory_snapshot_metadata(audit);directory=source.no_link_parents(Path(audit_directory))
    data={}
    for kind in ('bundle','shallow'):
        pin=snapshot[kind];path=_ordinary(directory/pin['path'])
        require(path.stat().st_size==pin['size'],'advisory snapshot bytes differ')
        data[kind]=path.read_bytes()
        require(len(data[kind])==pin['size'] and source.sha(data[kind])==pin['sha256'],'advisory snapshot bytes differ')
    _boundary(data['shallow'],audit['dbCommit'])
    return directory/snapshot['bundle']['path'],data['shallow']


def verify_advisory_database(database:Path,audit_directory:Path,audit:dict) -> None:
    _,boundary=read_advisory_snapshot(audit_directory,audit)
    tree,actual_boundary=read_advisory_state(database,audit['dbCommit'])
    require(tree==audit['dbSnapshot']['tree'] and actual_boundary==boundary,'captured advisory snapshot changed')
    advisory_git(database,'fsck','--full','--no-reflogs')


def restore_advisory_snapshot(audit_directory:Path,database:Path,audit:dict) -> None:
    bundle,boundary=read_advisory_snapshot(audit_directory,audit)
    database=source.no_link_parents(Path(database))
    require(not database.exists(),'advisory database destination already exists')
    advisory_git(database.parent,'clone','--bare','--',str(bundle),str(database))
    # Only the new clone receives the exact captured bytes; never repair sources.
    with (database/'shallow').open('xb') as output:output.write(boundary)


def verify_advisory_bundle(bundle,expected_commit,*,snapshot):
    """Reconstruct and fully verify the original boundary in a private clone."""
    with tempfile.TemporaryDirectory(prefix='openfilm-advisory-bundle-') as private:
        database=Path(private)/'database.git';audit=dict(schemaVersion=2,dbCommit=expected_commit,dbSnapshot=snapshot)
        require(Path(bundle).name=='advisory-db.bundle','invalid advisory bundle path')
        restore_advisory_snapshot(Path(bundle).parent,database,audit)
        verify_advisory_database(database,Path(bundle).parent,audit)


def retain_advisory_bundle(database,bundle,expected_commit,*,captured=None):
    """Retain original shallow bytes; never infer a boundary or fetch history."""
    database=Path(database);bundle=source.no_link_parents(Path(bundle));sidecar=source.no_link_parents(bundle.with_name('advisory-db.shallow'))
    require(bundle.name=='advisory-db.bundle','invalid advisory bundle path')
    require(not bundle.exists() and not sidecar.exists(),'database snapshot destination already exists')
    current=read_advisory_state(database,expected_commit)
    if captured is not None:require(current==captured,'database changed during scans')
    tree,boundary=current if captured is None else captured
    data=advisory_git(database,'bundle','create','-','HEAD')
    with bundle.open('xb') as output:output.write(data)
    with sidecar.open('xb') as output:output.write(boundary)
    snapshot=dict(format='git-shallow-bundle-v1',tree=tree)
    for kind,path in (('bundle',bundle),('shallow',sidecar)):
        data=_ordinary(path).read_bytes();snapshot[kind]=dict(path=path.name,size=len(data),sha256=source.sha(data))
    verify_advisory_bundle(bundle,expected_commit,snapshot=snapshot)
    return snapshot


def capture_audits(repository,output):
    repository=Path(repository).resolve();output=Path(output).resolve();output.mkdir(parents=True,exist_ok=True)
    record=dict(schemaVersion=2,candidateSHA=closure.candidate(repository),verified=False,dbFresh=False,reports={},errors=[],currentRegistryGraphEquivalent=False)
    def capture(command,name,cwd=repository,timeout=1200,env=None):return controls.capture(command,cwd,output/name,timeout,env=env)
    def must(command,name,cwd=repository,timeout=1200,env=None):
        run=capture(command,name,cwd,timeout,env);require(run['returncode']==0 and not run['timeout'],name+' failed; raw process retained');return run['stdout']
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
        must(advisory_git_command('clone','--depth','1',DB_URL,str(db),allow_https=True),'db-fetch',timeout=180,env=advisory_git_environment())
        db_commit=must(advisory_git_command('rev-parse','HEAD'),'db-commit',db,60,env=advisory_git_environment()).decode().strip()
        require(len(db_commit)==40 and all(c in '0123456789abcdef' for c in db_commit),'invalid DB Git commit')
        record.update(dbCommit=db_commit,dbFresh=True,dbFetchedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),dbURL=DB_URL)
        captured=read_advisory_state(db,db_commit,require_worktree=True)
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
        require(read_advisory_state(db,db_commit,require_worktree=True)==captured,'database changed during scans')
        require(source.verify_source(repository)==before,'source changed during scans')
        require((repository/closure.APP/'Cargo.lock').read_bytes()==lock,'lock changed during scans')
        record['dbSnapshot']=retain_advisory_bundle(db,output/'advisory-db.bundle',db_commit,captured=captured)
        record['verified']=True
    except (ValueError,OSError,KeyError,TypeError,subprocess.SubprocessError) as exc:record['errors'].append(str(exc))
    (output/'audit.json').write_bytes(source.canonical(record));return record


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--repository',required=True,type=Path);parser.add_argument('--output',required=True,type=Path)
    args=parser.parse_args();record=capture_audits(args.repository,args.output)
    print('Captured native raw audits' if record['verified'] else 'Native audit capture blocked; inspect audit.json')
    return 0 if record['verified'] else 1

if __name__=='__main__':sys.exit(main())
