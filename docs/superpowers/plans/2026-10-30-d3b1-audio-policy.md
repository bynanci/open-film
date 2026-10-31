# D3B1 Independent Audio Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The coordinator has preserved the approved execution method; this design assignment stops before implementation and does not dispatch agents.

**Goal:** Give existing Clip occurrences independent sound timing and supply the deterministic B-roll audio primitive for future D3B2, with honest Record/MP4/stem parity.

**Architecture:** Strict core timing/policy values produce one bounded occurrence mix plan. Existing FFmpeg renders it using existing automation/limiter; a bounded private PCM preview feeds WebAudio for policy-enabled Record. Existing editor transactions and persistence own all writes; B2 alone will persist visual coverage.

**Tech Stack:** TypeScript, Vue 3, existing FFmpeg/FFprobe, browser WebAudio, existing catalog v6 and project schemas; no new dependencies.

**Spec:** [D3B1 independent audio timing and policy design](../specs/2026-10-30-d3b1-audio-policy-design.md).

## Global Constraints

- Base: merged `1005d381cc2000e0f991fc3e1779ebb2a61cd7ab`; implement only after parent design audit.
- No second timeline, silent extra audio clip, source overwrite, provider call, private-media upload, executable recipe or new dependency.
- New audioTiming version 1 uses canonical postdecode/resample 48,000 Hz samples; preserve absent-policy behavior exactly.
- Audio policy gain is finite in [0, 1]; keep-primary excludes role/gain; reuse existing volume/automation/limiter/measurements.
- B2 owns coverage relationship, proposal, receipt and persistence. No generic coverage HTTP input or saved binding array in B1.
- Schema 1.2 promotes on first independent audio write; pin 1.1 promotion cannot downgrade it. Legacy default remains 1.0.
- Explicitly configured split and replacement reject without state change until audio is relinked; do not advertise supported independent-audio split.
- Preview: 3600 seconds, 1 GiB per file, 2 GiB completed cache, one active project preparation, four-second PCM read maximum, eight seconds client buffer.
- Binding budget: 1000; resulting segments: 10,000. Millisecond handle UI offsets: [-60000, 60000].
- No full Vitest, normal Playwright, native benchmark, push/PR/merge or use of reserved 4310/1420 during this design assignment. Later browser/media gates require coordinator scheduling; HTTP tests use port 0.

## Review Focus

- A 44.1 kHz AAC source with priming and speed change must follow canonical decoded samples without moving picture cuts (Tasks 2, 4, 8).
- A primary spanning multiple replacement windows must retain tempo/envelope phase and remain suppressed in a role-filtered stem (Tasks 2, 4).
- Repeated occurrences of one asset, or a later relink under the same ID, must not alias policy, waveform or PCM cache state (Tasks 2, 5, 7).
- Old 1.0 and pin-aware 1.1 applications must reject new semantics; pin promotion, Undo and variant export must not lower 1.2 or erase parallel-owner fields (Tasks 1, 3, 7).
- An arbitrary seek during PCM preparation, visibility change or stale reply must not play old sound, duplicate sound or quietly fall back to frame-gated audio (Tasks 5, 6).

## File ownership and implementation sequence

New focused modules are `core/src/audio-policy.ts` for values/evaluation,
`solver/src/audio-timing.ts` for edit policy, `render/src/audio-plan.ts` for graph
compilation, `application/src/record-audio-preview.ts` for private preparation,
and desktop `recordAudioPlayback.ts` for bounded PCM scheduling. Existing
owners retain validation, command parsing, persistence, Record pictures,
Sequence waveforms, source cache, gain controls, exports and measurements.
Do not replace existing files with broad rewrites.

Read the pinning design and the actual merged implementation before Task 1.
Coordinate shared schema/context changes with its owner; never copy unreviewed
partial work. The plan's 1.1/1.2 acceptance requires the reviewed pin enforcement
implementation to be integrated first. D5A/B/C/D8 are independent candidates;
preserve their landed fields and validators when rebasing, without inventing
permissive placeholders. Each task gets its own focused review and commit.

### Task 1: Strict core contracts and capability gate

