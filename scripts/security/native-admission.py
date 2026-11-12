#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Strict source-aware native admission. Raw upstream version remains affected."""
import argparse
import datetime
import importlib.util
import json
from pathlib import Path
import sys
import subprocess

HERE=Path(__file__).resolve().parent

def module(name,file):
    spec=importlib.util.spec_from_file_location(name,HERE/file);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

closure=module('closure','verify-glib-closure.py');source=closure.source
controls=module('controls','run-glib-controls.py')
auditor=module('auditor','audit-native.py')
require=source.require
REGISTRY='registry+https://github.com/rust-lang/crates.io-index'


def no_duplicates(pairs):
    result={}
    for key,value in pairs:
        require(key not in result,'duplicate JSON key');result[key]=value
    return result


def parse_raw(data):
    try:value=json.loads(data,object_pairs_hook=no_duplicates)
    except (UnicodeError,json.JSONDecodeError) as exc:raise ValueError('malformed/truncated scanner JSON') from exc
    validate_shape(value)
    return value


def validate_shape(raw):
    require(isinstance(raw,dict) and set(raw)=={'database','lockfile','settings','vulnerabilities','warnings'},'unknown scanner report shape')
    database=raw['database'];require(isinstance(database,dict) and set(database)=={'advisory-count','last-commit','last-updated'},'unknown database shape')
    require(type(database['advisory-count']) is int and database['advisory-count']>0,'invalid advisory count')
    # Observed cargo-audit0.22.2 --no-fetch leaves these fields null. The capture
    # receipt binds the independently fetched Git DB identity for all three scans.
    require(database['last-commit'] is None and database['last-updated'] is None,'unreviewed scanner database metadata behavior')
    require(set(raw['lockfile'])=={'dependency-count'} and type(raw['lockfile']['dependency-count']) is int and raw['lockfile']['dependency-count']>0,'invalid dependency count')
    settings=raw['settings'];require(set(settings)=={'target_arch','target_os','severity','ignore','informational_warnings'},'unknown scanner settings')
    require(settings['target_arch']==[] and settings['target_os']==[] and settings['severity'] is None and settings['ignore']==[] and settings['informational_warnings']==['unmaintained','unsound','notice'],'scanner filters or ignored records')
    vulnerability=raw['vulnerabilities']
    require(set(vulnerability)=={'found','count','list'} and type(vulnerability['count']) is int and type(vulnerability['found']) is bool and isinstance(vulnerability['list'],list),'unknown vulnerability schema')
    require(vulnerability['count']==len(vulnerability['list']) and vulnerability['found']==bool(vulnerability['list']),'inconsistent vulnerability counts')
    warnings=raw['warnings'];require(isinstance(warnings,dict) and set(warnings)<={'unmaintained','unsound','notice','yanked'},'unknown warning category')
    for category,entries in warnings.items():
        require(isinstance(entries,list),'invalid warnings list')
        for record in entries:
            require(isinstance(record,dict) and set(record)=={'kind','package','advisory','affected','versions'},'unknown warning record')
            require(record['kind']==category,'warning category mismatch')
            package=record['package'];require(isinstance(package,dict) and set(package)=={'name','version','source','checksum','dependencies','replace'},'unknown scanner package record')
            require(isinstance(package['name'],str) and isinstance(package['version'],str) and isinstance(package['dependencies'],list) and package['replace'] is None,'malformed package identity')
            advisory=record['advisory'];require(set(advisory)=={'aliases','categories','collection','cvss','date','description','expect-deleted','id','informational','keywords','license','package','references','related','source','title','url','withdrawn'},'unknown advisory schema')
            require(isinstance(advisory,dict) and isinstance(advisory.get('id'),str) and advisory.get('informational')==category and advisory.get('package')==package['name'],'malformed advisory identity/category')
            require(set(record['versions'])=={'patched','unaffected'} and all(isinstance(v,list) and all(isinstance(x,str) for x in v) for v in record['versions'].values()),'invalid affected versions')


