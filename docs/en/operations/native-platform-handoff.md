# Native platform operator handoff — issues 142, 143 and 145

Prepared against source `08e38b6a63a0b0fbcfd3a073c8bfa5dcc8c08224` on
2026-11-11. This document is an execution packet, not a platform acceptance
record. No Windows/macOS target, reviewed candidate, signing input or installed
cold-start observation was available in this Linux session. The existing Popo-PC
connection request is still pending; do not create another request or infer access.

## Stop conditions and identities

Use the existing [schema 1.1 record and M7E checklist](../workstation-qa.md#m7e-native-installer-candidate),
[native performance protocol](../native-performance.md), and issue 140 candidate
receipt tooling. Issue 141 supplies reviewed runtime inputs; issue 140 owns the
receipt format. This handoff adds no alternative receipt or benchmark engine.
Never write observations into a runtime manifest or an embedded receipt.

Before execution the release operator must fill every row below with a real
artifact or independently reviewed receipt. `BLOCKED`, blank and placeholder
values cannot be submitted as hashes or accepted as passes. The preparation SHA
above is not a substitute for the frozen build candidate.

| Input                | Required value / owner                                                                                         | Current disposition                                 |
| -------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Source candidate     | Full Git SHA, clean checkout, version and lockfile digests; release owner                                      | BLOCKED: no candidate designated for this packet    |
| Tool identity        | Build OS/arch, Node/pnpm/Rust, build commands and logs, instrumentation SHA                                    | Record per actual build                             |
| Reviewed runtime     | Target, workflow run/artifact IDs, transport SHA-256, manifest SHA-256, license/SBOM/linkage review; issue 141 | BLOCKED: reviewed target inputs pending             |
| Build identity       | Issue 140 pre-trust candidate identity and native attribution files with SHA-256                               | BLOCKED: tooling/artifact pending                   |
| Final distribution   | Signed installer/app/DMG, final artifact inventory and independent hash pins                                   | BLOCKED: no final bytes                             |
| Trust observations   | Authorized signer identity, certificate chain/timestamp or notary submission/staple and clean OS assessment    | BLOCKED: no authorized signing inputs/target        |
| Lifecycle pair       | Previous verified supported installer + candidate; independent project/source backup                           | BLOCKED: no actual pair                             |
| Target operator      | Named tester, clean supported OS build/arch, local nonadmin QA account, target access                          | BLOCKED: Popo-PC request pending; no macOS endpoint |
| Cold instrumentation | Approved external tracer/version, display/camera capture, clock/ready-event protocol                           | BLOCKED: not observed                               |

Keep pre-trust identity, post-signing final-byte identity, and the final external
receipt distinct. Preserve the original compiler/build-shell evidence and
recompute native attribution against the original pre-trust shell; do not
overwrite that attribution with the signed shell. Signing/stapling changes
bytes: regenerate the final artifact inventory, then bind post-signing bytes
through `finalLinkage` and actual OS trust/lifecycle observations. After the
authorized signer produces final bytes, issue 140's command is:

```sh
pnpm exec tsx scripts/native/receipt.ts seal /absolute/candidate-root /absolute/candidate-root/candidate.json /absolute/new-final-bytes.json
```

Run only once those tools are integrated and the independently reviewed artifact
root is real; this session has not run it. `candidate.json` remains an incomplete
`native-candidate-identity`, while `new-final-bytes.json` pins
`candidateIdentitySha256` and the final `artifactsSha256`. Each executed trust,
lifecycle and security observation must reference the same `candidateSha`,
`candidateIdentitySha256`, `finalArtifactsSha256` and target tuple. Issue 140 owns
the complete schema and finalization CLI; do not improvise observations or mark
them `passed` before execution. After attaching independently hash-pinned executed
observations and review inputs, its finalization command is:

```sh
pnpm exec tsx scripts/native/receipt.ts finalize /absolute/candidate-root /absolute/finalization-inputs.json /absolute/new-candidate-receipt.json
```

Use the exact contract in `docs/validation-native-candidate-receipt.md` supplied
by issue 140 after integration: `finalization-inputs.json` pins candidate,
finalBytes, attribution, finalLinkagePolicy, finalLinkage, security, trust,
lifecycle and review. Its security input must retain actual existing-workflow
`admission.json` for that exact candidate within the contract's six-hour freshness
window. No finalization is possible here without real target observations. Even
a complete final receipt retains `distributionApproved: false`; release-owner
approval stays separate. The final issue 140 receipt must bind
the same source/runtime/target, final artifact inventory, native attribution,
schema 1.1 observations and raw evidence pins. A pre-trust record does not
approve distribution. Do not hash a final shell inside a manifest it embeds.

## Build-host kit (before transfer)

Run from the reviewed candidate checkout; substitute only real, reviewed paths.
`OPENFILM_KIT` must be a new external directory. The standalone tool uses the
existing record implementation and needs no developer toolchain on the target.

```sh
: "${OPENFILM_CANDIDATE:?full reviewed candidate SHA required}"
: "${OPENFILM_KIT:?new absolute external kit directory required}"
test "$(git rev-parse HEAD)" = "$OPENFILM_CANDIDATE"
test -z "$(git status --porcelain)"
mkdir "$OPENFILM_KIT"
git show -s --format=fuller HEAD > "$OPENFILM_KIT/source.txt"
git rev-parse HEAD: > "$OPENFILM_KIT/source-tree.txt"
git diff --exit-code
pnpm exec esbuild scripts/workstation-qa.ts --bundle --platform=node --format=esm --outfile="$OPENFILM_KIT/workstation-qa.mjs"
git hash-object scripts/workstation-qa.ts > "$OPENFILM_KIT/record-tool-git-blob.txt"
```

On a Linux build host, retain `sha256sum pnpm-lock.yaml
apps/desktop/src-tauri/Cargo.lock scripts/workstation-qa.ts
"$OPENFILM_KIT/workstation-qa.mjs"` in `kit-sha256.txt`; macOS uses
`shasum -a 256` on the same paths. On Windows use `Get-FileHash -Algorithm SHA256`
and save `Path,Hash` as JSON. Include the reviewed runtime manifest, original
transport/archive receipt, issue 140 identities and native attribution, media
fixture hashes and this protocol in the transferred kit. Verify transfer hashes
before use. Never include private signing keys, credential exports or personal
media. Retain the exact command exit statuses; a failed build/transfer stays failed.

## Windows: final-byte trust and install

Use PowerShell on the real Windows target. Set these variables to actual paths
outside the installation; do not create a fake `candidate.json`. Start a new
evidence directory per attempt. The NSIS package is current-user and does not
install WebView2: record the supported WebView2 prerequisite independently.

```powershell
$ErrorActionPreference = 'Stop'
$Candidate = Read-Host 'Reviewed full 40-character source SHA'
if ($Candidate -notmatch '^[0-9a-fA-F]{40}$') { throw 'Invalid candidate SHA' }
$Installer = (Resolve-Path (Read-Host 'Final signed NSIS installer path')).Path
$Evidence = Read-Host 'New absolute evidence directory'
New-Item -ItemType Directory -Path $Evidence -ErrorAction Stop | Out-Null
Start-Transcript -Path (Join-Path $Evidence 'operator.txt') -NoClobber
(Get-Date).ToUniversalTime().ToString('o')
Get-CimInstance Win32_OperatingSystem | Select-Object Caption,Version,BuildNumber,OSArchitecture | ConvertTo-Json | Set-Content (Join-Path $Evidence 'os.json')
whoami /user
Get-Command node,ffmpeg,ffprobe,perl -ErrorAction SilentlyContinue | Select-Object Name,Source
Get-FileHash -LiteralPath $Installer -Algorithm SHA256 | ConvertTo-Json | Set-Content (Join-Path $Evidence 'installer-sha256.json')
Get-AuthenticodeSignature -LiteralPath $Installer | Format-List * | Out-File (Join-Path $Evidence 'authenticode.txt')
Start-Process -FilePath $Installer -Wait -PassThru | Select-Object Id,ExitCode | ConvertTo-Json | Set-Content (Join-Path $Evidence 'installer-exit.json')
```

Expected receipts: exact final installer digest equals the independently pinned
issue 140 inventory; Authenticode reports `Valid` with the expected authorized
publisher, chain and timestamp; normal OS trust UI and NSIS current-user install
succeed. Save actual SmartScreen/publisher dialogs or failures separately; a
signature API result alone does not establish SmartScreen reputation. If
`signtool` exists in the approved signer kit, additionally retain
`signtool verify /pa /all /v <final-installer>` output and its exit code. An absent
tool is unavailable, never a synthetic pass. Do not disable SmartScreen or add
certificates. Stop on a failed trust assessment; preserve the attempt.

After normal installation, set `$RuntimeNode` to the installed verified
`runtime/bin/node.exe` and `$Kit` to the verified transferred kit. Record their
real paths privately in the evidence, and hash the installed runtime manifest
and shell against the final inventory. Do not add them to PATH.

```powershell
$RuntimeNode = (Resolve-Path (Read-Host 'Installed runtime node.exe path')).Path
$Kit = (Resolve-Path (Read-Host 'Verified QA kit directory')).Path
& $RuntimeNode (Join-Path $Kit 'workstation-qa.mjs') init (Join-Path $Evidence 'workstation-qa.json') --candidate $Candidate
if ($LASTEXITCODE -ne 0) { throw 'Record initialization failed' }
```

Complete the lifecycle matrix below using the actual application UI, then run:

```powershell
& $RuntimeNode (Join-Path $Kit 'workstation-qa.mjs') validate (Join-Path $Evidence 'workstation-qa.json')
if ($LASTEXITCODE -ne 0) { throw 'Record consistency failed' }
Stop-Transcript
```

## macOS: final-byte trust and install

Use the final signed/notarized/stapled artifacts. An ARM64 result covers ARM64
only; Universal/x64 requires its own reviewed inputs and actual target evidence.
Do not run signing or submit a new notarization job from this handoff.

```sh
: "${OPENFILM_DMG:?absolute final DMG path required}"
: "${OPENFILM_APP:?absolute final app path required}"
: "${OPENFILM_EVIDENCE:?new external evidence directory required}"
mkdir "$OPENFILM_EVIDENCE"
date -u +%FT%TZ > "$OPENFILM_EVIDENCE/time.txt"
sw_vers > "$OPENFILM_EVIDENCE/os.txt"
uname -m > "$OPENFILM_EVIDENCE/arch.txt"
id > "$OPENFILM_EVIDENCE/account.txt"
shasum -a 256 "$OPENFILM_DMG" > "$OPENFILM_EVIDENCE/dmg-sha256.txt"
codesign --display --verbose=4 "$OPENFILM_APP" > "$OPENFILM_EVIDENCE/codesign-display.txt" 2>&1
codesign --verify --deep --strict --verbose=4 "$OPENFILM_APP" > "$OPENFILM_EVIDENCE/codesign-verify.txt" 2>&1; echo $? > "$OPENFILM_EVIDENCE/codesign-verify.exit"
spctl --assess --type execute --verbose=4 "$OPENFILM_APP" > "$OPENFILM_EVIDENCE/gatekeeper-app.txt" 2>&1; echo $? > "$OPENFILM_EVIDENCE/gatekeeper-app.exit"
spctl --assess --type open --context context:primary-signature --verbose=4 "$OPENFILM_DMG" > "$OPENFILM_EVIDENCE/gatekeeper-dmg.txt" 2>&1; echo $? > "$OPENFILM_EVIDENCE/gatekeeper-dmg.exit"
xcrun stapler validate "$OPENFILM_APP" > "$OPENFILM_EVIDENCE/stapler-app.txt" 2>&1; echo $? > "$OPENFILM_EVIDENCE/stapler-app.exit"
xcrun stapler validate "$OPENFILM_DMG" > "$OPENFILM_EVIDENCE/stapler-dmg.txt" 2>&1; echo $? > "$OPENFILM_EVIDENCE/stapler-dmg.exit"
```

Run stapler on the authorized signing host if the clean account lacks Xcode
tools, retaining that host's identity and tool version. A command missing on
the clean target remains unavailable there. Attach the existing accepted notary
submission JSON/log and submission ID from the signing owner, and its SHA-256;
an online Gatekeeper acceptance alone is not an offline staple receipt. Expected:
authorized TeamIdentifier, successful strict verification, accepted Gatekeeper
assessment, valid applicable staples, final digests equal the pinned inventory.
Any nonzero exit must be reviewed before installation. Never clear quarantine,
disable Gatekeeper/SIP, install trust roots, or use ad-hoc signing to pass.

Mount through Finder and copy through the supported normal installation flow;
retain the volume/app names, UI observations and actual destination permissions.
Launch through Finder/Launchpad as the clean nonadmin user. Record the first
Gatekeeper dialog. An app assessed on the signer host still needs this clean
target observation. Check installed shell/runtime hashes after copying.

```sh
: "${OPENFILM_NODE:?absolute installed verified runtime Node required}"
: "${OPENFILM_KIT:?verified transferred QA kit required}"
: "${OPENFILM_CANDIDATE:?full reviewed source SHA required}"
"$OPENFILM_NODE" "$OPENFILM_KIT/workstation-qa.mjs" init "$OPENFILM_EVIDENCE/workstation-qa.json" --candidate "$OPENFILM_CANDIDATE"
# Complete actual UI observations before validation.
"$OPENFILM_NODE" "$OPENFILM_KIT/workstation-qa.mjs" validate "$OPENFILM_EVIDENCE/workstation-qa.json"
```

## Candidate-bound lifecycle matrix (each OS, each attempt)

For every row retain start/end UTC, expected versus actual, gate status, relevant
process/session identities, raw logs/screenshots and SHA-256 evidence pins. Use
`windows-installer` or `macos-installer`; leave other untested gates `not-run`.
Use `cross-process-recovery` only for the actual observed scope, preserving its
remaining platform blocker. Add `inputs` for installer, installer archive,
candidate identity/receipt and runtime manifest. Schema 1.1 accepts these via
its existing `label`, `kind`, `sha256` fields. No extra schema keys are introduced.

| Operation                       | Required observation / receipt                                                                                                                                                                                                         |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Clean launch and media          | No developer runtime on PATH; normal first launch/service readiness; import → edit → render → independent decode → save → close → reopen; original source SHA-256 unchanged; output frame/audio receipts                               |
| Paths and permissions           | Separate CJK, spaces and supported long-path cases; installation resources read-only to normal app writes; project/source identity retained                                                                                            |
| Pending drafts and normal close | Explicit close prompt, preserve/recover draft or user-discard as chosen, owned shell/service exits and project lock release                                                                                                            |
| Owner fencing                   | Existing recovery protocol: live owner remains untouched; dead owner recovered only with supported proof; foreign/unknown/reused-PID identity refuses automatic destructive action; completed suggestions and revision guards retained |
| Concurrent app                  | Start second app with development port occupied; closing either preserves foreign service/project/session; raw ownership and process evidence                                                                                          |
| Diagnostic failures             | Disposable copy only: missing/corrupt/wrong-arch runtime and unwritable app-data; readable accessible diagnostics, no original-media mutation; do not damage installed trusted bytes used by other tests                               |
| Manual update                   | Independent backup and previous verified installer; supported upgrade to candidate, project reopen, version/hash observations                                                                                                          |
| Failed replacement              | Induce only an approved reversible failure on disposable installation; prior runtime stays usable or explicit recoverable failure; logs and original hashes retained                                                                   |
| Rollback                        | Normal supported reinstall of verified previous package; compatible project reopens, newer unsupported schema refuses without destructive downgrade; restore independent backup when required                                          |
| Uninstall/reinstall             | Normal OS uninstall then candidate reinstall; external projects, immutable originals, named snapshots and saved edits remain; before/after independent file hashes                                                                     |

Do not kill arbitrary PIDs or modify genuine owner records. Use the existing
[Windows/macOS recovery checklist](../workstation-qa.md) and
[macOS dead-owner protocol](../validation-macos-dead-owner.md) for controlled
disposable-project cases. Keep failed/blocked attempts, including partial files.
The record validator reports `verification: record-only`; passing it says
nothing about the truth or completeness of these observations.

## Separate installed cold-start experiment

This experiment must include normal single-click shell + service creation on
the signed installed candidate. Do not use `scripts/native-benchmark/run.ts`,
prestart a service, prehash/copy the installed app or fixture, or launch through
Node/Cargo. A reboot alone does not demonstrate cold caches. Declare cold state
(OS reboot/session, prior app activity, OS prefetch behavior, storage and cache
policy); never flush another user's caches or delete their profile.

On Windows an authorized tracing operator can first run `wpr -status` and
`wpr -profiles`, retain their output and tool version, and verify no unrelated
recording is active. With the approved `GeneralProfile` available, run
`wpr -start GeneralProfile -filemode` in the tracing account; the clean nonadmin
user then single-clicks the installed shortcut. Record a synchronized screen
capture of the click, first visible usable Library/Welcome, first service
creation/readiness and any trust prompt. Stop with
`wpr -stop <absolute-new-evidence-path>/installed-cold.etl`. If WPR requires
unavailable elevation or profile support, mark the trace blocked; do not stop
someone else's trace or install tooling/trust changes implicitly.

On macOS retain `xcrun xctrace version` and `xcrun xctrace list templates` on the
authorized tracing host. If `System Trace` is actually listed and permission
has been granted, run this in a second terminal, then single-click the installed
app as the nonadmin tester during the capture:

```sh
xcrun xctrace record --template 'System Trace' --all-processes --time-limit 60s --output "$OPENFILM_EVIDENCE/installed-cold.trace"
```

Keep synchronized screen capture as for Windows. If tracing requires Xcode,
privacy consent or permissions absent from the clean target, stop and record
the precise unavailable input. Do not change security/privacy settings from this
packet. Record the actual trace start/end and click/usable-UI/service events;
an IPC checkpoint or process-spawn time alone does not prove a presented frame.

After capture and normal owned shutdown, collect final installed shell/runtime,
installer, project/source and trace hashes; verify them against the candidate
inventory. Preserve mismatches as failed attempts. Report click→usable visible
UI and click→service-ready separately with raw event offsets, clock basis and
uncertainty. Retain at least three independently declared cold trials per OS
and show all outcomes; summarize medians only within the same declared cache
protocol. Cold evidence is separate from the warm benchmark below.

## Existing warm checkout runner and long-form work

Follow [native-performance.md](../native-performance.md) exactly. On each real
workstation use the same generated immutable fixture root, build tools,
instrumentation, display/WebView/power/cache/storage conditions on baseline and
candidate. The runner validates/hashes/copies fixture bytes and prestarts its
owned local service; it measures declared warm process startup, not installed
cold startup or startup peak memory. Its 320×180 generated assets do not measure
real 4K or hardware quality. Do not run concurrently with media benchmarks.

Prepare the existing fixture once with
`pnpm exec tsx scripts/native-benchmark/create-fixture.ts <new-absolute-fixture>`.
Copy the exact JSON configuration from the existing protocol and use real paths
to the checkout-built executable, built server and fixture manifest. On Windows
the executable ends in `.exe`; on macOS this checkout build is the native binary,
not `open`. Record configuration and hashes separately per revision.

```sh
pnpm exec tsx scripts/native-benchmark/run.ts /absolute/warmup.json
pnpm exec tsx scripts/native-benchmark/run.ts /absolute/retained-1.json
pnpm exec tsx scripts/native-benchmark/run.ts /absolute/retained-2.json
pnpm exec tsx scripts/native-benchmark/run.ts /absolute/retained-3.json
pnpm exec tsx scripts/native-benchmark/run.ts /absolute/soak-1h.json
```

Warm-up is excluded; retained startup runs use 30 seconds and the soak uses
3,600 seconds with five-second samples. Each output directory must be new.
Between each invocation, close the native app normally and wait for terminal
`native-benchmark.finished`, successful CLI exit, owned service shutdown ACK and
actual process exit. `collection-stopped` is provisional. Keep raw failures and
`ownedServiceRemaining` evidence; do not force-kill a live project mutation.

Use the existing one-hour schedule: 0–10 minutes Edit/idle, 10–20 200 selections,
20–40 20 Library→Story→Edit visits, 40–50 scroll/preview/keyboard/undo/save/reopen,
50–60 original selection/idle recovery. In a second terminal use the existing
`run.ts mark <actual-output-directory> idle|editing|revisit|idle-recovery` at phase
boundaries and keep action counts/screenshots. Keep `manifest.json`,
`report.json`, `memory.jsonl`, `native-events.jsonl`, phase and lifecycle files,
runtime project copy and stdout/stderr. Inspect per-process membership and
metric coverage before interpreting totals; missing GPU/CPU/private/PSS metrics
remain unavailable. Compare medians of all three retained startup observations
and steady-state/recovery windows per OS; derive targets only after baseline.

For long-form real media, maintain separate unclosed rows for import, proxy,
edit/seek interaction, render/decode, cancel/retry, external storage removal and
relink, display/input devices, multichannel audio, SDR/HDR and each 4K codec.
Declare source/container/codec/frame-rate/resolution/HDR/audio-channel hashes,
duration, project length, actual storage interface and workload. Retain decoded
output correctness plus actual seek/decode/encode/interaction clocks, CPU/RSS
and GPU only where instrumented. No target, device or fixture means `unavailable`
and an open claim. Catalog10K/100K rows and browser navigation cannot close these
gates. The warm synthetic protocol may run without claiming those measurements.

## Return packet and next disposition

Return immutable final bytes or access-controlled artifact references, per-file
SHA-256 inventory, the issue 140 final external receipt, reviewed runtime/native
attribution, schema 1.1 records, raw trust/lifecycle/trace/benchmark evidence and
a named human review disposition. Bind every reference to source/runtime/target
and final artifact identity. Redact personal paths only in public copies, keeping
the original securely with reviewers. No receipt consistency check, AI review,
DCO trailer or hosted CI result grants release-owner publication permission.
