# Workstation QA evidence contract

OpenFilm keeps hardware/application verification separate from deterministic CI.
A generated fixture, parser pass or mocked provider is never evidence that a real
application, model, GPU, camera file or installer works.

Create a candidate-bound evidence record on the workstation:

```sh
pnpm exec tsx scripts/workstation-qa.ts init workstation-qa.json \
  --candidate <full-40-character-git-sha>
```

Fill the relevant gate observations while testing, then validate the record:

```sh
pnpm exec tsx scripts/workstation-qa.ts validate workstation-qa.json
```

A gate cannot be marked `passed` without at least one observation and cannot pass
while any observation is `fail`. `blocked` requires a concrete blocker. The
record is evidence metadata, not a benchmark runner; screenshots, logs, exported
projects and source hashes should be referenced in each observation.

Do not commit private media, absolute personal paths, API keys or provider secrets.

## Candidate identity

Always test a full Git commit SHA. If code changes, create a new record or reset
affected gates to `not-run`. Results from an older candidate are historical
evidence only.

## Gate: Real DaVinci Resolve

Use the generated Resolve QA artifact and
[`scripts/resolve-qa/WORKSTATION.md`](https://github.com/bynanci/open-film/blob/main/scripts/resolve-qa/WORKSTATION.md).

Minimum observations:

- installed Resolve version, edition and OS;
- OTIO import result for cuts, fractional timing and edited fixtures;
- linked source identity/relink behavior;
- playback and audio behavior;
- save, close and reopen behavior;
- native project export plus screenshots;
- exact timing mismatch, warning or unsupported effect evidence.

The official OTIO parser and generated bundle do not satisfy this gate.

## Gate: Real ASR quality

Use real microphone/camera speech and a human reference transcript. Record the
provider/model, language, execution mode and source duration.

Minimum observations:

- complete transcription without protocol/runtime failure;
- monotonic segment and word timings where supported;
- measured WER/CER or an equivalent reproducible comparison against the reference;
- representative proper nouns, punctuation and code-switching errors;
- correction/edit/reopen behavior on the resulting transcript.

Do not promote deterministic fixture output as quality evidence. A quality target
should be declared before judging the sample; changing the threshold after seeing
the result invalidates a pass claim.

## Gate: Real LLM review quality

Use a fixed transcript/reference set and record provider/model plus whether it is
local or remote. Remote tests require the normal OpenFilm consent disclosure.

Minimum observations:

- bounded request behavior and no undeclared media/path/GPS data;
- correction precision/false-positive review on the fixed reference set;
- stale suggestion rejection;
- accept/skip/audit/reopen behavior;
- provider failure and cancellation behavior.

Protocol compliance alone is not a quality pass.

## Gate: GPU

Record GPU model, driver/runtime and provider/model. Compare against the same CPU
fixture where a CPU path exists.

Minimum observations:

- GPU path is actually selected, not silently falling back;
- successful transcription/analysis on the same source;
- output compatibility with the CPU path;
- elapsed time and peak memory observations;
- explicit fallback/error behavior when GPU execution fails.

Performance numbers are observations, not universal guarantees.

## Gate: Camera material

Use representative real files, including the devices OpenFilm currently claims to
recognize: Pixel HDR/Motion Photo and Insta360 X4 exports/raw associations.

Minimum observations:

- capture time/timezone and device metadata;
- orientation and aspect;
- HDR/color appearance in browser preview and rendered preview;
- proxy/thumbnail generation;
- audio where present;
- relink after moving the media root;
- source hashes unchanged after import/analysis/render.

Raw Insta360 recognition does not imply stitching or reframing support.

## Gate: 4K

Use at least one real UHD source long enough to exercise sustained decode/proxy/
render behavior. Record source codec, HDR state, duration, storage type and memory.

Minimum observations:

- import/inspection/proxy success;
- interactive source preview and timeline editing;
- preview render completion;
- cancellation and retry;
- source immutability;
- elapsed time, peak memory and any thermal/storage bottleneck.

A tiny generated 4K file is useful regression data but does not satisfy this
workstation gate.

## Gate: Selective PhotoDepth

Use the candidate-bound PhotoDepth contract and synthetic landscape/silhouette
for the repeatable baseline. Real photographs stay on the private workstation;
do not commit them, upload them to a provider, add them to CI, or include them in
logs/PR artifacts.

Minimum observations:

- original, alpha-mask and fill identities/hashes remain unchanged through edit,
  cancellation, retry, preview, export, Undo/Redo and reopen;
- image and mask dimensions/orientation, alpha edges, protected-region behavior,
  and the source-background ghosting trade-off;
- actual Monitor and decoded MP4 at start/middle/end, including arbitrary seek
  and mask/fill fallback;
- for real people, manual face/hand/pose/contact and edge review; overlapping
  people remain one protected foreground layer unless a person reviews a safe
  separation;
- sustained 4K decode/render, peak memory and any visible edge instability on
  the target GPU/CPU and display;
- cancellation and a fresh retry leave no stale frame, derived cache or source
  modification.

The app's mask bounds and hole checks are measurable diagnostics, not evidence
that a human subject's appearance is unchanged. No model or AI-generated
inpainting is used in this milestone.

## Gate: Windows installer

Run on a clean supported Windows account/VM without the development checkout.

Minimum observations:

- install from the produced installer;
- first launch and local service startup;
- required Node/media runtime/tool discovery;
- create/open/import/render workflow;
- paths containing spaces and non-ASCII characters;
- restart and reopen;
- upgrade over the previous build when applicable;
- uninstall without deleting user projects.

Linux Tauri compilation does not certify this gate.

## Gate: cross-process review recovery

Linux has automated proof for a dead owner only when boot/PID-namespace evidence
matches. Windows uses a hashed machine/OS-boot identity and a non-destructive PID
probe; actual child-process regressions cover live preservation, death, recovery
and stale-writer fencing. An occupied PID with an old execution token is kept
conservatively live; these tests do not force the OS to recycle a PID. Missing OS
evidence, denied probes and foreign scopes remain unknown. macOS automatic proof
is still unimplemented and unverified.

Workstation observations should distinguish:

- second process while owner is alive: must preserve work;
- killed/crashed owner: automatic recovery where supported;
- unknown/foreign owner: must not be silently cancelled;
- retry/skip/manual recovery behavior;
- preserved completed suggestions and exact source/transcript revision.

The combined Windows/macOS gate remains `blocked` or `failed` until its required
platform observations have candidate-bound evidence; a scoped Windows regression
run does not complete it. A deliberate user-confirmed recovery path may reduce
the operational impact but does not count as automatic recovery.

## Suggested evidence layout

```text
workstation-evidence/
  workstation-qa.json
  resolve/
  asr/
  llm/
  gpu/
  camera/
  4k/
  windows-installer/
  recovery/
```

Keep evidence immutable once referenced from a release/PR validation record.

Native startup and long-session memory use the separate
[measurement runner](native-performance.md). Its versioned manifest/report
and raw samples do not change these eight strict QA gates or certify a pass.

## M7E native installer candidate

Keep both clean Windows and macOS gates `not-run` until tested on an actual
workstation/VM with a full candidate SHA. Linux Cargo or Node process tests do
not satisfy them. Record installer/runtime-manifest/artifact SHA-256, OS/build,
architecture, app and tool versions, signature status and evidence references.

For each platform:

1. Use a clean non-administrator account without developer Node, FFmpeg, fonts or
   Perl on PATH. Confirm OS webview prerequisites and documented OS libraries.
2. Install the candidate through the normal supported OS trust flow; do not
   bypass Gatekeeper/SmartScreen. Check CJK/space/long install paths and read-only
   installation resources. Record app/runtime file hashes and permissions.
3. Start, observe first-run preflight and Service ready, create/import synthetic
   media, edit, render, decode and reopen. Check frame/audio/source receipts.
4. Keep a pending unsaved draft and attempt close; resolve it and verify normal
   service exit. Crash the shell, check owned cleanup, restart and reopen.
5. Occupy the development port and start a second app. Each service must retain
   separate ownership/session; closing one must preserve the other.
6. Exercise missing/corrupt/incorrect-architecture runtime and unwritable app
   data. Diagnostics must be readable and keyboard-operable without private paths.
7. Upgrade to the candidate, simulate failed replacement, reinstall the previous
   verified runtime and reopen supported projects. Unsupported schema must refuse
   without migration-by-downgrade. Keep an independent backup before testing.
8. Uninstall and reinstall. Verify project originals, managed sources, named
   snapshots and saved edits were retained. Record actual file observations.

Signing/feed setup and any automatic update activation require their own reviewed
configuration and failure/rollback evidence. See [Native Installer]