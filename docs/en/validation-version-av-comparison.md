# Named-version A/V comparison validation

Date: 2026-11-13. Candidate base: `befe2e5b86db17c643cfc4d7bdc93bd40fee1f1a`
(`main` at implementation start). This change adds an explicit, read-only
picture-and-sound preview for two saved Named Versions. It does not restore,
adopt, or edit the current Composition, and it does not replace Creative
Variants' comparison workflow.

## Data flow and safety

The existing Named Version service loads and verifies each immutable saved
project/catalog snapshot, its selected Composition, asset records, source
hashes, render settings and font settings. The existing FFmpeg Renderer renders
the two saved cuts sequentially. A single owned render Job records progress and
the existing export-request lock fences competing processes. Only after both
outputs pass stream-shape, frame-count, source-manifest, file-identity and
SHA-256 checks is the pair published to the existing project-private cache.
HTTP exposes an opaque pair ID and guarded MP4 byte ranges; it never returns
filesystem paths or source URIs. Exact request IDs are validated before a Job
is reserved. Cancellation returns after the owned render and cleanup drain.

The Desktop Versions panel holds only version/composition IDs, the opaque
descriptor and shared playback state. One time control seeks both native video
elements; only the selected side can be audible. Navigating away, switching the
project or closing the panel pauses, unloads and revokes the owned preview. It
does not copy or mutate Composition/clip arrays. The cache is private,
permission-restricted, limited to one hour per Composition, 1 GiB per MP4,
2 GiB total and 15 minutes; prepared media is ephemeral across server restarts.

## Local verification

Synthetic fixtures use red/blue stills and 440/880 Hz WAV tones. The application
test creates two immutable versions with different dimensions and frame rates,
then decodes frames 0, 5 and 9 from each actual MP4. It checks the expected
color channel thresholds, selected-tone amplitude at least 20 times the
opposite tone, H.264 stream dimensions/rate/frame count, AAC presence and
duration. It verifies source hashes and immutable version payload hashes before
and after rendering, and confirms the active manifest, semantic Catalog state,
Composition and Undo state are unchanged. The HTTP test checks output hashes,
private cache headers, valid/invalid byte ranges, wrong-project rejection,
foreign-owner cancellation rejection, invalid request IDs, and live cancel
draining. No private media or provider is used.

The browser regression loads the real prepared MP4s in Chromium, checks
metadata decode, synchronized playback/seek, audible-side switching, navigation
cleanup and project close/reopen while saved versions remain. It checks for
horizontal overflow at 1024×768 and 1920×1080 and attaches a synthetic UI
screenshot at each size to the Playwright result.

Local toolchain: Node `v24.19.0`, pnpm `11.19.0`, FFmpeg `7.1.5-0+deb13u1`,
Chromium `151.0.7922.173` on Debian 13. Focused Vitest suites passed 66 tests
across four files; the real HTTP integration passed one scenario; the targeted
Playwright file passed two scenarios. The full Vitest run and final static/build
gates are recorded below when completed. Exact-head GitHub checks are pending
until the Draft PR is created.

## Limits and separate gates

- This validates decoded synthetic playback and channel selection. It is not a
  human listening-quality, device-latency, hardware, or production-export
  certification. The preview discloses that frame-aligned output can omit a
  short final audio tail; it does not quantify or audition that tail.
- The known 1,152-sample / approximately 24 ms mixed-export audio-tail case and
  Export workspace warning remain a separate follow-up; see
  [real-media silence validation](validation-silence-real-media.md).
- This covers Named Versions. It does not replace the Creative Variants modal
  or migrate its existing placeholder A/V comparison.
- Restart discards ephemeral preview outputs; durable Named Version snapshots
  remain intact and can be rendered again with a new request ID.
- Windows/macOS installers, signing/notarization, clean-machine update/rollback,
  native workstation checks, Resolve interchange, external media, GPU/4K and
  release-owner approval remain separate gates in
  [release validation](validation-release-gates.md).

## Test record

| Check                                                                    | Result                                                                |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| Focused application/playback Vitest (4 files)                            | Passed, 66 tests                                                      |
| Real HTTP integration                                                    | Passed, 1 scenario                                                    |
| Targeted Playwright `project-versions.spec.ts`                           | Passed, 2 scenarios; screenshot attachments at 1024×768 and 1920×1080 |
| Full `pnpm test`                                                         | Pending                                                               |
| `pnpm test:contracts`, format, i18n, lint, typecheck, build, interchange | Pending                                                               |
| Exact-head GitHub CI                                                     | Pending Draft PR                                                      |
