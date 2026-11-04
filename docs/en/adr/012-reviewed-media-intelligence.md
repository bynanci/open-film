# ADR 012: Source-bound media intelligence with explicit reviewed edits

Status: Accepted for the local silence CLI/application slice; external adapters remain future work.
Date: 2026-11-04.

## Context

OpenFilm already has source-bound transcripts, waveform and scene evidence,
rhythm analysis, role-based audio stem exports, primary-color review, and
declarative GraphicScenes. Reviewing eleven upstream media projects identifies
useful additional analysis and processing methods, but does not establish that
their runtimes, model weights, clocks, or output formats are interchangeable.
The [integration reference](../media-intelligence-integrations.md) records
the official sources, checked revisions, and code/model license distinctions.

The immediate gap is a reviewable low-energy removal workflow. Auto-Editor's
audio-activity and margin controls inform the interaction. OpenFilm can implement
this bounded workflow with its existing FFmpeg runtime and editor transactions,
without installing Auto-Editor or adding Python, GPU, or model dependencies.
Energy thresholds do not establish whether speech or meaningful content is absent.

## Decision

1. Keep analysis, derived-media processing, and timeline edits separate.
   Analysis binds to the actual original bytes and records parameters and
   algorithm identity. Processing produces a separate derived asset. An
   analysis result never edits a Composition merely by completing.
2. Implement the first silence slice as foreground, cancellable CLI commands
   and `app.silence` operations: analyze, create a review proposal, and apply
   the reviewed proposal with explicit confirmation. HTTP, desktop UI,
   background scheduling, and restart/resume are separate slices.
3. Analyze the first audio stream at 48 kHz with 20 ms windows and the maximum
   per-channel peak. Accept zero-based container starts and preserve audio-stream
   delays and packet gaps. Reject nonzero container start time with 422 rather
   than guessing a corrected duration. Do not cancel opposite-phase channels
   through a mono mix. Do not reuse the existing 8 kHz waveform/rhythm analysis rate:
   removing audible high-frequency content could misclassify it as silence.
   Describe the result as low-energy/silence candidates, not VAD.
4. Bound threshold to [-80, -10] dBFS, minimum silence to [0.1, 30] seconds,
   and padding to [0, 2] seconds; defaults are -40, 0.5, and 0.12. Limit a
   source to 24 hours and evidence to 2,000 intervals. Accept regular local
   files with 1–64 audio channels, cap source snapshots at 32 GiB and review
   JSON at 1 MiB, and retain the existing one-hour FFmpeg execution timeout.
   Reject unsupported or oversized input instead of presenting incomplete
   evidence as complete.
5. Persist an exact review record. Application acceptance verifies the record,
   full proposal hash, actual source hash, and Composition revision. Neither
   a generic editor route nor a batch can bypass the same acceptance
   check. The silence command must be the transaction's only leaf; one flat batch
   may wrap it but nested batches and mixing it with another edit are rejected. Acceptance must not
   regenerate a different, unreviewed proposal.
6. Project source intervals through existing trim/speed rules. Reject lock
   and user-pin conflicts. Use the existing ripple rules for supported linked
   audio, captions, and graphics; fail closed when independently authored
   `audioTiming` would require unsupported sample-range splitting. Commit one
   editor transaction with the existing session-local Undo/Redo behavior.
   Review records and the final timeline persist; undo history does not
   persist across separate CLI processes.
7. Keep optional providers behind capability, runtime, provenance, and rights
   checks. Use source PTS/time bases and explicit sample clocks when adapting
   output. Pin model artifacts and their terms separately from repository code.
   No new external model is downloaded or bundled by this decision.

## Alternatives considered

**Run Auto-Editor directly or import its v3 timeline first.** That introduces
another executable and a versioned external timeline contract before the
review boundary is established. This slice independently implements the
activity/padding interaction inside the existing Composition model. A later
adapter would need explicit handling of time bases, layers, effects, and
unsupported features; its existence must not be inferred from this work.

**Automatically remove all detected silence.** Rejected because low energy is
not proof of unwanted content, user-authored timing may be protected, and
analysis can become stale. Explicit review remains required.

**Install all eleven upstream tools now.** Rejected for this slice. Several
overlap capabilities already present; some require large models or new
runtime families. Demucs' official maintainer distinguishes MIT code from
unclear weight rights, rembg model terms differ from its MIT code, and the
applicable FFmpeg license depends on the actual configured binary. Those
facts require artifact-specific decisions, not a blanket dependency claim.

**Execute arbitrary HyperFrames HTML inside a project.** Deferred. The current
GraphicScene contract is declarative. Frame seeking and readiness checks are
useful references, while code-bearing HTML/CSS introduces a distinct execution
and resource boundary requiring its own decision.

## Consequences

The first workflow stays local and uses the existing media runtime and one
authoritative Composition. Users inspect the exact plan before changing their
project, and the existing editor history can undo or redo the accepted change
within the same application session.
Original media remains unchanged. Silence results are limited to one audio
stream and 20 ms analysis resolution; they are not semantic speech boundaries.
Some edits with independent audio timing are deliberately unsupported.

Future scene/rhythm providers can supply better evidence without replacing the
editor. Restoration, stabilization, separation, and interpolation need derived
asset lineage and explicit timing maps. Browser animation rendering needs
versioned environments and controlled resources. These are future contracts,
not statements that the referenced tools are installed or production validated.

## Verification

Verify opposite-phase multichannel input, rejection of nonzero container starts,
delayed audio streams and short packet gaps, parameter bounds, source-duration/
interval limits, cancellation, and
failure cleanup. Verify trim/speed projection, padding, rejection of stale or
altered review records, generic/batch acceptance enforcement, lock/pin conflicts,
unsupported audio timing, and complete Composition Undo/Redo. Keep focused
test evidence distinct from cross-platform CI and real-workstation validation.

This ADR extends [ADR 005](005-local-first.md) and retains the single-composition
and hard-constraint principles in [ADR 003](003-project-format.md) and
[ADR 008](008-duration-solver.md). It changes no existing source license or
historical grant.
