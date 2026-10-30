"""Controlled parser/closure fixtures are never distribution observations."""
import copy
import importlib.util
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("linkage", Path(__file__).with_name("inspect-linkage.py"))
linkage = importlib.util.module_from_spec(spec)
spec.loader.exec_module(linkage)

ELF = '''ELF Header:
  Class: ELF64
  Machine: Advanced Micro Devices X86-64
 0x0000000000000001 (NEEDED) Shared library: [libcodec.so]
 0x000000000000001d (RUNPATH) Library runpath: [$ORIGIN/lib]
'''
PE = '''FILE HEADER VALUES
             8664 machine (x64)
  Image has the following dependencies:
    codec.dll
    KERNEL32.dll
  Summary
'''
MACH = '''Mach header
      magic cputype cpusubtype caps filetype ncmds sizeofcmds flags
MH_MAGIC_64 ARM64 ALL 0x00 EXECUTE 18 2048 NOUNDEFS DYLDLINK TWOLEVEL PIE
bin/tool:
    @loader_path/lib/libcodec.dylib (compatibility version 1.0.0, current version 1.0.0)
    /usr/lib/libSystem.B.dylib (compatibility version 1.0.0, current version 1351.0.0)
'''

class LinkageTests(unittest.TestCase):
    def fixture(self):
        temporary = tempfile.TemporaryDirectory(); self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        (root / "bin/lib").mkdir(parents=True)
        (root / "bin/tool").write_bytes(b"tool fixture")
        (root / "bin/lib/libcodec.so").write_bytes(b"codec fixture")
        policy = {"schemaVersion":1,"platform":"linux","architecture":"x64", "baseline":{"os":"fixture Linux","build":"fixture","architecture":"x64","abi":"fixture ABI"}, "entrypoints":["bin/tool"], "files":{p:linkage.file_hash(root/p) for p in ["bin/tool","bin/lib/libcodec.so"]}, "systemImports":{"libc.so.6":{"reason":"explicit fixture baseline","symbolVersions":["GLIBC_2.17"]}}}
        observations = {"bin/tool":ELF, "bin/lib/libcodec.so":'''Machine: Advanced Micro Devices X86-64
(NEEDED) Shared library: [libc.so.6]
Version needs section '.gnu.version_r':
  File: libc.so.6 Cnt: 1
  Name: GLIBC_2.17 Flags: none Version: 2
'''}
        return root, policy, observations
    def test_platform_parsers(self):
        self.assertEqual(linkage.parse_linkage("linux", ELF)["imports"],["libcodec.so"])
        self.assertEqual(linkage.parse_linkage("win32", PE)["imports"],["codec.dll","KERNEL32.dll"])
        self.assertEqual(linkage.parse_linkage("darwin", MACH)["architecture"],"arm64")
    def test_recursive_closure_and_fixture_not_distribution_approved(self):
        root,policy,observations=self.fixture()
        result=linkage.inspect_observations(root,policy,observations)
        self.assertTrue(result["verified"])
        self.assertEqual(result["observationMode"],"fixture")
        self.assertFalse(result["distributionApproved"])
        self.assertEqual(len(result["binaries"]),2)
        self.assertEqual(result["binaries"][1]["resolved"][0]["kind"],"system")
    def test_negative_closure(self):
        for fault in ["unresolved","recursive-missing","architecture","developer-path","system","abi","hash","traversal","case-collision","orphan","rpath-escape","malformed"]:
            with self.subTest(fault=fault):
                root,policy,obs=self.fixture()
                if fault=="unresolved": obs["bin/tool"]=ELF.replace("libcodec.so","missing.so")
                if fault=="recursive-missing": obs["bin/lib/libcodec.so"] += "(NEEDED) Shared library: [absent.so]\n"
                if fault=="architecture": obs["bin/lib/libcodec.so"]=obs["bin/lib/libcodec.so"].replace("Advanced Micro Devices X86-64","AArch64")
                if fault=="developer-path": obs["bin/tool"]=ELF.replace("libcodec.so","/home/developer/libcodec.so")
                if fault=="system": policy["systemImports"]={}
                if fault=="abi": policy["systemImports"]["libc.so.6"]["symbolVersions"]=[]
                if fault=="hash": policy["files"]["bin/tool"]="0"*64
                if fault=="traversal": policy["entrypoints"]=["../tool"]
                if fault=="case-collision": policy["files"]["BIN/TOOL"]=policy["files"]["bin/tool"]
                if fault=="orphan": policy["entrypoints"]=[]
                if fault=="rpath-escape": obs["bin/tool"]=ELF.replace("$ORIGIN/lib","$ORIGIN/../../host")
                if fault=="malformed": obs["bin/tool"]="readelf: failure"
                with self.assertRaises((ValueError,FileNotFoundError)): linkage.inspect_observations(root,policy,obs)
    def test_elf_adjacent_library_requires_actual_origin_runpath(self):
        root,policy,obs=self.fixture()
        (root/"bin/lib/libcodec.so").rename(root/"bin/libcodec.so")
        policy["files"]["bin/libcodec.so"]=policy["files"].pop("bin/lib/libcodec.so")
        obs["bin/libcodec.so"]=obs.pop("bin/lib/libcodec.so")
        obs["bin/tool"]=ELF.split(" 0x000000000000001d")[0]
        with self.assertRaises(ValueError): linkage.inspect_observations(root,policy,obs)
    def test_bundled_symbol_version_is_not_satisfied_by_filename(self):
        root,policy,obs=self.fixture()
        obs["bin/tool"] += "Version needs section '.gnu.version_r':\n  File: libcodec.so Cnt: 1\n  Name: CODEC_2.0 Flags: none Version: 2\n"
        with self.assertRaises(ValueError): linkage.inspect_observations(root,policy,obs)
    def test_macho_dylib_identity_is_not_a_recursive_import(self):
        raw=MACH.split("bin/tool:")[0] + "bin/lib/libcodec.dylib:\n    @rpath/libcodec.dylib (compatibility version 1.0.0, current version 1.0.0)\n    /usr/lib/libSystem.B.dylib (compatibility version 1.0.0, current version 1.0.0)\nLoad command 3\n          cmd LC_ID_DYLIB\n      cmdsize 48\n         name @rpath/libcodec.dylib (offset 24)\n"
        self.assertEqual(linkage.parse_linkage("darwin",raw)["imports"],["/usr/lib/libSystem.B.dylib"])
    def test_unmodeled_loader_records_fail_closed(self):
        for platform,raw in [("linux",ELF+"(AUDIT) Audit library: [libobserver.so]\n"),("win32",PE.replace("codec.dll","unexpected.import-format"))]:
            with self.subTest(platform=platform):
                with self.assertRaises(ValueError): linkage.parse_linkage(platform,raw)
    def test_links_rejected(self):
        root,policy,obs=self.fixture()
        (root/"bin/tool").unlink(); (root/"bin/tool").symlink_to("lib/libcodec.so")
        with self.assertRaises(ValueError): linkage.inspect_observations(root,policy,obs)
    def test_pe_adjacent_and_macho_loader_relative(self):
        for platform,arch,raw,library,system in [("win32","x64",PE,"codec.dll","KERNEL32.dll"),("darwin","arm64",MACH,"lib/libcodec.dylib","/usr/lib/libSystem.B.dylib")]:
            with self.subTest(platform=platform):
                root,policy,_=self.fixture(); library_path="bin/"+library
                (root/library_path).write_bytes(b"library")
                policy.update(platform=platform,architecture=arch)
                policy["baseline"]["architecture"]=arch
                policy["files"]={p:linkage.file_hash(root/p) for p in ["bin/tool",library_path]}
                policy["systemImports"]={system:{"reason":"explicit fixture OS baseline","symbolVersions":[]}}
                library_raw="8664 machine (x64)\nImage has the following dependencies:\nSummary\n" if platform=="win32" else MACH.split("bin/tool:")[0]
                result=linkage.inspect_observations(root,policy,{"bin/tool":raw,library_path:library_raw})
                self.assertTrue(result["verified"])

if __name__ == "__main__": unittest.main()
