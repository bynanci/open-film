#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Admit only the actual locked Linux metadata graph with the reviewed GLib path."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tomllib

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('glib_source', HERE/'verify-glib-source.py')
source=importlib.util.module_from_spec(spec);spec.loader.exec_module(source)
require=source.require
TARGET='x86_64-unknown-linux-gnu'
APP='apps/desktop/src-tauri'
FAMILY={'glib':'0.18.5','glib-macros':'0.18.5','glib-sys':'0.18.1','gobject-sys':'0.18.0',
        'gio':'0.18.4','gio-sys':'0.18.1','gdk':'0.18.2','gdk-sys':'0.18.2',
        'gtk':'0.18.2','gtk-sys':'0.18.2','webkit2gtk':'2.0.2','webkit2gtk-sys':'2.0.2',
        'tauri':'2.12.1','tauri-runtime':'2.12.1','tauri-runtime-wry':'2.12.1',
        'wry':'0.57.0','tao':'0.37.1'}


def environment(repository):
    forbidden=('RUSTFLAGS','CARGO_ENCODED_RUSTFLAGS','RUSTC_WRAPPER','RUSTC_WORKSPACE_WRAPPER','RUSTC','RUSTDOCFLAGS','CARGO_BUILD_RUSTFLAGS','CARGO_BUILD_TARGET','CARGO_UNSTABLE_BUILD_STD')
    require(not any(os.environ.get(key) for key in forbidden), 'injected Cargo/compiler flags')
    require(not any(k.startswith(('CARGO_SOURCE_','CARGO_REGISTRIES_')) for k in os.environ), 'injected Cargo source registry')
    checked=set()
    cargo_home=Path(os.environ.get('CARGO_HOME',Path.home()/'.cargo'))
    roots=[cargo_home,Path.home()/'.cargo']+[p/'.cargo' for p in [repository,*repository.parents]]
    for root in roots:
        for name in ('config','config.toml'):
            p=root/name
            if p in checked:continue
            checked.add(p)
            require(not p.exists() and not p.is_symlink(),f'unreviewed Cargo configuration: {p}')
    return dict(policy='no Cargo source/config overrides or injected compiler flags',sha256=source.sha(source.canonical([])))


def candidate(repository):
    return subprocess.check_output(['git','rev-parse','HEAD'],cwd=repository,text=True).strip()


def verify_lock(lock,repository):
    require(lock == (repository/APP/'Cargo.lock').read_bytes(),'stale lock hash')
    current=tomllib.loads(lock.decode())
    original=tomllib.loads((repository/source.INPUTS/'original-registry-Cargo.lock').read_text())
    def normalized(value):
        result=[]
        for entry in value['package']:
            item=dict(entry)
            if item['name']=='glib':
                if value is current:
                    require(item['version']=='0.18.5' and 'source' not in item and 'checksum' not in item,'lock selects foreign GLib')
                item.pop('source',None);item.pop('checksum',None)
            if item['name']=='openfilm-desktop':
                item['dependencies']=[d for d in item.get('dependencies',[]) if d != 'glib']
            result.append(item)
        return sorted(result,key=lambda x:(x['name'],x['version'],x.get('source','')))
    require(normalized(current)==normalized(original),'unrelated application lock delta requires review')
    return source.sha(lock)


