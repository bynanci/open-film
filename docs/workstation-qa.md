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
[`scripts/resolve-qa/WORKSTATION.md`](../scripts/resolve-qa/WORKSTATION.md).

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
matches. Windows/macOS automatic dead-owner proof remains unimplemented until an
OS-specific identity/liveness strategy is verified.

Workstation observations should distinguish:

- second process while owner is alive: must preserve work;
- killed/crashed owner: automatic recovery where supported;
- unknown/foreign owner: must not be silently cancelled;
- retry/skip/manual recovery behavior;
- preserved completed suggestions and exact source/transcript revision.

Until Windows/macOS automatic proof exists, record this gate as `blocked` or
`failed`, not passed. A deliberate user-confirmed recovery path may reduce the
operational impact but does not count as automatic recovery.

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
