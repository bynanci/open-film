# D5C Primary Color Design

Date: 2026-10-30. Inspection base:
`e1255b1a8a83260149211d909cca8c1a50948c6b`.

Status: proposed contract for coordinator approval before product changes. The
user authorized the D work, implementation, tests and reviewed integration; this
document supplies the independent color/threat/compatibility gate required by
`TASKS.md` and `docs/roadmap/seven-subsystem-reconciliation.md`. No release number
or completion claim follows from this document.

## Intent and existing owners

Give photos and flat video bounded warm/cool, exposure-compensation and contrast
controls before the creative Film Look. Keep original media immutable. Auto Match
compares actual decoded samples and presents a suggestion with measured before
and after evidence; only an explicit Apply changes the saved Composition.

Existing owners inspected:

| Owner                                                                     | Existing behavior and D5C seam                                                                                                                                       |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/media/src/color.ts`                                             | `probeColor`, `hdrToneMapFilter`: recognized PQ/HLG BT.2020 is Hable tone-mapped to BT.709; incomplete HDR metadata fails. Reuse unchanged.                          |
| `packages/core/src/looks.ts`                                              | Immutable creative recipes, `filmLookMatrix`, `resolveFilmLook`; clip/beat/film inheritance. D5C does not alter a recipe or assume a Film Look version.              |
| `packages/solver/src/editing.ts`                                          | Typed commands, detached document edits, effective-coefficient checks for protected inherited looks. Extend this owner.                                              |
| `packages/application/src/editor.ts`                                      | Strict command parsing, serialized revision checks, request replay, one-step history, validated save and rollback. All correction edits use it.                      |
| `packages/render/src/index.ts`, `photo-filters.ts`                        | Tone map and creative look are applied to source pixels before source geometry/compositing; the photo path includes both diptych sources. Insert primary once.       |
| `RecordMonitor.vue`, `PhotoPresentationPreview.vue`, `TimelineEditor.vue` | Source-element SVG filters, stable media ownership, arbitrary sequence seeks and source preview. Add shared primary coefficients without replacing the transport.    |
| `packages/application/src/audio-quality.ts`                               | Private before/candidate evidence and review-ID validation inside editor serialization. Follow its ownership pattern with stricter bounded source snapshots.         |
| Exporters, NLE handoff, Collect, Named Versions                           | Preserve authored Composition data; handoff has explicit metadata/baked reports. Extend their existing contracts rather than creating an alternative project format. |

No second timeline, executable filter in project JSON, custom LUT import, remote
URL, upload, provider or dependency upgrade is introduced. This is encoded-SDR
correction; camera profiling, Kelvin white balance, scene-linear exposure,
highlight recovery and calibrated display certification remain outside D5C.

## Approaches and proposed choice

1. **Proposed: one bounded, versioned, encoded-SDR affine correction**, with
   shared core coefficients and separate SVG/FFmpeg adapters. Fits the published
   Film Look domain and preserves legacy identity rendering. The controls are a
   practical warm/cool and brightness adjustment, with the documented limits of
   encoded-SDR math.
2. Scene-linear chromatic adaptation and exposure. More physically meaningful,
   but requires explicit input/display transfer management and an additional
   rendering engine or nonlinear browser pipeline. That changes the current
   color-management contract and is not a bounded addition to Film Looks.
3. Independent CSS temperature/brightness/contrast and FFmpeg `eq` recipes.
   Small implementation, but equations, pivot, clipping and channel semantics
   diverge. It cannot satisfy the shared-coefficient gate.

These are builder recommendations pending coordinator approval, not decisions
attributed to the user. The first approach is recommended.

## Versioned data and scope

Add `PrimaryColorCorrection` to core models:

```ts
interface PrimaryColorCorrection {
  version: 1;
  temperature: number; // finite -1..1; warm positive, cool negative
  exposureEv: number; // finite -2..2; encoded-SDR gain, not scene-linear stops
  contrast: number; // finite 0.5..1.5; identity 1, encoded-RGB pivot 0.5
}
// Composition.defaultPrimaryColor?: PrimaryColorCorrection
// Composition.beatPrimaryColors?: {
//   beatId: string; correction: PrimaryColorCorrection
// }[]
// Clip.primaryColor?: PrimaryColorCorrection
```

The existing schema stays `1.0.0` and catalog stays v6; these are optional
Composition/Clip fields. Absence inherits, with clip → beat → film → identity
priority. Explicit `{version:1, temperature:0, exposureEv:0, contrast:1}` stops
inheritance. `null` is permitted only in commands to remove an override; saved
fields must be a valid recipe or absent. Reading a legacy project does not write
default fields or migrate its bytes.

Film means the selected Composition within its project. There is no global
catalog/asset correction or cross-project source mutation. A resolved clip recipe
is applied independently to each of its decoded sources, including both diptych
photos. The beat/film recipe does not color title tracks, GraphicScene nodes,
caption rasters, gaps, canvas, audio or controls. This matches Film Look scope.
A future source override map is a separate product decision, not a hidden fourth
scope in D5C.

`validatePrimaryColorCorrection(unknown)` returns a detached JSON value. Reject
unknown keys, unknown/missing versions, missing parameters, nonnumeric strings,
NaN/infinities, arrays, unexpected prototypes and out-of-range parameters. Do not
clamp malformed saved data or treat an unknown version as identity. Beat entries
use existing stable-ID validation, unique beat IDs, story membership when known,
and the same maximum of 1000 overrides as Film Looks. Validate configured recipes
even if currently overridden or on an inactive track, before source I/O/export.

## Shared numerical contract

Create `packages/core/src/primary-color.ts`. It owns the following immutable v1
constants, functions and types; browser/render adapters must not rederive math:

```ts
const PRIMARY_COLOR_VERSION = 1;
const PRIMARY_COLOR_DOMAIN = "encoded-sdr-rgb";
const PRIMARY_COLOR_IDENTITY: Readonly<PrimaryColorCorrection>;
interface PrimaryColorCoefficients {
  version: 1;
  domain: "encoded-sdr-rgb";
  slopes: readonly [number, number, number];
  offset: number;
  matrix: readonly number[]; // SVG row-major 4x5, constant column is offset
}
interface ResolvedPrimaryColor {
  correction: PrimaryColorCorrection;
  source: "clip" | "beat" | "film" | "original";
}
primaryColorCoefficients(value?: PrimaryColorCorrection | null): PrimaryColorCoefficients;
isPrimaryColorActive(value?: PrimaryColorCorrection | null): boolean;
resolvePrimaryColor(
  composition: Pick<Composition, "defaultPrimaryColor" | "beatPrimaryColors">,
  clip: Pick<Clip, "primaryColor" | "beatId">,
): ResolvedPrimaryColor;
applyPrimaryColorPixel(
  rgba: readonly [number, number, number, number],
  coefficients: PrimaryColorCoefficients,
): [number, number, number, number];
```

For normalized, unassociated input RGB `x` and authored `t`, `ev`, `c`:

```text
e = 2 ** ev
s = [e*c*(1 + 0.1*t), e*c, e*c*(1 - 0.1*t)]
b = 0.5*(1 - c)
y[channel] = clamp(x[channel]*s[channel] + b, 0, 1)
alpha_out = alpha_in
```

The conceptual order is warm/cool, exposure gain, then contrast around 0.5, fused
without an intermediate clamp. Clamp once after primary correction, and again
after the separate Film Look operation. Do not multiply the primary and Film
Look matrices together; that would move the clipping boundary and change pixels.

Round derived slopes and offset with `Number(value.toFixed(12))`, normalize `-0`
to `0`, and use those exact coefficients in all adapters and manifests. Authored
numbers remain finite bounded JSON numbers; UI steps are 0.01, with temperature
displayed as -100..100 and contrast as 50..150%. Derived gain ranges 0.1125..6.6,
offset -0.25..0.25. A raw 8-bit reference operation rounds each final RGB channel
with `floor(value + 0.5)` after clamping; alpha is copied exactly.

SVG uses the diagonal 4×5 matrix with the lift in the constant column, in `sRGB`.
Primary offsets are independent of alpha on unassociated RGB. Transparent pixels
remain transparent; partial alpha is preserved. This differs deliberately from
the existing Film Look alpha-column lift and does not modify that published math.

FFmpeg `primaryColorFilters(recipe): string[]` returns `[]` for absent/identity
recipes before adding any pixel-format conversion. Active recipes use
`format=rgba` plus `lutrgb`, whose three channel expressions are generated solely
from validated numeric coefficients, with `floor(clip(val*s+maxval*b,0,maxval)+0.5)`
and alpha identity. Escape filter-expression commas in the adapter; execute argv
through `runProcess`, never a shell. A single `colorchannelmixer` is unsuitable:
its channel coefficients are bounded to ±2 while the valid combined slope can
reach 6.6. The inspected FFmpeg build exposes `lutrgb` and component/alpha options.

Pin the v1 constants, representative coefficients and boundary combinations in a
golden fixture. A formula change requires a new recipe version and compatibility
decision. Shared coefficients establish a shared equation, not universal browser
decode, transfer or physical-display parity.

## Processing order and other D work

```text
source decode
→ existing HDR tone map, when required
→ D5A raw-source ambient/foreground preparation, when selected
→ primary correction (clamp)
→ resolveFilmLook / shared Film Look adapter (clamp)
→ normal source geometry and clip compositing
→ canvas/gaps/titles/captions/GraphicScene composition
→ output encode
```

D5A's prepared ambient and foreground group contains source picture pixels and
receives primary/Film Look exactly once, with matching scope. Do not grade its
derived PNG and then grade it again with the foreground. Keep unrelated gaps and
canvas outside the filtered group. If a future design introduces source-specific
recipes in a diptych, preparation/grade must stay per source before joining.

Consume the shared `FilmLook` resolver/matrix/adapter without assuming v1 or
accessing `.preset` directly in new D5C logic. D8 may add an immutable v2 matrix
snapshot; its validation and strength semantics remain with the Film Look owner.
Existing look-only comparisons remain look-only and preserve primary correction;
replace misleading “original” wording with “before Film Look” where necessary.
Auto Match comparison explicitly shows primary-stage samples before Film Look.

HDR source previews continue to require the existing compatible tone-mapped
proxy/thumbnail. Do not apply a second tone map in SVG or bake project correction
into the shared source proxy. FFmpeg continues reading original source media.
Missing compatible previews or unsupported HDR metadata show existing errors;
they cannot silently substitute an ungraded or guessed-color source.

## Typed edits, protection and recovery

Extend `TimelineCommand` with `type:"primary-color"`, `scope:"film"|"beat"|"clip"`,
the required `beatId`/`clipId`, and `correction:PrimaryColorCorrection|null`.
Only the clip variant may carry optional `primaryColorReviewId:string` for an
Auto Match Apply. Reject irrelevant IDs, extra fields and invalid review IDs.
Manual commands do not require measurement or a media read.

Use the application/HTTP editing request `{baseRevision,requestId,commands}`;
a thin CLI `primary-color edit --commands` adapter submits that same bounded
request to `TimelineEditor.edit`. One committed control change or accepted
suggestion is one history
step. Numeric typing/dragging stays a local draft until a valid commit; do not
save on every input event. Selection/project/composition changes cancel the draft
and fence late responses. Parent edits retain all child overrides.

Clip/source/paired-photo locks prevent effective color changes. Film/beat edits
compare resolved rounded coefficients before/after across affected visual clips;
reject the entire batch if any protected source would change. An unchanged
effective recipe behind an override is permitted. Clip edits use the existing
strict clip/source lock rule. Pinned/required selections remain selected and
retain source IDs and timing; like Film Looks, pinning alone is not a color lock.
Rejected or unsupported source media cannot receive a clip correction. No edit
changes duration, source ranges, speed, audio, titles, source bytes or catalog
metadata.

Extend command parsing and validation inside the existing serialized editor,
before solver application/persistence. Save failure restores the previous
in-memory project and leaves history unchanged. Existing request-ID replay
acknowledges an exact retry; a different body with the same ID conflicts. Undo
and Redo restore primary settings with the rest of the canonical document.
Autosave, reopen, Named Versions, variant clones and Collect retain the optional
fields. Reopen restores accepted authored settings; it does not resume a private
Auto Match proposal. Cross-restart replay with an expired review fails explicitly
and reloads current settings; it cannot apply twice or silently regenerate.

## Auto Match: bounded evidence and explicit review

Create `PrimaryColorReviewService` in application and a bounded local sampler in
`packages/render/src/primary-color-review.ts`. The service owns at most five
private reports per application, expires them after 30 minutes, removes their
private directories on discard/expiry/cancel/close, and cleans old orphan folders
on a subsequent run. Allow only one active review per application; a second run
receives a conflict. Bound each image to 1 MiB and retained evidence to 40 MiB.
Report/media access validates ownership and all fences.

The first release accepts two explicit distinct flat visual clips in the same
saved Composition: one target and one reference. Reject diptych, partial-alpha,
360, unsupported/offline/rejected sources for this analysis path; ordinary manual
grading still supports valid partial-alpha photos/diptychs. Restrict review to
sources at most 512 MiB each and dimensions at most 8192×8192. Report a localized
limit error instead of falling back to a proxy or remote service. Media stays
local. A reviewer can compare locked media, but Apply still obeys all edit locks.

Resolve source trim/speed with `resolveClipSourceRange`; select video source times
at 20%, 50%, 80% of that effective range (deduplicate frame-clamped times), and a
single time for still images. Capture both sources with `withVerifiedSourceFile`
into private bounded work roots; compare recorded catalog hashes when present.
Probe the captured files, rather than trusting only catalog dimensions/type.
Run the existing input policy, tone-map chain and primary adapter with fixed
argv, one FFmpeg thread, cancellation, stripped metadata, bounded stdout and a
60-second per-sample timeout. Decode at
most three RGB samples per clip, with each comparison image no larger than
320×320 and at most 4096 regularly spaced analysis pixels per frame. Never
include titles, Film Looks, black letterbox padding or other clips in statistics.

`PrimaryColorReviewReport` version 1 contains opaque report/project/composition/
target/reference IDs, base revision, settings/context digest, full source SHA-256s,
catalog color metadata, exact source sample times, algorithm version,
`currentCorrection`, optional `suggestedCorrection`, reference/before/after
statistics, private image content hashes, warnings and `canApply`. Return media
tokens/variant IDs, never caller-selected filesystem paths. Private reports are
not catalog assets, Composition tracks, portable masters or public manifest data.

V1 statistics are explicit: integer luma `floor((54R+183G+19B+128)/256)`, nearest
rank p10/p50/p90, channel means, fraction of pixels with any channel ≤1 or ≥254,
and sampled pixel count. Define score:

```text
abs(target.p50Y-reference.p50Y)/255
+ 0.5*abs(log((target.meanR+1)/(target.meanB+1))
          - log((reference.meanR+1)/(reference.meanB+1)))
