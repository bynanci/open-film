# SPDX-License-Identifier: Apache-2.0
import copy
import importlib.util
import json
import os
import shutil
import subprocess
import zipfile
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

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

    def test_registry_control_reuses_baseline_lock_without_updating_other_packages(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);control=root/'src-tauri';control.mkdir();output=root/'evidence';output.mkdir()
            commands=[]
            def must(command,name,cwd):
                commands.append((command,name,cwd))
                return json.dumps(self.registry).encode()
            current,current_lock=m.capture_current_registry_control(
                control,output,'[package]\nname="openfilm-desktop"\n',self.registry_lock,must)
            self.assertEqual(len(commands),1)
            self.assertIn('metadata',commands[0][0])
            self.assertNotIn('update',commands[0][0])
            self.assertEqual(current_lock,self.registry_lock)
            self.assertEqual((output/'current-registry-Cargo.lock').read_bytes(),self.registry_lock)
            self.assertTrue(m.compare_graphs(self.actual,current,self.actual_lock,current_lock))

class AdvisoryBundleTests(unittest.TestCase):
    def test_shallow_bundle_survives_visible_only_archive_and_detects_tampering(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);origin=root/'origin';origin.mkdir()
            def git(cwd,*args):
                return subprocess.check_output(['git','-c','user.name=Fixture','-c','user.email=fixture@example.invalid',*args],cwd=cwd,stderr=subprocess.PIPE,text=True).strip()
            git(origin,'init','-q')
            for value in ('first','second'):
                (origin/'advisory').write_text(value)
                git(origin,'add','.');git(origin,'commit','-qm',value)
            expected=git(origin,'rev-parse','HEAD')
            evidence=root/'evidence';evidence.mkdir();db=evidence/'advisory-db'
            git(root,'clone','--depth','1',origin.as_uri(),str(db))
            self.assertEqual(git(db,'rev-parse','--is-shallow-repository'),'true')
            bundle=evidence/'advisory-db.bundle'
            original_boundary=(db/'.git/shallow').read_bytes()
            snapshot=m.retain_advisory_bundle(db,bundle,expected)
            self.assertTrue((evidence/'advisory-db.shallow').is_file())
            self.assertEqual((evidence/'advisory-db.shallow').read_bytes(),original_boundary)
            archive=root/'artifact.zip'
            with zipfile.ZipFile(archive,'w') as output:
                for path in evidence.rglob('*'):
                    if path.is_file() and not any(part.startswith('.') for part in path.relative_to(evidence).parts):
                        output.write(path,path.relative_to(evidence))
            shutil.rmtree(evidence);shutil.rmtree(origin)
            downloaded=root/'downloaded'
            with zipfile.ZipFile(archive) as artifact:artifact.extractall(downloaded)
            self.assertFalse((downloaded/'advisory-db/.git').exists())
            restored=root/'restored.git'
            audit=dict(schemaVersion=2,dbCommit=expected,dbSnapshot=snapshot)
            m.restore_advisory_snapshot(downloaded,restored,audit)
            self.assertEqual((restored/'shallow').read_bytes(),original_boundary)
            self.assertEqual(git(restored,'rev-parse','--is-shallow-repository'),'true')
            git(restored,'fsck','--full','--no-reflogs')
            m.verify_advisory_database(restored,downloaded,audit)
            retained=downloaded/'advisory-db.bundle'
            m.verify_advisory_bundle(retained,expected,snapshot=snapshot)
            with self.assertRaisesRegex(ValueError,'boundary'):
                m.verify_advisory_bundle(retained,'0'*40,snapshot=snapshot)
            retained.write_bytes(b'corrupt bundle')
            with self.assertRaisesRegex(ValueError,'snapshot bytes'):m.verify_advisory_bundle(retained,expected,snapshot=snapshot)



class SnapshotTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name);self.evidence=self.root/'evidence';self.evidence.mkdir()
        origin=self.root/'origin';origin.mkdir();self.git(origin,'init','-q')
        for value in ('first','second'):
            (origin/'advisory').write_text(value);self.git(origin,'add','.');self.git(origin,'commit','-qm',value)
        self.db=self.root/'db';self.git(self.root,'clone','--depth','1',origin.as_uri(),str(self.db))
        self.head=self.git(self.db,'rev-parse','HEAD').decode().strip()
        self.boundary=(self.db/'.git/shallow').read_bytes()
        self.snapshot=m.retain_advisory_bundle(self.db,self.evidence/'advisory-db.bundle',self.head)
        self.audit=dict(schemaVersion=2,dbCommit=self.head,dbSnapshot=self.snapshot)

    def git(self,cwd,*args,input=None):
        return subprocess.run(['git','-c','user.name=Fixture','-c','user.email=fixture@example.invalid',*args],cwd=cwd,input=input,check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE).stdout

    def test_v2_metadata_rejects_unknown_types_fields_formats_and_versions(self):
        for field,values in [('schemaVersion',[1,3,True,2.0,'2',None]),('dbCommit',['A'*40,'f'*39,42])]:
            for value in values:
                audit=copy.deepcopy(self.audit);audit[field]=value
                with self.subTest(field=field,value=value),self.assertRaises(ValueError):m.validate_advisory_snapshot_metadata(audit)
        changes=[('format','other'),('tree','a'*39),('tree',True),('unknown',1)]
        for key,value in changes:
            audit=copy.deepcopy(self.audit);audit['dbSnapshot'][key]=value
            with self.subTest(key=key,value=value),self.assertRaises(ValueError):m.validate_advisory_snapshot_metadata(audit)
        for kind in ('bundle','shallow'):
            for key,values in [('size',[True,41.0,'41',0,8*1024**2+1]),('path',['../escape','other',None]),('sha256',['A'*64,'a'*63,1]),('unknown',[True])]:
                for value in values:
                    audit=copy.deepcopy(self.audit);audit['dbSnapshot'][kind][key]=value
                    with self.subTest(kind=kind,key=key,value=value),self.assertRaises(ValueError):m.validate_advisory_snapshot_metadata(audit)
            for key in ('path','size','sha256'):
                audit=copy.deepcopy(self.audit);del audit['dbSnapshot'][kind][key]
                with self.assertRaises(ValueError):m.validate_advisory_snapshot_metadata(audit)
        for value in (None,[],{},True):
            audit=copy.deepcopy(self.audit);audit['dbSnapshot']=value
            with self.assertRaises(ValueError):m.validate_advisory_snapshot_metadata(audit)

    def test_captured_boundary_and_worktree_drift_block_retention(self):
        captured=m.read_advisory_state(self.db,self.head,require_worktree=True)
        for boundary in (b'',b'0'*40+b'\n',self.boundary.rstrip(),self.boundary.replace(b'\n',b'\r\n'),self.boundary*2):
            (self.db/'.git/shallow').write_bytes(boundary)
            with self.subTest(boundary=boundary),self.assertRaises((ValueError,subprocess.CalledProcessError)):
                m.retain_advisory_bundle(self.db,self.root/'advisory-db.bundle',self.head,captured=captured)
            self.assertFalse((self.root/'advisory-db.bundle').exists())
        (self.db/'.git/shallow').write_bytes(self.boundary)
        for name in ('advisory','untracked'):
            p=self.db/name;old=p.read_bytes() if p.exists() else None;p.write_text('changed')
            with self.assertRaises(ValueError):m.retain_advisory_bundle(self.db,self.root/'advisory-db.bundle',self.head,captured=captured)
            if old is None:p.unlink()
            else:p.write_bytes(old)
        with self.assertRaises(ValueError):m.retain_advisory_bundle(self.root/'origin',self.root/'advisory-db.bundle',self.head)
        with self.assertRaises(ValueError):m.retain_advisory_bundle(self.db,self.root/'advisory-db.bundle',self.head,captured=('0'*40,self.boundary))
        linked=self.root/'linked';linked.mkdir();(linked/'.git').write_text('gitdir: '+str(self.db/'.git')+'\n')
        with self.assertRaises(ValueError):m.read_advisory_state(linked,self.head)

    def test_bundle_destination_is_exclusive_even_if_created_during_git(self):
        destination=self.root/'advisory-db.bundle';real=m.advisory_git
        def race(directory,*args,**kwargs):
            if args[:2]==('bundle','create'):destination.write_bytes(b'owned sentinel')
            return real(directory,*args,**kwargs)
        with patch.object(m,'advisory_git',side_effect=race),self.assertRaises(FileExistsError):
            m.retain_advisory_bundle(self.db,destination,self.head)
        self.assertEqual(destination.read_bytes(),b'owned sentinel')
        self.assertFalse((self.root/'advisory-db.shallow').exists())

    def test_restored_boundary_requires_original_bytes_and_private_destination(self):
        sidecar=self.evidence/'advisory-db.shallow';bundle=self.evidence/'advisory-db.bundle'
        for boundary in (b'',b'0'*40+b'\n',self.boundary.rstrip(),self.boundary.replace(b'\n',b'\r\n'),self.boundary*2):
            sidecar.write_bytes(boundary);audit=copy.deepcopy(self.audit)
            audit['dbSnapshot']['shallow'].update(size=len(boundary),sha256=m.source.sha(boundary))
            with self.subTest(boundary=boundary),self.assertRaises(ValueError):m.restore_advisory_snapshot(self.evidence,self.root/'restore',audit)
            self.assertFalse((self.root/'restore').exists())
        sidecar.write_bytes(self.boundary)
        for path in (sidecar,bundle):
            saved=path.read_bytes();path.write_bytes(saved+b' ')
            with self.assertRaises(ValueError):m.restore_advisory_snapshot(self.evidence,self.root/'restore',self.audit)
            path.unlink();path.symlink_to(self.root/'sentinel');(self.root/'sentinel').write_bytes(saved)
            with self.assertRaises(ValueError):m.restore_advisory_snapshot(self.evidence,self.root/'restore',self.audit)
            self.assertEqual((self.root/'sentinel').read_bytes(),saved);path.unlink();path.write_bytes(saved)
        sidecar.unlink()
        with self.assertRaises((ValueError,OSError)):m.restore_advisory_snapshot(self.evidence,self.root/'restore',self.audit)
        sidecar.write_bytes(self.boundary)
        occupied=self.root/'occupied';occupied.mkdir();(occupied/'keep').write_text('owned')
        link=self.root/'link';link.symlink_to(occupied,target_is_directory=True)
        for destination in (occupied,link,link/'nested'):
            with self.assertRaises(ValueError):m.restore_advisory_snapshot(self.evidence,destination,self.audit)
        self.assertEqual((occupied/'keep').read_text(),'owned')
        self.assertEqual((self.db/'.git/shallow').read_bytes(),self.boundary)

    def loose_database(self):
        db=self.root/'loose.git';db.mkdir();self.git(db,'init','--bare','-q')
        def oid(*args,input=None):return self.git(db,*args,input=input).decode().strip()
        blob=oid('hash-object','-w','--stdin',input=b'advisory')
        nested=oid('mktree',input=f'100644 blob {blob}\tadvisory\n'.encode())
        tree=oid('mktree',input=f'040000 tree {nested}\tcrates\n'.encode())
        parent=oid('commit-tree',tree,input=b'parent\n')
        head=oid('commit-tree',tree,'-p',parent,input=b'child\n')
        self.git(db,'update-ref','refs/heads/main',head);self.git(db,'symbolic-ref','HEAD','refs/heads/main')
        boundary=(head+'\n').encode();(db/'shallow').write_bytes(boundary)
        (db/'objects'/parent[:2]/parent[2:]).unlink()
        evidence=self.root/'loose-evidence';evidence.mkdir()
        snapshot=m.retain_advisory_bundle(db,evidence/'advisory-db.bundle',head)
        return db,evidence,dict(schemaVersion=2,dbCommit=head,dbSnapshot=snapshot),nested,blob

    def test_shallow_parent_is_allowed_but_missing_current_tree_or_blob_fails(self):
        db,evidence,audit,nested,blob=self.loose_database()
        m.verify_advisory_database(db,evidence,audit)
        for oid in (nested,blob):
            damaged=self.root/oid;shutil.copytree(db,damaged);(damaged/'objects'/oid[:2]/oid[2:]).unlink()
            self.assertEqual(m.read_advisory_state(damaged,audit['dbCommit']),(audit['dbSnapshot']['tree'],(db/'shallow').read_bytes()))
            with self.subTest(oid=oid),patch.object(m,'advisory_git',wraps=m.advisory_git) as calls,self.assertRaises(subprocess.CalledProcessError):
                m.verify_advisory_database(damaged,evidence,audit)
            self.assertTrue(any(call.args[1:]==('fsck','--full','--no-reflogs') for call in calls.call_args_list))

    def test_git_overrides_and_alternates_cannot_mask_missing_objects(self):
        db,evidence,audit,nested,blob=self.loose_database()
        damaged=self.root/'damaged';shutil.copytree(db,damaged);(damaged/'objects'/blob[:2]/blob[2:]).unlink()
        sentinel=self.root/'executed';hooks=self.root/'hooks';hooks.mkdir()
        hook=hooks/'post-checkout';hook.write_text('#!/bin/sh\ntouch '+str(sentinel)+'\n');hook.chmod(0o755)
        config=self.root/'global';config.write_text('[core]\n hooksPath = '+str(hooks)+'\n[init]\n templateDir = '+str(hooks)+'\n')
        external=self.root/'external-shallow';external.write_bytes(b'0'*40+b'\n')
        env={'GIT_SHALLOW_FILE':str(external),'GIT_OBJECT_DIRECTORY':str(db/'objects'),'GIT_ALTERNATE_OBJECT_DIRECTORIES':str(db/'objects'),
             'GIT_CONFIG_GLOBAL':str(config),'GIT_CONFIG_COUNT':'1','GIT_CONFIG_KEY_0':'core.hooksPath','GIT_CONFIG_VALUE_0':str(hooks),
             'GIT_DIR':str(db),'GIT_WORK_TREE':str(self.db),'GH_TOKEN':'sentinel','GITHUB_TOKEN':'sentinel'}
        with patch.dict(os.environ,env):
            m.verify_advisory_database(db,evidence,audit)
            private=self.root/'restored';m.restore_advisory_snapshot(evidence,private,audit);m.verify_advisory_database(private,evidence,audit)
            with self.assertRaises(subprocess.CalledProcessError):m.verify_advisory_database(damaged,evidence,audit)
            clean=m.advisory_git_environment();self.assertNotIn('GH_TOKEN',clean);self.assertNotIn('GITHUB_TOKEN',clean)
        self.assertFalse(sentinel.exists());self.assertEqual(external.read_bytes(),b'0'*40+b'\n')
        replacement=self.git(damaged,'hash-object','-w','--stdin',input=b'replacement').decode().strip()
        self.git(damaged,'replace','--force',blob,replacement)
        with self.assertRaises(subprocess.CalledProcessError):m.verify_advisory_database(damaged,evidence,audit)
        for relative in ('objects/info/alternates','objects/info/http-alternates','info/grafts'):
            p=damaged/relative;p.parent.mkdir(exist_ok=True);p.write_text(str(db/'objects'))
            with self.subTest(path=relative),self.assertRaises(ValueError):m.verify_advisory_database(damaged,evidence,audit)
            p.unlink()
        for key,value in [('include.path',str(config)),('remote.origin.promisor','true'),('extensions.partialclone','origin'),('fsck.missingTree','ignore')]:
            self.git(damaged,'config',key,value)
            with self.subTest(key=key),self.assertRaises(ValueError):m.verify_advisory_database(damaged,evidence,audit)
            self.git(damaged,'config','--unset',key)

if __name__=='__main__':unittest.main()