**Files:** Create `packages/core/src/audio-policy.ts`, `schemas/openfilm-project-1.2.0.schema.json`, `packages/core/tests/audio-policy-schema.test.ts`. Modify `packages/core/src/models.ts`, `validation.ts`, `migration.ts`, `index.ts` and the actual merged pin capability-promotion owner.

**Interfaces:** Export AudioTimingV1, EmbeddedAudioPolicyV1, CoverageAudioBindingV1, AudioMixContext, ResolvedAudioInterval, AudioMixSegment and AudioMixPlan exactly as the spec. Export `validateAudioTiming(value:unknown):AudioTimingV1`, `validateEmbeddedAudioPolicy(value:unknown):EmbeddedAudioPolicyV1`, `validateCoverageAudioBindings(value:unknown):readonly CoverageAudioBindingV1[]`, `AUDIO_PROJECT_SCHEMA_VERSION = "1.2.0"` and `promoteAudioProject(project:OpenFilmProject):OpenFilmProject` (detached, monotonic).

- [ ] Add failing tests `legacy_absence_is_not_materialized`, `rejects_audio_in_1_0_and_1_1`, `old_readers_reject_1_2`, `pin_promotion_retains_1_2`, and `closed_audio_values`: assert exact absent object identity after JSON round-trip, project-header rejection, finite safe sample coordinates and all malformed input classes from the spec.
- [ ] Run `pnpm exec vitest run packages/core/tests/audio-policy-schema.test.ts --maxWorkers=1`; verify failures identify missing contracts.
- [ ] Implement validators using descriptor-safe closed object checks; add Clip.audioTiming and schema dispatch without changing pipeline/recipe version constants. Reuse actual pin-owner support and keep 0.1→1.0 migration unchanged.
- [ ] Run the focused file plus `packages/core/tests/project.test.ts`; require all pass. Inspect frozen-validator rejection fixtures, not merely new-reader assertions.
- [ ] Commit core/schema files and tests with `feat(core): define versioned independent audio timing`.

### Task 2: Timing, policy evaluation and raw waveform projection

**Files:** Modify `packages/core/src/audio-policy.ts`, `sequence-waveform.ts`, `index.ts`. Create `packages/core/tests/audio-policy.test.ts`; extend `packages/core/tests/sequence-waveform.test.ts`.

**Interfaces:** Implement `resolveAudioInterval(clip:Clip,asset:MediaAsset,compositionDuration:number):ResolvedAudioInterval`, `audioTimingFromHandles(clip:Clip,asset:MediaAsset,offsets:{startOffsetMs:number;endOffsetMs:number}):AudioTimingV1`, and `buildAudioMixPlan(composition:Composition,assets:readonly MediaAsset[],context:AudioMixContext):AudioMixPlan`. Extend projectClipWaveform with optional plan input and returned per-column audible/excluded/suppressed masks, retaining existing peaks/covered fields and exact absent-input behavior.

- [ ] Add failing tables for rational pictures, .017-second starts, 48-samples/ms conversion, .5/1/2 speed, one-sample windows, source exhaustion, all three modes, disjoint windows, duplicate bindings, recursive roles and plan budgets. Assert start/end integers, unchanged picture ranges, exact segment admission and stable order.
- [ ] Add `replacement_precedes_stem_role_selection`, `same_asset_distinct_occurrences`, `fragment_keeps_original_automation_origin` and waveform cases for raw peaks outside picture edges and partially suppressed columns. Assert gain appears once and primary masks target clip IDs only.
- [ ] Run `pnpm exec vitest run packages/core/tests/audio-policy.test.ts packages/core/tests/sequence-waveform.test.ts --maxWorkers=1` and observe the expected failures.
- [ ] Implement an endpoint sweep bounded by input/segment caps, single-admission secondary ownership and shared source mapping. Retain a byte-for-byte legacy range path. Keep raw waveform peaks separate from contribution masks.
- [ ] Rerun the focused tests, require pass and commit as `feat(core): evaluate audio intervals and coverage mix policy`.

### Task 3: Typed editing, conflicts and atomic persistence

**Files:** Create `packages/solver/src/audio-timing.ts`, `packages/solver/tests/audio-timing.test.ts`, `packages/application/tests/audio-timing.test.ts`. Modify `packages/solver/src/editing.ts`, `index.ts`, `packages/application/src/editor.ts`, and actual merged pin policy classification.