+ 0.25*abs(target.p90Y-target.p10Y-reference.p90Y+reference.p10Y)/255
+ 0.25*max(0,target.clippedFraction-reference.clippedFraction)
```

Capture neutral post-tone-map target samples as private temporary input for the
search. Apply candidate recipes to those neutral pixels, not to the already
corrected before image. The neutral buffer is not an additional saved source.
Search a fixed bounded coordinate sequence, beginning with the currently resolved
recipe. First sweep temperature -1..1 step .1, exposure -2..2 step .1, contrast
.5..1.5 step .1; then one local sweep of each control ±.1 step .01 around its
chosen value, clamped to bounds. There are at most 136 sweep evaluations
(21+41+11+21+21+21), plus the initial baseline score. Choose the lower score;
ties within 1e-12 choose the parameter
closest to the current recipe, then the lower numeric value. The current recipe
remains a candidate so a prediction cannot make the objective worse.

Render the proposed target samples through actual FFmpeg primary filters and
measure those decoded after samples; do not label CPU predictions as measured
output. Reference samples include its currently resolved primary setting; target
before includes its current setting; Film Looks remain excluded. Refuse automatic
suggestion when either median is outside 8..247, reference/target p90-p10 is <8,
or either clipped fraction exceeds .2. Set `canApply` only if measured improvement
is both ≥5% of the before score and ≥.005 absolute, with no new clipping increase
above .02. Otherwise show evidence and a localized no-useful-match reason.
This is a deterministic statistical heuristic, with no claim of semantic scene,
skin-tone or lighting equivalence.

The UI requires the user to review reference/before/after, current/proposed
numbers and warnings before **Apply to clip**. Discard and comparing do not save.
The apply command carries the exact suggested recipe and report ID. Inside
`TimelineEditor.edit` serialization, `validateAcceptance` rechecks project,
Composition/base revision, target/reference/recipe/context, saved disk identity,
full current source hashes and private artifact hashes before any history write.
Validate all sources again after the asynchronous checks; reject stale results.
A same-size/same-mtime byte change must fail. Expiry, cancellation, project
switch, failed generation and source/revision change cannot publish actionable
evidence or partially mutate the film.

After explicit Apply, the result is an authored correction, like a manual edit;
each later render binds its own actual source hashes in its manifest. The expired
report does not remain a perpetual claim that replacement media was measured.
Reopen keeps the accepted numbers and requires a fresh run for new Auto Match
evidence. This avoids adding a persistent analysis/acceptance schema without an
explicit user need.

## Preview, output and interchange

Create `PrimaryColorFilter.vue` for shared SVG coefficients and a small source
color filter composition helper so the existing video/photo/source Monitor paths
always execute primary then Film Look. Identity produces no filter. A scoped
filter applies to media elements/groups, never their title/canvas parent. Changes
must not replace a media resource, seek the transport, reset playback intent or
change composition time. Arbitrary shuffled seeks use the same static recipe.

The inspector uses existing design tokens, labels, focus styles, native numeric
controls and status regions. Show Film, Scene and Clip with Inherit/Reset,
effective scope and the encoded-SDR limitation. Keep advanced measurement in a
review panel. Include English, Traditional Chinese, Japanese and pseudo-locale
coverage, CJK text wrapping, 768px/1280px/1920px views and keyboard-only Apply/
Discard/focus recovery. Avoid new colors, gradients or unrelated workspace UI.

Render and output preview share saved correction. Existing output `lookOverride`
affects only Film Look; it must not erase primary correction. No render-only
primary override or CLI flag is added in D5C. A primary edit changes the existing
revision/render snapshot and marks old output review stale.

Extend the private render manifest with `primaryColor` version/domain/formula ID,
coefficient precision, clamp/quantization order and per-clip resolved scope,
authored recipe and coefficients; retain source color/hash/build evidence. Do not
modify or repurpose existing Film Look registry checksums.

JSON preserves authored fields. OTIO preserves authored and resolved primary
metadata and reports manual recreation; it does not claim a native NLE color
effect. Add `primaryColor` to the compatibility feature union/report. FCPXML/EDL
reject active effective correction with an actionable message; explicit identity
is compatible. Validate unknown versions before all export paths.

`createHandoffPlan` has strict Composition/Clip allowlists: extend both. In
preserve-editability mode, report active primary as metadata-only. In
preserve-visual-fidelity mode, include its complete visual interval in existing
opaque precomp ranges. The replacement precomp clip sets explicit identity primary
as well as no Film Look, so inherited film/beat correction is not applied twice.
Leave authored correction in the original metadata; never strip it globally.
Collect remains a project/source copy/derivative owner, not a color bake. Verify
both trimmed-original and offline package outputs preserve the existing primary
recipe. Real Resolve import/relink/playback/color stays a manual workstation gate.

## Threat and compatibility acceptance

| Boundary/input                       | Required outcome                                                                                                                                                |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Untrusted recipe/command/report JSON | Strict field/version/finite/bounds validation; detached values; no supplied matrix, expression, JS, HTML, URL or code path.                                     |
| Imported media/path                  | Catalog ID lookup only; existing local/self-contained input policy; bounded immutable no-follow snapshots for measurement; no request path or source overwrite. |
| Lock/pin/inheritance                 | Atomic rejection of effective changes to locked clips/sources; paired-photo coverage; selection pins and all timing retained.                                   |
| Async revision/source change         | Saved/in-memory/project/source/color-context fences at publication, image read and Apply; full hashes catch same-size/mtime mutation.                           |
| Cancel/timeout/disk/save failure     | No partial project/history or public review; owned private cleanup; save rollback and actionable retry.                                                         |
| Legacy/unknown versions              | Absent correction is byte-identical identity; schema/catalog/Compose unchanged; unknown version fails before source I/O.                                        |
| HDR/alpha/display                    | Existing HDR metadata failures retained; no double tone-map; alpha preserved; unsupported measurement disclosed; calibrated display remains manual.             |
| Export/baked media                   | Metadata/manual or explicit baked report; active unsupported interchange fails; no repeated correction of precomps.                                             |

## Required evidence and approval calls

Implementation must add actual synthetic SDR and PQ/HLG HDR chart MP4s with
gray/color patches and temporal markers. Decode real output first/middle/last and
shuffled seek positions; verify primary → Film Look order, boundary/clipping,
neutral exact output, source hashes, frame count, duration and unchanged audio.
Use lossless/direct RGB tests to pin the affine equation, then establish explicit
measured tolerances for H.264/proxy/browser screenshots rather than assuming the
PNG Film Look tolerance applies. Record unsupported/missing HDR metadata failure.

Add meaningful core/solver, application save/history/retry/reopen, HTTP trust,
Monitor ownership/seek/compare, UI/i18n/accessibility and interchange/precomp tests.
Actual Auto Match after statistics must come from decoded candidate pixels and
improve the declared metric; source/cancel/stale tests assert no project changes.
The integrating PR runs complete serial repository gates and exact-head CI under
coordinator scheduling. This docs-only phase runs no media suite/browser server.

Coordinator approval is requested for these concrete builder calls:

1. Encoded-SDR affine v1 formula/bounds/12-decimal coefficients and generated
   FFmpeg LUT, with documented non-calibrated semantics.
2. Existing film/beat/clip scope only, identity override, no global asset setting;
   existing selection-pin semantics and strict lock protection.
3. Bounded statistical Auto Match with actual before/after evidence, clip-only
   explicit Apply and transient proposals that expire on reopen.
4. Source-preparation → primary → shared Film Look order, look-only comparison
   wording, and metadata/bake/reject interchange rules.

The calibrated display, physical camera appearance, real NLE application, native
platform presentation and sustained 4K performance gates remain manual. They
cannot be declared passing from generated chart or parser evidence.
