# SPDX-License-Identifier: Apache-2.0
import copy
import importlib.util
from pathlib import Path
import signal
import sys
import tempfile
import unittest

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('controls',HERE/'run-glib-controls.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)


class SupervisorTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)

    def probe(self,mode):
        p=self.root/'probe'
        p.write_text('#!/usr/bin/env python3\nimport os,sys,time,signal\n'+mode+'\n')
        p.chmod(0o755);return p

    def test_first_abort_does_not_skip_others(self):
        p=self.probe('os.kill(os.getpid(), signal.SIGABRT) if "glib_next" in sys.argv else print("test result: ok. 1 passed; 0 failed;")')
        records=m.run_methods(p,self.root/'logs',timeout=1)
        self.assertEqual(len(records),5)
        self.assertEqual(records[0]['signal'],signal.SIGABRT)
        self.assertEqual([r['returncode'] for r in records[1:]],[0]*4)

    def test_missing_executable(self):
        records=m.run_methods(self.root/'absent',self.root/'logs')
        self.assertEqual(len(records),5)
        self.assertTrue(all(r['outcome']=='infrastructure-failure' for r in records))

    def test_compile_failure_is_not_reproduction(self):
        self.assertEqual(m.classify(dict(returncode=101,timeout=False,stdout=b'',stderr=b'compiler error'),baseline=True),'blocked-failure')

    def test_timeout_is_not_reproduction(self):
        p=self.probe('time.sleep(5)')
        results=m.run_methods(p,self.root/'logs',timeout=.02)
        self.assertTrue(all(r['outcome']=='timeout' for r in results))

    def test_unattributed_crash_is_not_reproduction(self):
        self.assertEqual(m.classify(dict(returncode=-signal.SIGSEGV,timeout=False,stdout=b'',stderr=b''),baseline=True),'crash-unattributed')

    def valid(self):
        passing=[dict(method=n,outcome='passed',executableSHA256='a'*64) for n in m.METHODS]
        return dict(nativeBuild=dict(returncode=0,timeout=False),compiler='rustc 1.99.0 (test)\nrelease: 1.99.0\nhost: x86_64-unknown-linux-gnu\n',profile=copy.deepcopy(m.PROFILE),
                    sourceSHA256='s',expectedSourceSHA256='s',targetDirectories=['/a','/b','/c'],
                    transitiveIdentities={'baseline':['x'],'patched':['x'],'application':['x']},
                    baseline=[dict(method=n,outcome='reproduced-null-pointer-ub',executableSHA256='b'*64) for n in m.METHODS],patched=copy.deepcopy(passing),application=copy.deepcopy(passing))

    def refuse(self,record):
        self.assertFalse(m.controls_verified(record))

    def test_valid_controls(self):self.assertTrue(m.controls_verified(self.valid()))
    def test_wrong_source(self):
        r=self.valid();r['sourceSHA256']='other';self.refuse(r)
    def test_shared_target_directory(self):
        r=self.valid();r['targetDirectories'][1]='/a';self.refuse(r)
    def test_transitive_feature_mismatch(self):
        r=self.valid();r['transitiveIdentities']['patched']=['other'];self.refuse(r)
    def test_wrong_rust_version(self):
        r=self.valid();r['compiler']='rustc 1.98.0';self.refuse(r)
    def test_debug_profile_rejected(self):
        r=self.valid();r['profile']['opt-level']=0;self.refuse(r)
    def test_manifest_or_config_change_blocks_snapshot(self):
        before=dict(source='a',lock='b',manifest='c',config='d')
        for key in before:
            after=dict(before);after[key]='changed'
            with self.assertRaises(ValueError):m.compare_snapshots(before,after)

    def test_full_native_build_required(self):
        r=self.valid();r['nativeBuild']['returncode']=101;self.refuse(r)
    def test_missing_method(self):
        r=self.valid();r['baseline'].pop();self.refuse(r)
    def test_not_reproduced_stays_blocked(self):
        r=self.valid();r['baseline'][0]['outcome']='not-reproduced';self.refuse(r)
    def test_patched_failure_blocks(self):
        r=self.valid();r['patched'][0]['outcome']='blocked-failure';self.refuse(r)

if __name__=='__main__':unittest.main()
