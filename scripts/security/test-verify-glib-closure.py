# SPDX-License-Identifier: Apache-2.0
import copy
import importlib.util
import json
from pathlib import Path
import shutil
import tempfile
import unittest

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('closure', HERE/'verify-glib-closure.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
ROOT=HERE.parent.parent


class ClosureTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        for name in ('vendor/glib-0.18.5','third-party/glib-0.18.5'):
            shutil.copytree(ROOT/name,self.root/name)
        self.app=self.root/'apps/desktop/src-tauri';self.app.mkdir(parents=True)
        shutil.copyfile(ROOT/'apps/desktop/src-tauri/Cargo.toml',self.app/'Cargo.toml')
        self.lock=(ROOT/'apps/desktop/src-tauri/Cargo.lock').read_bytes()
        (self.app/'Cargo.lock').write_bytes(self.lock)
        self.source=m.source.verify_source(self.root)
        self.metadata={'version':1,'workspace_root':str(self.app),'workspace_members':['root'],'resolve':{'root':'root','nodes':[]},'packages':[]}
        packages=[('root','openfilm-desktop','0.5.0',None,str(self.app/'Cargo.toml')),('glib','glib','0.18.5',None,str(self.root/'vendor/glib-0.18.5/Cargo.toml'))]
        packages += [(n,n,v,'registry+https://github.com/rust-lang/crates.io-index',str(self.root/'cache'/n/'Cargo.toml')) for n,v in m.FAMILY.items() if n!='glib']
        for identity,name,version,origin,path in packages:
            self.metadata['packages'].append(dict(id=identity,name=name,version=version,source=origin,manifest_path=path))
            deps=[dict(name=n.replace('-','_'),pkg=n,dep_kinds=[dict(kind=None,target=None)]) for n in m.FAMILY if n!=name] if name=='openfilm-desktop' else []
            self.metadata['resolve']['nodes'].append(dict(id=identity,features=[],deps=deps,dependencies=[d['pkg'] for d in deps]))

    def verify(self):
        return m.verify_closure(self.metadata,self.lock,self.root,self.source)

    def refuse(self):
        with self.assertRaises((ValueError,KeyError)):
            self.verify()

    def test_expected_closure(self):
        evidence=self.verify()
        self.assertTrue(evidence['verified']);self.assertEqual(evidence['glib']['version'],'0.18.5')

    def test_two_glib_versions(self):
        p=copy.deepcopy(self.metadata['packages'][1]);p.update(id='second',version='0.20.0');self.metadata['packages'].append(p);self.refuse()

    def test_duplicate_same_version_sources(self):
        p=copy.deepcopy(self.metadata['packages'][1]);p.update(id='second',source='registry+https://github.com/rust-lang/crates.io-index');self.metadata['packages'].append(p);self.refuse()

    def test_registry_source(self):
        self.metadata['packages'][1]['source']='registry+https://github.com/rust-lang/crates.io-index';self.refuse()

    def test_path_escape(self):
        self.metadata['packages'][1]['manifest_path']=str(self.root/'other/Cargo.toml');self.refuse()

    def test_path_link(self):
        (self.root/'link').symlink_to(self.root/'vendor/glib-0.18.5',target_is_directory=True)
        self.metadata['packages'][1]['manifest_path']=str(self.root/'link/Cargo.toml');self.refuse()

    def test_wrong_root(self):
        self.metadata['resolve']['root']='glib';self.refuse()

    def test_wrong_target(self):
        self.metadata['target']='aarch64-apple-darwin';self.refuse()

    def test_missing_resolve_node(self):
        self.metadata['resolve']['nodes'].pop();self.refuse()

    def test_foreign_family(self):
        self.metadata['packages'][2]['version']='0.99.0';self.refuse()

    def test_stale_lock(self):
        self.lock += b'\n';self.refuse()

    def test_altered_source(self):
        (self.root/'vendor/glib-0.18.5/LICENSE').write_text('altered');self.refuse()

    def test_external_cargo_config(self):
        (self.root/'.cargo').mkdir();(self.root/'.cargo/config.toml').write_text('[source.crates-io]\nreplace-with="foreign"\n');self.refuse()

    def test_injected_flags(self):
        import os
        from unittest.mock import patch
        with patch.dict(os.environ,{'RUSTFLAGS':'-C opt-level=0'}):
            self.refuse()


if __name__=='__main__':unittest.main()
