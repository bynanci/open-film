# D6A — Managed Proxy Storage

Status: implementation design for the approved D6A roadmap request.
Base: `c9ca4f204bac70aa366482dac9b50cf829e2ac63` (PR #63).

## Outcome and existing owners

Large projects need explicit, recoverable preview preparation and intelligible
storage use. `createProxy` already produces local 640×360 H.264/AAC or 192 kbps
MP3 previews, including the existing color/input policy. This work manages that
generator rather than changing its recipe or the Composition. The final renderer
continues to resolve original sources; previews are never advertised as masters.

The builder's bounded defaults are one worker, at most 128 queued/running tasks,
and a 5 GiB managed-proxy quota. A project may explicitly choose 1 MiB–1 TiB.
These are implementation choices, not measured workstation performance claims.

## Approaches

1. Extend the current import loop only: small change, but unrelated imports would
   remain the only repair action and interrupted work would lack its own queue.
2. **Selected: a project-local application service over existing jobs and media
   generation.** Queue receipts use the existing non-portable jobs table. Ready-artifact
   provenance, policy and owned work files stay inside the private cache, so a
   Named Version restore cannot erase or rewind current artifact ownership.
   No project or catalog schema bump is needed.
3. A second general scheduler/database: could coordinate many future workloads,
   but would duplicate existing job ownership and expand this milestone.

## Contract and state flow

- Core exports closed version-1 proxy policy, task receipt and health contracts.
  Unknown versions/fields, nonfinite quotas, unsafe IDs/paths and duplicate or
  excessive requested IDs fail closed.
- A `proxy` Job adds `proxyCache` with asset ID, full source hash, an input
  fingerprint (URI and decode-relevant metadata), recipe version, generation,
  request identity, owner and optional output hash/size/relative URI. This field
  is operational; existing portable catalogs already omit all jobs.
- Enqueue is explicit and idempotent for the exact project/request/body. Atomic
  catalog checks enforce the active bound and deduplicate equivalent active work.
- Run claims the queue under one project-private exclusive lease. Running work
  retains the existing verifiable process owner. Alive/unknown owners are never
  reclaimed by a status reader. Dead work becomes failed and explicitly resumable.
  Reopen does not start FFmpeg. Resume/retry creates a new owned generation.
- Unknown/foreign lease owners remain blocked. Explicit recovery requires the
  exact observed lease fingerprint and confirmation that the old worker has
  stopped; known-live owners are rejected. Serialize recovery, replace only the
  same observed lock, fence the previous generation from publication and retain
  its work files while liveness is unknown. This escape hatch is not automatic
  macOS/reboot recovery.
- Cancel signals the current child promptly and cancels queued work when requested.
  A retry reuses completed valid files and restarts an interrupted encode; this
  is queue resumption, not an unsupported partial-MP4 continuation claim.
- The service participates in `hasActiveJobs` and owned server shutdown. HTTP
  starts work in a registered background task and returns a receipt immediately;
  cancellation must not queue behind the worker. Project replacement remains
  blocked until cancellation/settlement.

## Source, output and publication safety

- Inputs are imported local assets, never request-supplied paths or URLs. Only
  supported video/audio sources with a full SHA-256 may be queued. All 360-video assets
  remain governed by the existing unsupported-preview diagnostic.
- A streamed private regular-file snapshot is hashed against the queued source
  before FFmpeg reads it. Reuse the existing representative-frame verification
  boundary through a small media helper. Memory stays bounded; one whole-source
  temporary disk copy is a deliberate integrity cost. Check free space, reject
  unsafe links and clean owned work on failure/cancel.
- After encoding, rehash the actual original bytes asynchronously, then
  synchronously recheck its file identity, source URI/decode fingerprint, task
  owner/generation, lease identity and abort state at publication. Another application's changed source/catalog cannot
  receive a result from obsolete bytes. Output is probed for expected stream,
  bounded dimensions and source-duration tolerance; record its complete hash.
- Work and ready output live below owned cache directories. Use exclusive files
  and no-replace publication; do not overwrite an existing file or original.
  Keep the previous valid proxy until replacement succeeds. Only the current
  preferred-artifact index is published inside `withProjectWrite`. Rebuild leaves
  the complete existing MediaAsset identical, including a locked source's canonical
  Named Version identity. Trusted initial import may set its ordinary proxy URI
  as part of its existing source-index mutation. Preserve source locks, creative
  parameters, autosave and edit history.
- New imports use the same managed worker and quota, while retaining synchronous
  import completion and the explicit `proxies: false` option. Concurrent import
  candidates wait through the service FIFO. An inspected asset may be passed by
  the trusted importer before catalog publication; an interrupted unindexed
  source is never fabricated on reopen. Existing legacy proxies remain readable.
- Durable ready-artifact sidecars survive Named Version restoration of jobs.
  They bind project, asset, source/decode fingerprint, recipe, task/generation,
  output hash/size and relative name. Publish media and sidecar exclusively
  before updating the catalog. A crash leaves a known orphan or an unverified
  file; missing provenance never authorizes deletion. Restore can reattach only
  a currently matching verified artifact.
- New receipts contain only opaque IDs, hashes, numbers, recipe and relative
  cache names. They do not expose source paths or credentials through health UI.

## Quota, eviction and health

- The configurable quota applies to the service's managed preview files, with
  legacy/unmanaged proxy bytes disclosed separately. A bounded inventory rejects
  symlinks and reports incomplete inventories rather than inventing totals.
- Only provenance-owned ready/obsolete files may be removed. Protect locked and
  Composition-referenced assets, in-use entries, offline/unverifiable originals,
  source files and files owned by alive/unknown workers. Prefer least recently
  used eligible entries; explicit cleanup previews the affected IDs/bytes.
- An encode receives a remaining-byte bound; oversized/truncated output cannot
  become ready. Recheck quota/ownership immediately before publication. A full
  protected cache yields a typed quota result and explicit cleanup/retry actions.
- Health distinguishes queued, running, ready, missing, stale, failed, cancelled
  and legacy/unverified caches. Recorded validation and a fresh full-byte check
  are distinct. Missing/corrupt caches offer Rebuild without reimporting media.
- Cleanup acceptance binds receipt digest, output hash, file identity, policy
  revision and current Composition/lock protection fingerprint. Rehash candidate
  bytes and original availability before synchronous identity checks/deletion;
  same-size replacement or changed protection invalidates the preview.
- Managed `/api/source` streaming validates receipt version, takes an in-use
  guard and records throttled LRU use; legacy URI handling remains compatible.
- Health reads and cached UI polling never hash every original or start work.
  A fresh verification and cleanup are explicit operations. Legacy URIs remain
  readable through existing relocation handling and are not silently deleted.

## UI and shared application boundary

Add a progressively disclosed Preview storage section to the existing Library.
Show usage/quota, queue state and per-source reason with labelled build, cancel,
resume, verify and review-cleanup actions. General mode uses plain language;
Expert may disclose hash/recipe/attempt detail. Follow existing Quiet Studio
tokens, three locales, keyboard focus, status announcements, CJK wrapping and
44 px coarse-pointer targets. Fence all requests by project and generation.

Desktop, HTTP and a bounded CLI `proxy` command call this same service. Cache
operations never produce timeline history entries or change output source choice.

## Threat and compatibility boundaries

Project metadata and HTTP bodies are untrusted data. No HTML/JS, shell command,
remote address, executable, cache path or arbitrary file deletion is accepted.
Host/origin/native-session checks precede mutation/cancellation. Invalid private
state fails visibly; permission failures retain recoverable state. A hostile
local process with access to application memory is outside this integrity model.

Private policy/work/lease files are excluded from Named Versions and Collect
Media. No catalog migration or legacy proxy rewrite occurs on read. Unknown
receipt versions cannot authorize cleanup, streaming or publication. D6B trimmed
or offline packages need their own derivative/provenance and baseline-parity
design; D6A does not enable them implicitly.

## Acceptance

Tests must first fail for bounds/idempotency, concurrent owner/status reads,
cancel/reopen/resume, changed sources, stale publication, protected quota and
cleanup path attacks. Application tests use a real synthetic MP4/audio source,
decode the proxy, compare duration/representative content, verify full source and
output hashes, and render the original Composition before/after proxy deletion.
Browser tests cover actual API work, explicit cleanup, project-switch fencing,
keyboard/narrow CJK layout and rebuild after a missing preview. Run the existing
full gates; physical Windows/macOS/browser and large-drive performance remain
candidate-bound workstation gates.
