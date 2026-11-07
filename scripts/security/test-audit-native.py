# SPDX-License-Identifier: Apache-2.0
import copy
import importlib.util
from pathlib import Path
import unittest

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('audit',HERE/'audit-native.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)


class CurrentRegistryTests(unittest.TestCase):
    def setUp(self):
        self.actual={'packages':[dict(id='root',name='openfilm-desktop',version='1.0.0',source=None),dict(id='path',name='glib',version='0.18.5',source=None),dict(id='tokio',name='tokio',version='1.53.3',source=m.REGISTRY)],'resolve':{'root':'root','nodes':[dict(id='root',features=[],deps=[dict(pkg='path',name='glib',dep_kinds=[dict(kind='dev',target='cfg(target_os = "linux")')]),dict(pkg='tokio',name='tokio',dep_kinds=[])]),dict(id='path',features=['default'],deps=[]),dict(id='tokio',features=['rt'],deps=[])]}}
        self.registry=copy.deepcopy(self.actual);self.registry['packages'][1].update(id='registry',source=m.REGISTRY)
        self.registry['resolve']['nodes'][0]['deps'][0]['pkg']='registry';self.registry['resolve']['nodes'][1]['id']='registry'
        self.actual_lock=b'version=4\n[[package]]\nname="glib"\nversion="0.18.5"\n'
        self.registry_lock=self.actual_lock+('source="'+m.REGISTRY+'"\nchecksum="'+m.source.ARCHIVE_SHA+'"\n').encode()

    def refuse(self):
        with self.assertRaises(ValueError):m.compare_graphs(self.actual,self.registry,self.actual_lock,self.registry_lock)
    def test_exact_current_registry_control(self):
        self.assertTrue(m.compare_graphs(self.actual,self.registry,self.actual_lock,self.registry_lock))
    def test_current_registry_tokio_drift(self):
        self.registry['packages'][2]['version']='1.53.2';self.refuse()
    def test_current_registry_feature_drift(self):
        self.registry['resolve']['nodes'][2]['features']=[];self.refuse()
    def test_current_registry_dependency_edge_drift(self):
        self.registry['resolve']['nodes'][0]['deps'].pop();self.refuse()
    def test_current_registry_source_drift(self):
        self.registry['packages'][2]['source']='git+https://foreign.invalid';self.refuse()
    def test_current_registry_lock_drift(self):
        self.registry_lock+=b'[[package]]\nname="extra"\nversion="1.0.0"\n';self.refuse()
    def test_current_registry_not_registry_glib(self):
        self.registry['packages'][1]['source']=None;self.refuse()
    def test_current_registry_wrong_glib_checksum(self):
        self.registry_lock=self.registry_lock.replace(m.source.ARCHIVE_SHA.encode(),b'0'*64);self.refuse()

if __name__=='__main__':unittest.main()
