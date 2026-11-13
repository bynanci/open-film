# Saved-version audiovisual comparison

## Intent and scope

A creator has saved two edits and needs to see and hear their differences before
choosing a restore. The current Versions panel provides structural differences;
the Creative Variants dialog has placeholder pictures and state-only audio
buttons. This first delivery adds actual audiovisual comparison to **Named
Versions**. Creative Variants integration and Export audio-tail warnings remain
explicit later tasks. No physical listening, installer or release acceptance is
implied.

The user has asked to continue roadmap implementation and supplied this workflow
as the next product priority. Existing subagent execution, local-first contracts
and the Tobi-ishi design direction remain the approved constraints. The resource
and interaction choices below are engineering choices within that scope.

## Approach

Use the existing immutable named-version loader and source checks, existing
FFmpeg Renderer/RenderSnapshot and existing render Job/controller/lock lifecycle.
Prepare two complete local MP4s only after an explicit action. Play them through
native video elements under one shared transport and one audible-side selection.
Keep structural diff read-only and cheap.

Other approaches considered: binding old Pipeline artifact paths would lack
revision/source authority; restoring the active project to render each side
would change current editing state; a second timeline or audio mixer would
duplicate authority. None is selected.

## Snapshot authority

Add a trusted application-only `ProjectVersionService.snapshotForPreview`:

```ts
snapshotForPreview(
  versionId: string,
  compositionId?: string,
  options?: { signal?: AbortSignal },
): Promise<ProjectVersionPreviewSnapshot>
```

The returned snapshot owns a saved project, selected Composition, saved Catalog
assets, saved source references, version metadata, immutable payload identity
and a synchronous `assertCurrent()` publication guard. Reuse `load`,
`rebaseTarget`, `verifySources` and existing bounded path/integrity checks.
An explicit missing Composition ID must reject; it must not fall back to another
cut. An omitted ID may select the first saved Composition. Metadata access for
the UI exposes composition IDs, story titles, durations and frame rates, never
source paths or the whole project.

Capture exact `compositionSha256`, `settingsSha256` and `assetsSha256` together
with project/catalog hashes and `identity`; the Renderer must consume these
capture-time digests rather than deriving approval after accidental mutation.
Use the existing RenderSnapshot JSON digest convention. The full internal
snapshot is never serialized to an HTTP client.

Preserve sources, source locks/User Pins, saved settings and captions/effects.
Historical rendering must not read current Catalog assets/settings instead.
Metadata rename alone does not change project/catalog payload identity. Deleted,
corrupt, cross-project or changed payloads must reject. Source verification must
support cancellation without converting AbortError into a missing-media result.

## Preview service and HTTP

Use `VersionComparisonPreviewService` and application entry
`runVersionComparisonPreview(input, signal)` with this public request:

```ts
interface VersionComparisonPreviewInput {
  projectId: string;
  requestId: string;
  a: { versionId: string; compositionId?: string };
  b: { versionId: string; compositionId?: string };
}
```

Public descriptors contain a versioned opaque pair ID, project ID, expiry,
per-side version name/ID, project/catalog/Composition/settings identity,
Composition and delivered video durations, saved frame rate, actual audio-track
availability and warnings. Filesystem paths and source URIs are internal only.

- `POST /api/version-comparisons/prepare`: explicit preparation; await the owned
  task like Record audio preview. Use the existing active/tasks registration,
  abort-on-disconnect and request mutation queue release/reacquisition pattern.
- `GET /api/versions/:versionId/preview-targets`: small validated saved-target
  metadata for composition selection.
- `GET /api/version-comparisons/:id`: ready descriptor/reconnect; require the
  current `projectId` and exact owned pair.
- `GET /api/version-comparisons/:id/media/:side`: guarded range streaming of an
  owned ready MP4, using the existing server media-stream lifecycle.
- `DELETE /api/version-comparisons/:id`: explicit discard/revoke; the existing
  Job cancel route handles a pending request whose Job ID is its requestId.

