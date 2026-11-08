#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Run isolated optimized GLib controls; missing reproduction always blocks."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import platform
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('closure',HERE/'verify-glib-closure.py')
closure=importlib.util.module_from_spec(spec);spec.loader.exec_module(closure)
source=closure.source
METHODS=['glib_next','glib_nth','glib_last','glib_next_back','glib_nth_back']
PROFILE={'opt-level':3,'lto':False,'codegen-units':16,'debug':False,'overflow-checks':False,'panic':'unwind'}
TEST_SOURCE='apps/desktop/src-tauri/tests/glib_variant_str_iter.rs'


def capture(command,cwd,prefix,timeout=1200,env=None):
    prefix.parent.mkdir(parents=True,exist_ok=True)
    started=time.monotonic();timed_out=False
    try:
        p=subprocess.Popen(command,cwd=cwd,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
        try:stdout,stderr=p.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            timed_out=True;os.killpg(p.pid,signal.SIGKILL);stdout,stderr=p.communicate()
        code=p.returncode
    except OSError as exc:
        stdout=b'';stderr=str(exc).encode();code=None
    prefix.with_suffix('.stdout').write_bytes(stdout);prefix.with_suffix('.stderr').write_bytes(stderr)
    result=dict(command=[str(c) for c in command],returncode=code,signal=-code if code is not None and code<0 else None,timeout=timed_out,
                stdout=stdout,stderr=stderr,stdoutSHA256=source.sha(stdout),stderrSHA256=source.sha(stderr),
                stdoutFile=str(prefix.with_suffix('.stdout')),stderrFile=str(prefix.with_suffix('.stderr')),seconds=round(time.monotonic()-started,3))
    return result


def serial(record):return {k:v for k,v in record.items() if k not in ('stdout','stderr')}


def classify(record,baseline=False):
    if record['timeout']:return 'timeout'
    if record['returncode'] is None:return 'infrastructure-failure'
    if record['returncode']==0 and b'test result: ok. 1 passed; 0 failed;' in record['stdout']:
        return 'not-reproduced' if baseline else 'passed'
    if record['returncode']==-signal.SIGSEGV:
        if baseline and record.get('nullPointerUB') is True:return 'reproduced-null-pointer-ub'
        return 'crash-unattributed'
    return 'blocked-failure'


def null_pointer_diagnostic(text,returncode,timeout):
    if returncode!=0 or timeout:return False
    fault=re.search(r'(?m)^#0\s+.*(?:^|\s)\S*strlen\S*\b',text)
    affected=re.search(r'(?m)^#\d+\s+.*(?:glib::variant_iter::VariantStrIter|CStr::from_ptr)',text)
    null_argument=re.search(r'(?im)^\s*rdi\s+0x0(?:\s|$)',text)
    return 'SIGSEGV' in text and fault is not None and affected is not None and null_argument is not None


def diagnose(executable,method,output,env):
    # A signal alone is insufficient attribution. Retain a debugger rerun and
    # require a null pointer at the affected iterator/CStr stack before admitting.
    if not shutil.which('gdb'):return dict(verified=False,reason='gdb unavailable; crash attribution requires review')
    record=capture(['gdb','--batch','-ex','run','-ex','bt 30','-ex','info registers','--args',str(executable),'--exact',method,'--nocapture','--test-threads=1'],
                   executable.parent,output/('diagnosis-'+method),timeout=60,env=env)
    text=(record['stdout']+record['stderr']).decode(errors='replace')
    verified=null_pointer_diagnostic(text,record['returncode'],record['timeout'])
    return dict(verified=verified,process=serial(record),reason='strict null-pointer/affected-stack diagnostic' if verified else 'crash requires independent attribution')


def run_methods(executable,output,timeout=30,baseline=False,env=None):
    output.mkdir(parents=True,exist_ok=True);records=[]
    for method in METHODS:
        raw=capture([str(executable),'--exact',method,'--nocapture','--test-threads=1'],executable.parent,output/method,timeout,env)
        diagnostic=None
        if baseline and raw['returncode']==-signal.SIGSEGV:
            diagnostic=diagnose(executable,method,output,env);raw['nullPointerUB']=diagnostic['verified']
        record=serial(raw);record.update(method=method,outcome=classify(raw,baseline),
                                        executableSHA256=source.sha(executable.read_bytes()) if executable.is_file() else None)
        if diagnostic:record['diagnostic']=diagnostic
        records.append(record)
    return records


def controls_verified(record):
    try:
        if not re.search(r'^release: 1\.99\.0$',record['compiler'],re.M):return False
        if record['profile']!=PROFILE or record['sourceSHA256']!=record['expectedSourceSHA256']:return False
        directories=record['targetDirectories']
        if len(directories)!=3 or len({str(Path(p).resolve()) for p in directories})!=3:return False
        if record['nativeBuild']['returncode']!=0 or record['nativeBuild']['timeout']:return False
        identities=record['transitiveIdentities']
        if not identities['baseline'] or identities['baseline']!=identities['patched'] or identities['patched']!=identities['application']:return False
        for group,want in [('baseline','reproduced-null-pointer-ub'),('patched','passed'),('application','passed')]:
            rows=record[group]
            if [row['method'] for row in rows]!=METHODS:return False
            if any(row['outcome']!=want or not row.get('executableSHA256') for row in rows):return False
        return True
    except (KeyError,TypeError,ValueError):return False


def glib_packages(metadata):
    packages={p['id']:p for p in metadata['packages']};nodes={n['id']:n for n in metadata['resolve']['nodes']}
    matches=[p for p in packages.values() if p['name']=='glib'];source.require(len(matches)==1,'control has duplicate/missing GLib')
    glib=matches[0];pending=[glib['id']];seen=set()
    while pending:
        identity=pending.pop()
        if identity in seen:continue
        seen.add(identity);pending.extend(d['pkg'] for d in nodes[identity]['deps'])
    return [(packages[i],nodes[i]) for i in sorted(seen) if i!=glib['id']],glib,nodes[glib['id']]


def identities(metadata):
    return sorted([dict(name=p['name'],version=p['version'],source=p['source'],features=sorted(n['features']))
                   for p,n in glib_packages(metadata)[0]],key=lambda x:(x['name'],x['version'],x['source'] or ''))


def executable_from_build(raw):
    source.require(raw['returncode']==0 and not raw['timeout'],'control compile failure; not reproduction')
    artifacts=[]
    for line in raw['stdout'].splitlines():
        message=json.loads(line)
        if message.get('reason')=='compiler-artifact' and message.get('target',{}).get('name')=='glib_variant_str_iter' and message.get('executable'):
            source.require(message['profile']['opt_level']=='3' and message['profile']['debug_assertions'] is False and message['profile']['debuginfo'] in (0,None),'debug/incorrect test artifact')
            artifacts.append(Path(message['executable']))
    source.require(len(set(artifacts))==1 and artifacts[0].is_file(),'missing or ambiguous test executable')
    return artifacts[0]


def blocked_methods(reason):return [dict(method=m,outcome='infrastructure-failure',reason=reason,executableSHA256=None) for m in METHODS]


def compare_snapshots(before,after):
    source.require(before==after and set(before)=={'source','lock','manifest','config'},'source/lock/manifest/Cargo configuration changed during build')


def input_snapshot(repository):
    return dict(source=source.sha(source.canonical(source.verify_source(repository))),lock=source.sha((repository/closure.APP/'Cargo.lock').read_bytes()),manifest=source.sha((repository/closure.APP/'Cargo.toml').read_bytes()),config=closure.environment(repository))


def run_controls(repository,evidence_dir):
    repository=Path(repository).resolve();evidence_dir=Path(evidence_dir).resolve();evidence_dir.mkdir(parents=True,exist_ok=True)
    record=dict(schemaVersion=1,candidateSHA=closure.candidate(repository),verified=False,profile=PROFILE,
                baseline=blocked_methods('not run'),patched=blocked_methods('not run'),application=blocked_methods('not run'),errors=[],
                compiler='',target=closure.TARGET,transitiveIdentities={},targetDirectories=[])
    try:
        before=source.verify_source(repository);snapshot=input_snapshot(repository)
        record['inputSnapshotBefore']=snapshot
        record['sourceSHA256']=source.sha(source.canonical(before));record['expectedSourceSHA256']=record['sourceSHA256']
        lock=(repository/closure.APP/'Cargo.lock').read_bytes();record['lockSHA256']=closure.verify_lock(lock,repository)
        test=(repository/TEST_SOURCE).read_bytes();record['harnessSHA256']=source.sha(test)
        compiler=capture(['rustc','+1.99.0','-Vv'],repository,evidence_dir/'rustc',60)
        source.require(compiler['returncode']==0,'compiler identity unavailable');record['compiler']=compiler['stdout'].decode()
        source.require(re.search(r'^release: 1\.99\.0$',record['compiler'],re.M),'wrong Rust version')
        record['host']=dict(os=platform.platform(),kernel=platform.release(),machine=platform.machine(),
                            environment={k:v for k,v in os.environ.items() if k.startswith(('PKG_CONFIG','CARGO_PROFILE_')) or k in ('CC','CXX','LD_LIBRARY_PATH')})
        record['systemLibraries']={}
        for name,command in {'glib':['pkg-config','--modversion','glib-2.0'],'gio':['pkg-config','--modversion','gio-2.0'],'gtk':['pkg-config','--modversion','gtk+-3.0'],'webkit':['pkg-config','--modversion','webkit2gtk-4.1'],'linker':['cc','--version'],'developmentPackages':['dpkg-query','-W','libglib2.0-dev','libgtk-3-dev','libwebkit2gtk-4.1-dev']}.items():
            record['systemLibraries'][name]=serial(capture(command,repository,evidence_dir/('system-'+name),30))
        raw=capture(['cargo','+1.99.0','metadata','--locked','--format-version','1','--filter-platform',closure.TARGET,'--manifest-path',str(repository/closure.APP/'Cargo.toml')],repository,evidence_dir/'application-metadata')
        source.require(raw['returncode']==0,'application metadata failure')
        metadata=json.loads(raw['stdout']);admitted=closure.verify_closure(metadata,lock,repository,before)
        record['transitiveIdentities']['application']=identities(metadata)
        record['closureSHA256']=source.sha(source.canonical(admitted))
        profile_env=dict(os.environ)
        for k,v in PROFILE.items():profile_env['CARGO_PROFILE_RELEASE_'+k.upper().replace('-','_')]=str(v).lower()
        with tempfile.TemporaryDirectory(prefix='openfilm-glib-controls-') as scratch:
            scratch=Path(scratch)
            for group,tree_hash in [('baseline',source.PRISTINE_SHA),('patched',source.PATCHED_SHA)]:
                work=scratch/group;work.mkdir();crate=work/'glib'
                files=source.parse_archive((repository/source.INPUTS/'glib-0.18.5.crate').read_bytes())
                if group=='baseline':source.write_tree(crate,files)
                else:shutil.copytree(repository/source.VENDOR,crate)
                source.require(source.sha(source.canonical(source.inventory_tree(crate)))==tree_hash,'wrong control source')
                harness=work/'harness';harness.mkdir();(harness/'tests').mkdir();(harness/'tests/glib_variant_str_iter.rs').write_bytes(test)
                packages,glib,node=glib_packages(metadata)
                manifest='[package]\nname="openfilm-glib-control"\nversion="0.0.0"\nedition="2021"\nresolver="2"\n[workspace]\n[dependencies]\n'
                manifest+='glib={path="../glib",version="=0.18.5",default-features=false,features='+json.dumps(sorted(node['features']))+'}\n'
                # Explicit aliases pin every transitive version/feature from the app,
                # including build/proc-macro edges. Compare actual resolved metadata.
                for i,(p,n) in enumerate(packages):
                    source.require(p['source']=='registry+https://github.com/rust-lang/crates.io-index','foreign transitive source')
                    manifest+=f'pin{i}={{package={json.dumps(p["name"])},version="={p["version"]}",default-features=false,features={json.dumps(sorted(n["features"]))}}}\n'
                (harness/'Cargo.toml').write_text(manifest);(harness/'Cargo.lock').write_bytes(lock)
                group_dir=evidence_dir/group;group_dir.mkdir(exist_ok=True)
                (group_dir/'Cargo.toml').write_text(manifest);(group_dir/'glib_variant_str_iter.rs').write_bytes(test)
                env=dict(profile_env,CARGO_TARGET_DIR=str(work/'target'));record['targetDirectories'].append(env['CARGO_TARGET_DIR'])
                try:
                    raw=capture(['cargo','+1.99.0','metadata','--format-version','1','--filter-platform',closure.TARGET,'--manifest-path',str(harness/'Cargo.toml')],work,group_dir/'metadata',env=env)
                    source.require(raw['returncode']==0,'control metadata failure')
                    resolved=json.loads(raw['stdout']);record['transitiveIdentities'][group]=identities(resolved)
                    resolved_glib=glib_packages(resolved)
                    source.require(resolved_glib[1]['source'] is None and Path(resolved_glib[1]['manifest_path']).resolve()==crate/'Cargo.toml','wrong control resolved source')
                    source.require(sorted(resolved_glib[2]['features'])==sorted(node['features']),'GLib feature mismatch')
                    source.require(identities(resolved)==identities(metadata),'transitive version/feature mismatch')
                    (group_dir/'Cargo.lock').write_bytes((harness/'Cargo.lock').read_bytes())
                    record[group+'LockSHA256']=source.sha((harness/'Cargo.lock').read_bytes())
                    record[group+'SourceTreeSHA256']=tree_hash
                    raw=capture(['cargo','+1.99.0','test','--locked','--release','--manifest-path',str(harness/'Cargo.toml'),'--test','glib_variant_str_iter','--no-run','--message-format=json'],work,group_dir/'build',env=env)
                    executable=executable_from_build(raw)
                    shutil.copy2(executable,group_dir/'test-executable')
                    record[group]=run_methods(executable,group_dir,baseline=group=='baseline',env=env)
                except (ValueError,OSError,KeyError,TypeError) as exc:
                    record[group]=blocked_methods(str(exc));record['errors'].append(group+': '+str(exc))
                source.require(source.sha(source.canonical(source.inventory_tree(crate)))==tree_hash,'control source changed during build')
            target=scratch/'application-target';record['targetDirectories'].append(str(target))
            env=dict(profile_env,CARGO_TARGET_DIR=str(target))
            native=capture(['cargo','+1.99.0','build','--locked','--release','--manifest-path',str(repository/closure.APP/'Cargo.toml')],repository,evidence_dir/'native-build',env=env)
            record['nativeBuild']=serial(native)
            raw=capture(['cargo','+1.99.0','test','--locked','--release','--manifest-path',str(repository/closure.APP/'Cargo.toml'),'--test','glib_variant_str_iter','--no-run','--message-format=json'],repository,evidence_dir/'application-build',env=env)
            try:record['application']=run_methods(executable_from_build(raw),evidence_dir/'application',env=env)
            except (ValueError,OSError,KeyError,TypeError) as exc:record['application']=blocked_methods(str(exc));record['errors'].append('application: '+str(exc))
        source.require(source.verify_source(repository)==before,'source changed during execution')
        source.require((repository/closure.APP/'Cargo.lock').read_bytes()==lock,'lock changed during execution')
        after=input_snapshot(repository);compare_snapshots(snapshot,after)
        record['inputSnapshotAfter']=after
        record['sourceAndLockUnchanged']=True
        record['verified']=controls_verified(record)
    except (ValueError,OSError,KeyError,TypeError,subprocess.SubprocessError) as exc:
        record['errors'].append(str(exc))
    (evidence_dir/'regression.json').write_bytes(source.canonical(record))
    return record


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--repository',required=True,type=Path);parser.add_argument('--output',required=True,type=Path)
    args=parser.parse_args();record=run_controls(args.repository,args.output)
    print('GLib optimized controls: '+('verified' if record['verified'] else 'blocked; inspect regression.json and raw process files'))
    return 0 if record['verified'] else 1

if __name__=='__main__':sys.exit(main())