**Interfaces:** Add `audio.timing` command from spec. Export `validateAudioEdit(before:EditorDocument,after:EditorDocument,assets:readonly MediaAsset[],commands:readonly TimelineCommand[],context:Required<TimelineEditContext>):void`. Reuse the single optional fourth TimelineEditContext. Application captures source facts and passes authoritative timebase/origin; command bodies cannot supply either.

- [ ] Add failing command/parser tests for locks, unknown keys, injected origin, arbitrary sample assignment that desynchronizes linked captions, negative/overflow range, missing stream and short source. Assert no mutation of the input document.
- [ ] Add the operation matrix: trim keeps target sound, ripple translates peer sound by sample delta, speed retains source bounds, split/replace reject, shortened film rejects explicit audio truncation, final-batch caption edits resolve only valid conflicts. Include direct pinned target and forbidden pinned neighbor cases from the integrated owner.
- [ ] Add application tests for source-byte changes during async validation, stale request/retry, failed save, one history entry for a timing+automation batch, header promotion and Undo/Redo/reopen. Assert durable project/catalog and revision/history, not only returned flags.
- [ ] Run `pnpm exec vitest run packages/solver/tests/audio-timing.test.ts packages/application/tests/audio-timing.test.ts --maxWorkers=1`; observe red, implement detached final-candidate validation, bypass legacy automation/overlay clamping for explicit timing, exact CAS/hash recheck and existing persistence reuse, then require green.
- [ ] Commit as `feat(editor): edit independent audio timing atomically`.

### Task 4: One FFmpeg graph for MP4, PCM and stems

**Files:** Create `packages/render/src/audio-plan.ts`, `packages/render/tests/audio-policy.test.ts`, `tests/fixtures/audio-policy.ts`. Modify `packages/render/src/index.ts`, `manifest.ts`, `packages/application/src/index.ts`, `export-profiles.ts`; extend existing render/audio-quality/sequence-waveform tests only where affected.

**Interfaces:** Export internal `compileAudioMixPlan(plan:AudioMixPlan,composition:Composition,inputs:ReadonlyMap<string,number>):{filters:string[];labels:string[]}`. Add trusted `RenderOptions.audioMixContext?:AudioMixContext`. audioSourceAssetIds and role discovery consume the same complete plan; only afterward filter role. Record plan version/digest for new-policy manifests.

- [ ] Add failing graph tests for exact legacy graph identity, explicit canonical resample/sample trim, source-end validation, one source/tempo/automation branch per occurrence, policy gain replacement and mute-by-interval after automation. Test role preflight against full-plan suppression.
- [ ] Add real two/three-tone WAV/MP4 cases for source handles, 44.1/48 kHz, AAC edit-list delay, a 125-ms delayed audio stream, speeds .5/1/2, masks and boundary-spanning effects. Use spec timing/spectral thresholds; inspect decoded PCM, not just filter strings.
- [ ] Run `pnpm exec vitest run packages/render/tests/audio-policy.test.ts --maxWorkers=1`; observe red. Implement plan compilation using asplit/atrim/silence/concat after the occurrence DSP branch, preserving limiter and legacy compilation.
- [ ] Route WAV/master/stem selection and source preflight through the same plan. Preserve exact film duration and report decoded short handles as failure before final publication; maximum-output truncation cannot pass.
- [ ] Rerun the focused file and relevant existing audio-quality/sequence-waveform cases; require pass. Commit as `feat(render): share independent audio mix across outputs`.

### Task 5: Bounded private PCM preparation and HTTP transport

**Files:** Create `packages/application/src/record-audio-preview.ts`, `packages/application/tests/record-audio-preview.test.ts`, `tests/integration/record-audio-preview-http.test.ts`. Modify `packages/application/src/index.ts`, `apps/server/src/server.ts` and `apps/desktop/src/api.ts`.

**Interfaces:** `RecordAudioPreviewService.prepare(compositionId:string,baseRevision:string,signal?:AbortSignal):Promise<RecordAudioPreviewDescriptor>` and `.read(id:string,startSample:number,count:number):Promise<Uint8Array>`. Descriptor is the closed spec shape: `{version:1,id,revision,sourceKeyDigest,sampleRate:48000,channels:2,format:"pcm_s24le",lengthSamples}`. POST `/api/compositions/:id/record-audio-preview` accepts `{baseRevision}` and uses existing jobs; GET `/api/record-audio-preview/:id/pcm?startSample=N&count=N` uses opaque ready ID and bounded integer query validation. Desktop API methods wrap those routes without paths.

