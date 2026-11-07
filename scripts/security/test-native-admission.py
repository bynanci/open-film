# SPDX-License-Identifier: Apache-2.0
import copy
import importlib.util
import json
from pathlib import Path
import unittest

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('admission',HERE/'native-admission.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)


class AdmissionTests(unittest.TestCase):
    def setUp(self):
        self.registry=json.loads((HERE/'fixtures/observed-0.22.2-registry-baseline.stdout').read_bytes())
        self.actual=json.loads((HERE/'fixtures/observed-0.22.2-actual-path-patched.stdout').read_bytes())
        self.historical=json.loads((HERE/'fixtures/observed-0.22.2-historical.stdout').read_bytes())

    def fixture(self):
        # Synthetic eligible protocol case. Never a checked-in successful scan.
        current=copy.deepcopy(self.registry)
        actual=copy.deepcopy(self.actual)
        reports={}
        for name,raw in [('actual',actual),('currentRegistry',current),('historical',copy.deepcopy(self.registry))]:
            reports[name]=dict(dependencyCount=raw['lockfile']['dependency-count'],raw=raw,returncode=1 if raw['warnings'].get('unsound',[]) else 0,stderr='',dbCommit='d'*40,validatedBytes=True)
        identity=dict(candidateSHA='c'*40,lockSHA256='l'*64,sourceSHA256='s'*64)
        source=dict(schemaVersion=1,verified=True,linuxModesVerified=True,patchedTreeSHA256=m.source.PATCHED_SHA)
        closure=dict(identity,verified=True,target=m.closure.TARGET,patchedTreeSHA256=m.source.PATCHED_SHA)
        regression=dict(identity,verified=True,sourceAndLockUnchanged=True,sourceSHA256='s'*64)
        audit=dict(identity,schemaVersion=1,verified=True,scannerVersion='cargo-audit-audit 0.22.2',dbCommit='d'*40,dbFresh=True,
                   dbFetchedAt=m.datetime.datetime.now(m.datetime.timezone.utc).isoformat(),originalLockSHA256=m.source.LOCK_SHA,originalLockBlob=m.source.LOCK_BLOB,currentRegistryGraphEquivalent=True,
                   reports=reports)
        regression.update(nativeBuild=dict(returncode=0,timeout=False),compiler='release: 1.99.0\n',profile=copy.deepcopy(m.controls.PROFILE),expectedSourceSHA256='s'*64,targetDirectories=['/one','/two','/three'],transitiveIdentities={k:['identical'] for k in ('baseline','patched','application')})
        for group,outcome in [('baseline','reproduced-null-pointer-ub'),('patched','passed'),('application','passed')]:
            regression[group]=[dict(method=method,outcome=outcome,executableSHA256='a'*64) for method in m.controls.METHODS]
        digest=m.source.sha(m.source.canonical(source))
        for item in (closure,regression,audit):item['sourceSHA256']=digest
        regression['expectedSourceSHA256']=digest
        return source,closure,regression,audit

    def blocked(self,values):self.assertEqual(m.evaluate_native(*values)['admission'],'blocked')

    def test_eligible_rule_preserves_upstream_affected_and_warnings(self):
        result=m.evaluate_native(*self.fixture())
        self.assertEqual(result['admission'],'pass');self.assertTrue(result['upstreamVersionAffected'])
        self.assertEqual(result['sourceRemediation'],'verified')
        self.assertEqual(len(result['reports']['historical']['raw']['warnings']['unsound']),1)
        self.assertEqual(result['reports']['actual']['raw']['warnings']['unmaintained'][0]['advisory']['id'],'RUSTSEC-2024-0370')

    def test_observed_tokio_actual_blocks(self):
        v=self.fixture();v[3]['reports']['actual']['raw']['warnings']['unsound']=[copy.deepcopy(self.historical['warnings']['unsound'][1])];v[3]['reports']['actual']['returncode']=1;self.blocked(v)
    def test_missing_current_reference(self):
        v=self.fixture();del v[3]['reports']['currentRegistry'];self.blocked(v)
    def test_mismatched_current_graph(self):
        v=self.fixture();v[3]['currentRegistryGraphEquivalent']=False;self.blocked(v)
    def test_missing_registry_glib(self):
        v=self.fixture();v[3]['reports']['currentRegistry']['raw']['warnings']['unsound']=[];self.blocked(v)
    def test_changed_affected_range(self):
        v=self.fixture();v[3]['reports']['currentRegistry']['raw']['warnings']['unsound'][0]['versions']['patched']=['>=0.18.5'];self.blocked(v)
    def test_changed_category(self):
        v=self.fixture();v[3]['reports']['currentRegistry']['raw']['warnings']['unsound'][0]['advisory']['informational']='notice';self.blocked(v)
    def test_changed_package(self):
        v=self.fixture();v[3]['reports']['currentRegistry']['raw']['warnings']['unsound'][0]['package']['version']='0.18.6';self.blocked(v)
    def test_db_mismatch(self):
        v=self.fixture();v[3]['reports']['actual']['dbCommit']='e'*40;self.blocked(v)
    def test_wrong_original_blob(self):
        v=self.fixture();v[3]['originalLockBlob']='0'*40;self.blocked(v)
    def test_stale_candidate(self):
        v=self.fixture();v[2]['candidateSHA']='0'*40;self.blocked(v)
    def test_stale_lock(self):
        v=self.fixture();v[2]['lockSHA256']='0'*64;self.blocked(v)
    def test_malformed_json(self):
        for raw in (b'{',b'{}',b'{"warnings":{},"warnings":{}}'):
            with self.assertRaises(ValueError):m.parse_raw(raw)
    def test_impossible_count(self):
        v=self.fixture();v[3]['reports']['actual']['raw']['vulnerabilities']['count']=1;self.blocked(v)
    def test_inconsistent_status(self):
        v=self.fixture();v[3]['reports']['actual']['returncode']=1;self.blocked(v)
    def test_infrastructure_failure(self):
        v=self.fixture();v[3]['reports']['actual']['stderr']='error: registry unavailable';self.blocked(v)
    def test_unknown_category(self):
        v=self.fixture();v[3]['reports']['actual']['raw']['warnings']['unknown']=[];self.blocked(v)
    def test_additional_vulnerability(self):
        v=self.fixture();r=v[3]['reports']['actual']['raw']['vulnerabilities'];r.update(found=True,count=1,list=[{'advisory':{'id':'RUSTSEC-2099-0001'}}]);self.blocked(v)
    def test_additional_unsound(self):
        v=self.fixture();v[3]['reports']['currentRegistry']['raw']['warnings']['unsound'].append(copy.deepcopy(self.historical['warnings']['unsound'][1]));self.blocked(v)
    def test_changed_tree(self):
        v=self.fixture();v[0]['patchedTreeSHA256']='0'*64;self.blocked(v)
    def test_incomplete_probes(self):
        v=self.fixture();v[2]['verified']=False;self.blocked(v)
    def test_verified_flag_does_not_replace_method_coverage(self):
        v=self.fixture();v[2]['baseline'].pop();self.blocked(v)
    def test_changed_transitive_identity_blocks_even_verified_flag(self):
        v=self.fixture();v[2]['transitiveIdentities']['baseline']=['foreign'];self.blocked(v)
    def test_unvalidated_raw_bytes(self):
        v=self.fixture();v[3]['reports']['actual']['validatedBytes']=False;self.blocked(v)
    def test_unknown_report_shape(self):
        v=self.fixture();v[3]['reports']['actual']['raw']['unknown']=True;self.blocked(v)
    def test_forged_source_binding(self):
        v=self.fixture();v[0]['fileCount']=120;self.blocked(v)
    def test_stale_db_timestamp(self):
        v=self.fixture();v[3]['dbFetchedAt']='2020-01-01T00:00:00+00:00';self.blocked(v)
    def test_lock_dependency_count_mismatch(self):
        v=self.fixture();v[3]['reports']['actual']['raw']['lockfile']['dependency-count']=430;self.blocked(v)
    def test_unknown_advisory_field(self):
        v=self.fixture();v[3]['reports']['currentRegistry']['raw']['warnings']['unsound'][0]['advisory']['unknown']=True;self.blocked(v)
    def test_stale_db(self):
        v=self.fixture();v[3]['dbFresh']=False;self.blocked(v)

if __name__=='__main__':unittest.main()