Reuse render Jobs; no new durable Job engine or project schema. Request identity
must not overwrite another existing Job. Repeated ready requests with the same
requestId and exact inputs may reuse the same verified pair; conflicting reuse
rejects. Expired/interrupted results require explicit retry with a new requestId,
not silent recomputation. Two simultaneous preparations cannot take each other's
ownership. A fixed project/source generation gates every publication and serve.

Bind render Jobs with the existing `reviewOwner` field and a distinguishing
`stage` for comparison. The generic open-time recovery must not mark another
live or unverifiable comparison owner failed. Use the existing owner probe and
transactional Catalog write boundary for owner-checked updates; recover dead
owners conservatively. This extends existing ownership, not a second engine.

Render sequentially with the existing full mix, saved geometry/frame rate,
saved styles and font resolver using the **saved frame**. Do not weaken current
RecordAudioPreview revision guards. Preserve the established one-hour duration,
1 GiB per-file and 2 GiB private-cache bounds from Record preview as upper bounds
for this initial local comparison, plus a 15-minute ready lifetime and one owned
pair per service. Enforce cross-process locking with the existing owner-aware
export-request lock; never delete another live/unverifiable owner's cache.
Do not silently truncate/crop to fit a bound. Fail with a recoverable message.

Publication is atomic for the pair: if B fails, A is not advertised as ready.
Abort/drain FFmpeg children before owned work cleanup and Catalog close. Check
private cache paths, regular-file identity, output size/hash and source/payload
proof. Project close/switch, discard, expiry or deleted versions revoke access.
Restart may expire this ephemeral preview; named snapshots remain durable.

## Interaction and design

Extend existing Versions selectors and diff. Each side can select a saved
Composition; the same version may compare two different Compositions. Identical
targets are not a meaningful pair and should not start duplicate work.

The creator sees saved names/lengths, an explicit prepare action, preparing and
cancel states, then two real players and one transport. Prepare never plays
automatically. Audio A/B/mute is mutually exclusive and changes native media
muting. Scrubbing uses common absolute seconds and each side's actual duration;
the longer side can continue after the shorter ends, with a visible ended state
and silence for that side. Unequal frame rates are not advertised as equal frame
indices. Rendering or comparison never invokes Restore/Adopt.

Close, target selection, unmount and project switch pause/unload both videos,
abort the owned request, revoke the owned session and fence late events/results.
Missing/changed media shows relink/reconnect guidance and explicit retry while
the structural diff remains usable. No fabricated playable placeholder remains
in this new Versions workflow.

Use current tokens and system typography. Intent: a creator comparing cuts in
the middle of an edit; the experience should be a restrained viewing desk.
Domain: saved cut, shared timecode, frame, audible side, source identity, restore.
Color world: existing warm paper, stone surface, ink, muted jade action and amber
warning tokens. Signature: two saved cuts under one timecode and one audible-side
control. Use this instead of independent competing transports, decorative status
colors or a new card-dashboard/navigation system.

Support 1024×768 and 1920×1080 with min-width:0, bounded video surfaces, wrapped
controls and available scroll. Provide English, Traditional Chinese and Japanese
messages, visible focus, labelled controls, keyboard play/seek/audio where focus
permits, IME protection and reduced motion. Preserve existing save/restore focus.

## Acceptance and limits

Use synthetic distinct pictures and known audio tones/gains. Actual FFmpeg MP4
decode must demonstrate each side's saved appearance/audio/settings, first/
middle/end frames, source hashes and actual durations. Verify active project
manifest, semantic Catalog state and editor/history remain unchanged; existing
local-operational render Job rows are allowed and must not be called byte-equal
Catalog preservation.

Application/HTTP/browser tests cover source or version corruption, missing media,
wrong project/token, output tamper/range errors, same requestId conflicts,
sequential failure, cancel/drain, cache bounds/ownership, selection races,
reconnect/expiry, real native playback/seek/audio routing and close/switch cleanup.
No mock-only test is counted as actual audiovisual output. Native playback tests
do not certify physical listening quality, A/V device latency or the known
frame-aligned excluded audio tail. Keep those independent gates open.

Create one dedicated PR with review, screenshots, actual tests and exact
base/head evidence. PR #129, signing, native publication and Release remain
outside this change.