- [ ] Add failing tests for exact descriptor, rendered full-mix reference, one active preparation, cancel, 3600-second/1-GiB/2-GiB caps, pending publication, header/data-size checks, malformed range queries, stale source/revision and cache corruption.
- [ ] Add port-0 HTTP tests preserving host/origin/session checks; traversal or arbitrary path fields fail. Assertions include no source/project writes, no ready descriptor for truncated files, and bounded returned bytes of at most 192000 × 2 × 3.
- [ ] Run `pnpm exec vitest run packages/application/tests/record-audio-preview.test.ts tests/integration/record-audio-preview-http.test.ts --maxWorkers=1`; observe red.
- [ ] Implement existing audioOnly render reuse into private staged cache, actual source/disk rechecks before ready publication, LRU excluding active reads, safe bounded PCM extraction and cleanup. Render the full composition once; arbitrary subsequent windows read the same DSP history rather than independently rerendering limiter/tempo state.
- [ ] Rerun focused tests and require pass; commit as `feat(application): prepare bounded Record PCM previews`.

### Task 6: Record sample scheduler and explicit timing controls

**Files:** Create `apps/desktop/src/recordAudioPlayback.ts`, `tests/unit/record-audio-playback.test.ts`, `tests/unit/audio-timing-inspector.test.ts`. Modify `RecordMonitor.vue`, `composables/useRecordTransport.ts`, `TimelineEditor.vue`, `SequenceWaveform.vue`, `SoundtrackPanel.vue` and all three existing locale owner modules. Extend `tests/unit/record-monitor.test.ts`, `record-transport.test.ts`, `sequence-waveform-ui.test.ts`.

**Interfaces:** `createRecordAudioPlayback({context,readPcm,onTime,onState}):RecordAudioPlayback`; playback methods `load(descriptor)`, `play(startSample)`, `pause()`, `seek(sample)`, `dispose()`. Read function takes descriptor ID/start/count plus AbortSignal; onTime emits canonical sample position and onState emits preparing/ready/playing/buffering/failed with a localized diagnostic key. Existing transport gains an optional externally owned continuous clock for policy mode; legacy rAF path is preserved.

- [ ] Add failing scheduler tests using a controllable AudioContext/clock for contiguous two-second nodes, 250-ms lookahead, ≤8-second memory, 24-bit conversion, underrun hold, seek-generation cancellation, hidden tab, project/revision switch and disposal. Assert one sound owner and zero legacy element play calls in PCM mode.
- [ ] Add timing inspector tests for linked/independent display, verified handles, sample remainder, ±60000 ms bounds, Apply/Reset commands, locks, missing stream, pending/rejected save and explicit split guidance. Add raw waveform/mask labels without volume scaling.
- [ ] Run `pnpm exec vitest run tests/unit/record-audio-playback.test.ts tests/unit/audio-timing-inspector.test.ts tests/unit/record-monitor.test.ts tests/unit/record-transport.test.ts tests/unit/sequence-waveform-ui.test.ts --maxWorkers=1`; observe red.
- [ ] Implement the controller and bind normal 1× audio time to picture frames, preserving play intent across holds. Silence and label non-1× shuttle; unsupported WebAudio errors explicitly. Reuse existing gain/role/effects controls and route writes through typed commands only.
- [ ] Rerun the listed files and `pnpm test:i18n`; require pass. Commit as `feat(desktop): play and edit independent sound timing`.

### Task 7: Whole-project persistence, Collect and parallel-owner compatibility

**Files:** Modify `packages/application/src/project-versions.ts`, `creative-variants.ts`, `collect-coverage.ts`, `collect-derived-media.ts`, `packages/exporters/src/index.ts`, `handoff.ts`, `compatibility.ts`, and catalog snapshot validation in `packages/catalog/src/index.ts` as required by audited version dispatch. Create `packages/application/tests/audio-policy-persistence.test.ts` and `packages/exporters/tests/audio-policy.test.ts`.