def glib_finding(record,allow_path=False):
    package=record['package'];advisory=record['advisory']
    require(record['kind']=='unsound' and advisory['id']=='RUSTSEC-2024-0429' and advisory['informational']=='unsound','wrong GLib advisory/category')
    require(package['name']=='glib' and package['version']=='0.18.5' and
            (package['source']==REGISTRY or (allow_path and package['source'] is None)),'wrong GLib package/source/version')
    if package['source']==REGISTRY:require(package['checksum']==source.ARCHIVE_SHA,'wrong GLib registry checksum')
    require(record['versions']=={'patched':['>=0.20.0'],'unaffected':['<0.15.0']},'changed GLib affected version range')
    expected={f'glib::VariantStrIter::{method}':['>=0.15.0, <0.20.0'] for method in ('last','next','next_back','nth','nth_back')}
    require(record['affected']=={'arch':[],'os':[],'functions':expected},'changed GLib affected methods/range')
    require(advisory['withdrawn'] is None and advisory['date']=='2024-03-30' and advisory['aliases']==['GHSA-wrw7-89jp-8q8g'],'changed GLib advisory semantics')


def validate_report(name,report,db_commit):
    require(report.get('validatedBytes') is True,'raw report bytes not validated')
    require(report['dbCommit']==db_commit,'database mismatch')
    require(report['stderr']=='','scanner infrastructure error/stderr')
    raw=report['raw'];validate_shape(raw)
    require(raw['lockfile']['dependency-count']==report['dependencyCount'],'raw lock dependency count mismatch')
    require(not raw['vulnerabilities']['found'],'additional vulnerability')
    unsound=raw['warnings'].get('unsound',[])
    require(report['returncode']==(1 if unsound else 0),'scanner status inconsistent with --deny unsound findings')
    glib=[]
    for record in unsound:
        if record['advisory']['id']=='RUSTSEC-2024-0429':glib_finding(record,allow_path=name=='actual');glib.append(record)
        else:raise ValueError('additional current unsound advisory: '+record['advisory']['id'])
    require(len(glib)==(0 if name=='actual' else 1),'actual patched scan or registry baseline GLib result mismatch')
    require(any(record['advisory']['id']=='RUSTSEC-2024-0370' and record['package']['name']=='proc-macro-error' and record['package']['version']=='1.0.4' for record in raw['warnings'].get('unmaintained',[])),'known proc-macro-error warning missing')
    return raw


def evaluate_native(source_evidence,closure_evidence,regression,audit):
    result=dict(schemaVersion=1,candidateSHA=audit.get('candidateSHA'),upstreamVersionAffected=True,
                sourceRemediation='unverified',admission='blocked',reasons=[],reports=audit.get('reports',{}),evidenceDigests={})
    for name,value in [('source',source_evidence),('closure',closure_evidence),('regression',regression),('audit',audit)]:result['evidenceDigests'][name]=source.sha(source.canonical(value))
    try:
        require(source_evidence.get('verified') is True and source_evidence.get('linuxModesVerified') is True and source_evidence.get('patchedTreeSHA256')==source.PATCHED_SHA,'source not verified on Linux')
        require(closure_evidence.get('verified') is True and closure_evidence.get('target')==closure.TARGET and closure_evidence.get('patchedTreeSHA256')==source.PATCHED_SHA,'Linux closure not verified')
        require(regression.get('verified') is True and regression.get('sourceAndLockUnchanged') is True and controls.controls_verified(regression),'optimized controls incomplete or not reproduced')
        require(audit.get('verified') is True and audit.get('scannerVersion')=='cargo-audit-audit 0.22.2' and audit.get('dbFresh') is True,'scanner/capture/fresh database not verified')
        auditor.validate_advisory_snapshot_metadata(audit)
        fetched=datetime.datetime.fromisoformat(audit['dbFetchedAt'])
        require(fetched.tzinfo is not None and 0<=(datetime.datetime.now(datetime.timezone.utc)-fetched).total_seconds()<=21600,'stale/future advisory fetch timestamp')
        require(audit.get('sourceSHA256')==source.sha(source.canonical(source_evidence)),'source evidence digest mismatch')
        require(audit.get('originalLockSHA256')==source.LOCK_SHA and audit.get('originalLockBlob')==source.LOCK_BLOB,'wrong historical original lock identity')
        require(audit.get('currentRegistryGraphEquivalent') is True,'current registry graph missing/mismatched')
        for key in ('candidateSHA','lockSHA256','sourceSHA256'):
            require(audit.get(key) and audit[key]==closure_evidence.get(key)==regression.get(key),'stale/mismatched '+key)
        require(set(audit['reports'])=={'actual','currentRegistry','historical'},'incomplete three-graph audit')
        for name,report in audit['reports'].items():validate_report(name,report,audit['dbCommit'])
        require(len({r['raw']['database']['advisory-count'] for r in audit['reports'].values()})==1,'database advisory count mismatch')
        result.update(sourceRemediation='verified',admission='pass')
    except (ValueError,KeyError,TypeError) as exc:result['reasons'].append(str(exc))
    return result


