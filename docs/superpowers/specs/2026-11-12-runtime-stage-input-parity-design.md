# Reviewed runtime staging input parity

Issue #141 already requires bounded, source-preserving runtime intake/staging. The registered producer calls the strict existing inspector, but the directly exported/documented stageRuntime API checks primary headers/aliases more loosely before later review handling. Synthetic evidence demonstrates admission to the copying phase, not a completed distribution bundle or release bypass.

## Decision and approach

Use the existing inspectRuntimeInputs boundary for inputs carrying distributionReview, immediately after host/target validation and before renamer loading, destination parent/lock/staging creation or primary copying. This is the engineer's implementation choice under the existing secure-input scope. The user has repeatedly authorized direct implementation and subagent-driven execution; no new release/signing/admin scope is added.

A second validator would duplicate the existing schema and drift again. A blanket script ban in assertBinaryArchitecture would break the intentional test-only FFmpeg fault wrapper. Reusing the inspector only on the reviewed path fixes the demonstrated inconsistency and preserves the existing test-only contract. Do not strengthen generic internal package-file copying in this patch: pnpm package notices may legitimately be immutable hardlinks and are not the supplied primary-runtime input boundary.

## Requirements

- Reviewed primary tools/notices reject wrong OS, script executables, hardlinks, symlink parents, changed hashes and empty notices with existing inspector errors.
- Reject before output parent/staging/lock creation or package loading. Source bytes and input sentinels stay unchanged; no input is executed by inspection.
- Valid host headers and matching pins proceed to the existing next gates; a synthetic fixture is never rights approval, successful native acceptance or distributionApproved=true.
- Keep test-only script support and existing sidecar/native-runtime behavior unchanged.
- No second schema, Timeline, Mixer or product Job engine. No project/media writes, provider, source version, dependency, license/NOTICE, admin or publication change.
- Issue #141 remains open for genuine selected target inputs/build/license/SPDX/rights and OS evidence.

## Validation

Real filesystem tests use synthetic ELF/PE/Mach-O headers, harmless script sentinels, hardlinks and symlink directories; fixture notices explicitly say they are not license approval. Add a direct reviewed-stage regression suite and run existing intake/support/integration cases. Perform required formatting/i18n/lint/typecheck/full-test/build/CI before merging. Native local prerequisites may be absent and must be reported; hosted native/full media remain mandatory.