def verify_closure(metadata, lock, repository, source_evidence):
    repository=source.no_link_parents(Path(repository).absolute())
    fresh=source.verify_source(repository)
    require(fresh==source_evidence and fresh['linuxModesVerified'],'source evidence mismatch or Linux modes missing')
    config=environment(repository)
    lock_hash=verify_lock(lock,repository)
    require(metadata.get('version')==1,'unsupported metadata version')
    require(metadata.get('target',TARGET)==TARGET,'wrong target')
    app=repository/APP
    require(Path(metadata['workspace_root']).resolve()==app.resolve(),'wrong workspace/manifest root')
    packages=metadata['packages'];resolve=metadata['resolve'];nodes=resolve['nodes']
    by_id={p['id']:p for p in packages};by_node={n['id']:n for n in nodes}
    require(len(by_id)==len(packages) and len(by_node)==len(nodes),'duplicate package/resolve identity')
    root=resolve['root'];require(root in by_id and root in by_node,'missing root resolve node')
    root_package=by_id[root]
    require(root_package['name']=='openfilm-desktop' and root_package['version']=='1.0.0','wrong root package')
    require(source.no_link_parents(Path(root_package['manifest_path']))==app/'Cargo.toml','wrong root manifest')
    require(root in metadata['workspace_members'] and len(metadata['workspace_members'])==1,'alternate workspace roots')
    reached=set();edges=[];pending=[root]
    while pending:
        identity=pending.pop()
        if identity in reached:continue
        require(identity in by_node and identity in by_id,'missing resolve node/package')
        reached.add(identity)
        for dep in by_node[identity]['deps']:
            require(dep['pkg'] in by_id and dep['pkg'] in by_node,'missing dependency node')
            edges.append(dict(parent=identity,package=dep['pkg'],kinds=dep['dep_kinds']))
            pending.append(dep['pkg'])
    family={}
    for name,version in FAMILY.items():
        matches=[p for p in packages if p['name']==name]
        require(len(matches)==1 and matches[0]['version']==version,f'foreign or duplicate {name} family')
        p=matches[0];require(p['id'] in reached,f'{name} absent from actual closure')
        if name=='glib':
            path=source.no_link_parents(Path(p['manifest_path']))
            require(p['source'] is None and path==repository/source.VENDOR/'Cargo.toml','GLib not the reviewed path')
        else:
            require(p['source']=='registry+https://github.com/rust-lang/crates.io-index',f'foreign family source: {name}')
        family[name]=dict(packageID=p['id'],version=version,source=p['source'],features=sorted(by_node[p['id']]['features']))
    glib=next(p for p in packages if p['name']=='glib')
    return dict(schemaVersion=1,verified=True,target=TARGET,rootPackageID=root,
                glib=dict(packageID=glib['id'],version=glib['version'],source=glib['source'],manifest=source.VENDOR+'/Cargo.toml',features=sorted(by_node[glib['id']]['features'])),
                family=family,edges=edges,reachablePackages=sorted(reached),lockSHA256=lock_hash,
                sourceSHA256=source.sha(source.canonical(fresh)),patchedTreeSHA256=fresh['patchedTreeSHA256'],
                manifestSHA256=source.sha((app/'Cargo.toml').read_bytes()),config=config,
                metadataSHA256=source.sha(source.canonical(metadata)))


def reachability(metadata):
    findings=[]
    for package in metadata['packages']:
        root=Path(package['manifest_path']).parent
        if root.is_dir():
            for path in sorted(root.rglob('*.rs')):
                if path.is_symlink() or not path.is_file():continue
                for number,line in enumerate(path.read_text(errors='replace').splitlines(),1):
                    if 'VariantStrIter' in line or 'array_iter_str' in line:
                        findings.append(dict(packageID=package['id'],file=path.relative_to(root).as_posix(),line=number,text=line))
    return dict(scope='exact fetched metadata package source text; text matches do not prove binary reachability or absence',findings=findings)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ('metadata','lock','source','repository','output'):parser.add_argument('--'+name,required=True,type=Path)
    args=parser.parse_args();args.output.unlink(missing_ok=True)
    try:
        metadata=json.loads(args.metadata.read_bytes())
        evidence=verify_closure(metadata,args.lock.read_bytes(),args.repository,json.loads(args.source.read_bytes()))
        evidence['candidateSHA']=candidate(args.repository)
        evidence['reachability']=reachability(metadata)
        args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_bytes(source.canonical(evidence))
    except (ValueError,OSError,KeyError,TypeError,subprocess.SubprocessError) as exc:
        print(f'GLib closure refused: {exc}',file=sys.stderr);return 1
    print('Verified locked Linux GLib source closure.');return 0

if __name__=='__main__':sys.exit(main())