**Interfaces:** Existing persistence and export APIs retain signatures. Extend Collect's existing reason union with `source.independent-audio`; any asset used by an explicit range takes whole-original coverage, and defensive derivative remap rejects it. Unsupported interchange timing is a compatibility finding plus preserved native metadata.

- [ ] Add failing exact-object round trips across save/reopen, Named Version inspect/diff/restore, variant creation/adoption, full/scoped directory/ZIP Collect and legacy v5 snapshots. Verify original source hashes and inline audio/pin/photo/title/color/preset fields survive; derived remap rejects mixed explicit/legacy uses of one source.
- [ ] Add tests for explicit older Restore, monotonic pin/audio capability promotion, unsupported interchange warning and full-audio dependency collection beyond picture handles. Preserve source/clip Restore lock checks.
- [ ] Run `pnpm exec vitest run packages/application/tests/audio-policy-persistence.test.ts packages/exporters/tests/audio-policy.test.ts --maxWorkers=1`; observe red.
- [ ] Update actual owner paths, replacing hardcoded 1.0 project reconstruction with preserved validated capability versions. Do not change independent export-envelope or pipeline-recipe versions. Reject a variant placement that cannot retain protected audio intent.
- [ ] Rerun focused tests, require pass and commit as `fix(project): preserve independent sound across project workflows`.

### Task 8: Adversarial media evidence, guide and final gates

**Files:** Extend `tests/fixtures/audio-policy.ts`. Create `tests/e2e/audio-policy.spec.ts`, `docs/audio-policy.md`, `docs/en/audio-policy.md`, `docs/ja/audio-policy.md`, `docs/validation-audio-policy.md`, and localized validation mirrors required by the existing documentation convention. Extend `packages/render/tests/audio-policy.test.ts`, `tests/unit/record-audio-playback.test.ts`, `TASKS.md` and the existing roadmap owner only with demonstrated status.

**Interfaces:** Synthetic fixture helper produces deterministic source files and a manifest with source hashes, channels/sample rates, tone windows and expected source/timeline coordinates. Evidence format records exact commits/toolchain/commands, encoded SHA, decoded PCM SHA, timing/spectrum/peak measurements and failed negative controls.

- [ ] Run and record all seven spec acceptance groups. Explicit assertions: speed-1 PCM edge ≤1 sample after one common baseline delay; non-1× output matches its identically processed atempo reference; Record vs WAV error ≤2/2^23; AAC edge ≤1024/48000 s; included spectral level ±0.5 dB; excluded tone ≥45 dB down. Assert unchanged source hashes and unchanged rational picture cut frames.
- [ ] Execute each negative control against the same harness; require duplicate-secondary, frame-quantized onset, global primary mute, automation restart, source change, truncated PCM, stem suppression bypass and stale preview to fail their specified gate. A control that passes blocks completion.
- [ ] Under a coordinator-provided browser lease, run only the focused audio-policy workflow and capture actual WebAudio scheduling output against rendered PCM, including seek/pause/Undo/reopen and interrupted preparation. Never substitute mocks or unrun assertions for this evidence.
- [ ] Write guide/limitations and localized docs, including split/relink restriction, one-hour preview preparation cap and silent shuttle mode. Update the authoritative nested D3B1 checkbox only after implementation and required exact-candidate gates; leave D3B2 unchecked.
- [ ] Run relevant typecheck, lint, formatting, i18n/doc locale checks and targeted suites once. Coordinator schedules full integration/OS/manual gates separately; disclose unrun gates. Inspect diff for unrelated edits and commit as `test(audio): verify J L timing and explicit mix parity`.

## Self-review and handoff

The tasks cover contract/version safety (1), canonical timing and policy (2),
editing/locks/captions/CAS (3), actual mix/stems (4), private DSP reference (5),
Record/UI/waveforms (6), whole-project retention (7), and adversarial measured
acceptance (8). The five review-focus cases each name owning tests above.
No task adds B2 coverage persistence, a second automation engine or implicit
sound clips. Stable sample/effect clocks, role/gain precedence and project
version promotion are design decisions, not implementer guesses.

This plan remains a candidate until the parent completes independent audit.
Do not start product code, run implementation suites, publish or merge from this
design assignment. Follow the already approved execution method after the audit;
no additional user question is needed.