def read_bound_file(root,relative,digest):
    path=source.no_link_parents(root/relative);require(path.is_relative_to(root),'evidence path escape')
    data=path.read_bytes();require(source.sha(data)==digest,'stale/tampered evidence bytes: '+relative);return data


def verify_admission(repository, directory, result=None):
    """Complete admission boundary shared by the CLI and pinned receipt replay."""
    repository=Path(repository).resolve();directory=Path(directory).resolve()
    if result is None:result=dict(schemaVersion=1,upstreamVersionAffected=True,sourceRemediation='unverified',admission='blocked',reasons=[])
    audit=json.loads((directory/'audit/audit.json').read_bytes(),object_pairs_hook=no_duplicates)
    auditor.validate_advisory_snapshot_metadata(audit)
    result['candidateSHA']=audit.get('candidateSHA');result['reports']=audit.get('reports',{})
    for name,report in audit['reports'].items():
        raw=read_bound_file(directory/'audit',report['stdoutFile'],report['stdoutSHA256'])
        stderr=read_bound_file(directory/'audit',report['stderrFile'],report['stderrSHA256'])
        report['raw']=parse_raw(raw);report['stderr']=stderr.decode();report['validatedBytes']=True
    actual_source=source.verify_source(repository)
    source_evidence=json.loads((directory/'source.json').read_bytes());require(actual_source==source_evidence,'source evidence changed')
    closure_evidence=json.loads((directory/'closure.json').read_bytes());regression=json.loads((directory/'controls/regression.json').read_bytes())
    require(audit['candidateSHA']==closure.candidate(repository),'stale checkout')
    require(not subprocess.check_output(['git','status','--porcelain','--untracked-files=all'],cwd=repository),'checkout differs from candidate commit')
    lock=(repository/closure.APP/'Cargo.lock').read_bytes()
    require(audit['lockSHA256']==source.sha(lock),'stale checkout lock')
    metadata=json.loads((directory/'metadata.json').read_bytes())
    core=closure.verify_closure(metadata,lock,repository,actual_source)
    require(all(closure_evidence.get(k)==v for k,v in core.items()),'stale/forged closure evidence')
    audit_actual=json.loads((directory/'audit/actual-metadata.stdout').read_bytes())
    audit_registry=json.loads((directory/'audit/current-registry-metadata.stdout').read_bytes())
    require(auditor.graph_identity(metadata,False)==auditor.graph_identity(audit_actual,False),'audit and closure graphs differ')
    require(auditor.compare_graphs(audit_actual,audit_registry,lock,(directory/'audit/current-registry-Cargo.lock').read_bytes()),'current registry graph differs')
    original=(directory/'audit/historical-Cargo.lock').read_bytes()
    require(source.sha(original)==source.LOCK_SHA,'captured historical lock changed')
    auditor.verify_advisory_database(directory/'audit/advisory-db',directory/'audit',audit)
    return evaluate_native(source_evidence,closure_evidence,regression,audit)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ('repository','output','evidence-dir'):parser.add_argument('--'+name,required=True,type=Path)
    args=parser.parse_args();args.output.unlink(missing_ok=True)
    result=dict(schemaVersion=1,upstreamVersionAffected=True,sourceRemediation='unverified',admission='blocked',reasons=[])
    try:
        repository=args.repository.resolve();directory=args.evidence_dir.resolve()
        result=verify_admission(repository,directory,result)
    except (ValueError,OSError,KeyError,TypeError,subprocess.SubprocessError) as exc:result['reasons'].append(str(exc))
    args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_bytes(source.canonical(result))
    print('Native security admission: '+result['admission'])
    return 0 if result['admission']=='pass' else 1

if __name__=='__main__':sys.exit(main())
