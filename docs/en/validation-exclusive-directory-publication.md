# Exclusive directory publication validation

This correction is based on `37c8a73baeb8493621958519bee60f1c6dcd6df9`.
It addresses a real POSIX publication boundary: checking that a destination is
absent and then using ordinary directory `rename()` can replace an empty
directory created between those operations. Copying into a newly created public
directory also exposes partial packages and introduces an ownership-adoption
window. Publication now has a native no-replace primitive; the services retain
their separate source/revision/abort and known-inode rollback fences.

## Dependency review before installation

The `koffi@3.3.3` tarball was downloaded and its supplied SHA-512 integrity
verified before dependency addition, without running install scripts. Its
loader, license, native interfaces and synchronous errno/Windows last-error
handling were read. The matching Linux/x64 optional package was independently
downloaded and integrity-verified. Both archives contain regular files with no
traversal or link entries. Koffi's lifecycle script remains explicitly disabled;
normal frozen/offline installation succeeds using the pinned native package.
Unrelated existing dependency versions/peer metadata are retained.

The loader version is fixed to `3.3.3`. Linux/x64's actually loaded
`linux_x64/koffi.node` has SHA-256
`2fcc0e86bc8f4244303e01a0878c2738cb768b84c40f1cd31694fa9c2d16baf1`.
The reviewed upstream notices are:

| File in Koffi                      | SHA-256                                                            |
| ---------------------------------- | ------------------------------------------------------------------ |
| `LICENSE.txt`                      | `22bcbbbacd739b026a8dc484f62a31484ce4c4e31f3408b60b29b4e41d62b290` |
| `vendor/node-addon-api/LICENSE.md` | `89024017b88a9f2b763f79b941a4f2db3b4428edfcacdc0b23866b2da633ad0c` |
| `vendor/node-api-headers/LICENSE`  | `a553508f516031c91f3af1148d44970cb81bbae6c4f091be6835d39cc252238c` |

All three complete MIT notices remain in the staged inventory. The host binary
component also receives the matching reviewed core MIT receipt. The repository
does not vendor third-party FFI implementation code.

## Fixed native contract

`await getExclusiveDirectoryRenamer()` resolves a synchronous
`(source, destination) => void` function. The only bindings are:

| Platform | Fixed operation                                     | Exclusive flag                            |
| -------- | --------------------------------------------------- | ----------------------------------------- |
| Linux    | `renameat2(-100, source, -100, destination, flags)` | `RENAME_NOREPLACE = 1`                    |
| macOS    | `renamex_np(source, destination, flags)`            | `RENAME_EXCL = 4`                         |
| Windows  | `MoveFileExW(source, destination, flags)`           | `0`: no replacement, copy or delayed move |

POSIX paths use UTF-8; Windows uses UTF-16 and fully qualified namespace paths.
All paths must be absolute strings without NUL or lone surrogates. The loader
does not expose libraries, symbols or type declarations to project inputs.
There is no ordinary rename, copy, shell or Python fallback. Missing platforms,
addons/symbols or unsupported-operation errno values fail with `ENOTSUP`;
the original cause/native code remains available. `EEXIST`, `EXDEV` and other
native errors remain distinct. Win32 error numbers are retained separately
from POSIX/libuv errno numbers.

Declarations/constants were checked against Linux `rename(2)` and UAPI headers,
Apple XNU `bsd/sys/stdio.h`, `bsd/man/man2/rename.2` and the `renamex` wrapper,
and Microsoft `MoveFileExW`/`GetLastError`/system error documentation. macOS and
Windows bindings have unit declaration/error controls only; they were not
executed on those operating systems.

## Bounded Linux and packaging proof

The wrapper target passes 23 tests, including real Linux publication with the
private directory inode retained, Unicode/space paths, five existing destination
types with both stage/foreign identities and bytes preserved, a missing-source
error, and four simultaneous real Node processes. Exactly one process publishes;
three receive `EEXIST`, losers keep their complete private stages, and observed
public trees contain both complete fixture files.

Three packaging regressions first failed and then passed: the actual build
script's CLI/server/launcher bundles could not load bundled Koffi, runtime
staging omitted its host addon/license inventory, and staging could overwrite
a foreign empty output directory created after admission. The build keeps
Koffi external at every Node application/test bundler. Staging inventories the
actual loaded host package and verifies the three notice hashes. Its own final
publication uses the same exclusive primitive. The build fixture invokes the
production wrapper from all three generated bundles with an empty environment,
including collision/inode controls. Native runtime fixtures use the verified
staged Node/launcher/service with an empty environment and port0.

A later actual source-mutation probe found that checking a notice before walking
the package did not bind its copied bytes. Both vendor-notice cases reproduced
the issue; the core-notice control already rejected it. The walk now supplies
each reviewed notice hash to the existing source/copy verifier. All three
permanent regressions pass and reject before a public runtime appears, using
private dependency copies without altering pnpm's shared store.

The final bounded target passes **9 files / 104 tests** in **65.60 seconds**,
including all 47 pre-existing native controls. Full TypeScript/Vue, changed-file
ESLint/formatting, production build, built-CLI smoke and diff checks pass.
An additional actual merged built-CLI probe successfully creates/verifies a
Collect directory, preserves its inode on collision and publishes a PCM stem.
Its extra same-request-ID retry exposed the existing normal CLI opener's project
timestamp write. The separate export correction now uses the passive opener;
actual cross-process retry and project/catalog preservation pass independently,
with source/settings mismatch rejection retained. See
[profile export validation](validation-export-profiles.md). The original negative
evidence remains recorded; no request fingerprint was relaxed.

Evidence is retained under `/tmp/openfilm-v1-validation/exclusive-ffi-*` and
`exclusive-ffi-dependency-audit.json`. Final bounded test counts, exact commits,
source hashes and independent combined service evidence are recorded in the
machine-readable final reports; the foundation commit is
`57d5cbd6480eb66946bcaed550ba418d021bb461`.

No full repository suite, default-port service, external push or release was
run for this correction. Linux host-runtime proof does not qualify a signed
installer, arbitrary network filesystems, Windows/macOS native behavior or
workstation manual gates. Those retain their existing partial/not-run status.
