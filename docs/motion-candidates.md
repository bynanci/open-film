# M8B — reviewable local motion candidates

M8B extends the existing ProviderRegistry and Composition editing path. It does
not turn M6 tone/TTS into image-to-video. No remote motion adapter is enabled,
no browser setting uploads a photo, and no new project schema or timeline exists.

## Workflow

Select one unlocked 2–6 second PNG/JPEG photo clip, at 1x with source-in zero.
The Inspector offers two explicit local jobs:

- **Local camera fixture (not AI)** makes two candidates (CLI/API: two or three)
  from the original using a deterministic bounded camera move. Cost is zero.
- **Imported external video** admits one to three explicitly selected Library
  videos. Import them through the existing local importer first. The relationship
  to the photo, external generation cost, rights and provenance are user declared;
  OpenFilm does not infer that a video was generated from that photo.

Enter intent and constraints, acknowledge the local job, and preview. Original
photo and existing M8A frames can be compared with each candidate's video controls.
Only a matching single-image PhotoDepth scene can accompany replacement. If an
existing scene displays the same photo over this clip, explicitly link that scene;
other overlapping photo scenes are refused instead of leaving a misleading still
covering the adopted video. Unconfigured M8A is not synthesized automatically.

Check identity, expression, pose, contact relationships, details, edges and color
manually, then **Accept** and separately **Replace selected photo clip**. Accepted
video stays in the existing managed sources/catalog. Replacement uses existing
`graphic.scene.remove` and `replace` commands, preserving clip ID, duration,
narration and the rest of Composition. Explicit Restore uses `replace`,
`presentation` and optional scene/template upsert. Later edits cause a restore
conflict; use Undo/Redo or Named Versions to choose the intended history.

Human fidelity is never guaranteed. Prefer clouds, water and tree shadows without
people. The default subject warning is conservative. No face swap, cloned voice,
identity or pose generation feature is included.

## Receipt and ownership

`MotionGenerationReceipt` v1 binds a UUID candidate and request to project,
Composition, clip, optional scene, original asset and SHA-256, base revision,
prompt/negative SHA-256, provider/model, origin, declared relation, cost status,
consent time, manual review, output SHA-256 and measured video proof. Plain prompt
and negative text are not persisted. Imported asset metadata stores the immutable
acceptance provenance; the private receipt journal holds current lifecycle state.

Preview/accepted MP4s live under project-private `cache/motion-candidates`; receipt
and request journals use separate private folders. Folders use 0700 and files
0600 on POSIX. Completed previews survive normal close so CLI review can span
processes. They expire after 24 hours: access denies expiry immediately; project
open, preview creation and expired-media access physically sweep expired
unadopted files. Explicit revoke/Discard removes them earlier. No background
process runs while OpenFilm is closed. At most 24 live candidate folders are
admitted. Adopted media and prepared recovery journals are retained for history.

UUID request claims precede provider invocation. Same request/fingerprint shares
work or returns the same ready candidates; changed, cancelled, interrupted or
revoked requests require a new UUID. Abort/timeout races consume ignored late
results without publishing. Project generation, saved revision, settings,
original/external hashes and local URI identities are fenced before publishing,
Accept and replacement. Project switch/close aborts owned work. Unchecking consent
revokes current Inspector candidates. Import/Restore recover a committed edit
whose acknowledgment was lost, including after reopen; prepared import can resume
only at its exact saved revision with freshly revalidated source/target/commands.

## Media limits and adapters

Original: bounded regular local PNG/JPEG, at most 16 MiB/4096 pixels per dimension/
16 megapixels. Candidate: actual self-contained MP4 bytes, at most 64 MiB, one
video and optional audio, no other streams, at most 10 seconds/60 fps/1920 pixels
per dimension/1080p area. SDR 8-bit pixel formats are admitted; HDR is refused.
Project output is even-dimensioned, at most 1080p area and 60 fps. Source duration
must cover the target frame-aligned interval. FFmpeg uses fixed demuxers and a
file-only protocol allowlist, allocation/process deadlines and decoder threads.
Candidates are normalized to project dimensions/FPS, H264/yuv420p, fixed frame
count and **no audio**, then fully decoded/probed. Color appearance remains a
manual gate; unknown SDR color metadata is disclosed in proof.

The motion provider port accepts bounded image/video bytes and returns bytes,
model and mock identity; it never imports URLs or executes project code. Registry
consent checks cover text/images/video on every remote invocation, but the
application rejects all remote motion descriptors even with consent. A future
trusted remote adapter needs separate official API, redirects/download, license,
retention, data destination, cost/key handling and explicit per-job consent review.

## Shared entry points

CLI: `openfilm motion providers|preview|receipt|accept|import|restore|revoke|clear`.
Preview requires project/composition/clip, stable `--request-id`,
`--motion-consent`, `--motion-prompt`, `--motion-negative`; optional
`--motion-provider local-motion-import --motion-candidates id,id`,
`--motion-count 3`, `--motion-scene id`. Human-detail warning is the default;
`--environment-only` explicitly declares otherwise. Accept requires `--reviewed`.
Receipt/Accept/Import/Restore/Revoke use `--id`; clear discards unimported previews.

HTTP uses `/api/compositions/:id/motion-generation`,
`/api/motion-generation/providers`, `/:candidateId/receipt|media|accept|import|restore`,
`/requests/:requestId/revoke` and `/clear`. Every state/media action is scoped to
project ID. CLI, HTTP and Desktop call the same application service. Desktop
holds the existing navigation/history barrier while replacement is pending.

See [validation](validation-motion-candidates.md) and
[threat model](security/motion-candidates-threat-model.md).
