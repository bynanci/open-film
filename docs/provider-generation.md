# M6 / PR 6B: reviewable text-to-speech generation

The first generation purpose is general TTS from explicitly entered text. The
existing ProviderRegistry now supports the `audio-generation` port; every remote
call passes descriptor integrity and scoped text consent. No project media,
transcript, photo, face data or source path is automatically read into a request.

A deterministic local tone mock exercises the entire offline workflow for $0.
It is labeled **not speech** in the UI and provenance. Without a remote provider,
normal editing and this mock remain usable. Configure `OPENFILM_TTS_API_KEY` on
the server to enable the BYOK OpenAI adapter. Its fixed HTTPS destination is
`https://api.openai.com/v1/audio/speech`, using `gpt-4o-mini-tts`, `alloy` and WAV.
The key stays in the server closure/environment, never project files or API
responses. Upstream bodies and network exceptions are replaced by redacted errors.

Provider prices are not hardcoded as timeless facts: the mock costs $0; BYOK
billing is explicitly **unknown**, requires a separate acknowledgement, and is
charged by the provider. Confirm current pricing in the provider account before
use. A paid request may still incur cost after cancellation; local cancellation
only guarantees that a late result cannot import or mutate this project.

## Review lifecycle

1. In Edit → Sound, open Generate audio. Enter 1–1000 characters, choose provider,
   review destination/cost and consent.
2. Generate a bounded private WAV preview. Cancel stops local ownership; retry
   creates a fresh receipt. No timeline or library insertion occurs yet.
3. Audition, inspect prompt/output hashes and explicitly Accept.
4. Choose a start time and Import Timeline. Audio must fit within the existing
   Composition; this does not extend the film or create another timeline.
5. The existing typed `audio.add` command carries a generation receipt ID and is
   validated again inside the editor serialization boundary. Normal autosave,
   requestId reconciliation, Undo/Redo and reopen apply. Undo removes the overlay;
   the accepted managed source and provenance remain available.

Preview and import bind project ID, saved Composition revision and settings.
Changes invalidate receipts. Acceptance itself records review intent in session;
it does not save an edit. Import copies accepted bytes into managed `sources/`
without overwriting originals and records provenance in catalog metadata. Lost
import responses can be retried for the same receipt/start; the timeline edit
uses the existing uncertainty/recovery lifecycle. Unimported preview receipts expire on reopen. Accepted imports also persist a private
receipt outside preview eviction, so pending typed edit drafts can recover after
restart with the same exact revision, command and managed-source hash. Already
imported audio remains portable managed media.

## Threat model and limits

Only trusted registered adapters execute code. Project files cannot provide JS,
HTML, provider endpoints or credentials. The built-in remote adapter rejects
redirects, caps the response at 8 MiB and times out. Decode accepts RIFF/WAVE only,
forces the WAV demuxer and file/pipe protocols, and produces mono 24 kHz PCM.
Duration must be above zero and no more than 30 seconds. Cache directories reject
symlinks, use mode 0700, and retain at most five completed session previews.
Managed destinations reject symlinks and existing unequal bytes. Neither provider
result nor receipt can choose a filesystem path or typed edit.

Generated speech content, pronunciation, consent of any named subjects, music
rights, provider terms and listening quality require human review. The mock and
protocol fixtures do not certify actual remote speech quality, hardware playback,
4K delivery or an external NLE.
