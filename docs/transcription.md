# Local transcription

Transcription creates a read-only, timed view of an original recording. Selecting
a segment or word seeks the source preview. It does not change the cut or create
subtitles. Subtitle text editing, proofreading, translation, burn-in and subtitle
export are outside the 0.3 P0 foundation.

## Optional setup

Install a supported local Python and `faster-whisper==1.2.1` in a dedicated
environment if you want speech recognition. FFmpeg must already be available
for audio extraction. Obtain a compatible faster-whisper model separately and
retain its full supplied directory, including nonempty `model.bin`,
`config.json` and `tokenizer.json`, plus the other model files supplied by its
publisher. Review that model's terms before use or redistribution.

Configure the OpenFilm server environment:

```sh
OPENFILM_WHISPER_PYTHON=/absolute/path/to/venv/bin/python
OPENFILM_WHISPER_MODEL=/absolute/path/to/local/faster-whisper-model
```

`OPENFILM_WHISPER_PYTHON` defaults to `python3` (`python` on Windows); an explicit
path avoids ambiguity between Python installations. The model path must name
an existing local directory, not a downloadable model ID. Restart the server
after changing startup configuration, then refresh availability in Precision
mode. Normal importing and editing remain available without this setup.

OpenFilm does not install runtimes or download model weights automatically.
The runner loads with `local_files_only=True` and disables Hugging Face/
Transformers network model lookup and telemetry. Availability checks establish
that configuration and runtime imports are present; they do not establish
recognition quality or successful GPU inference.

## Processing and language

Choose transcript language independently of the interface and film-content
languages: automatic detection, Chinese, English or Japanese. Changing the
interface language does not rerun or translate a saved transcript. P0 keeps
provider text and word timing; it does not automatically convert Chinese script
or apply a dictionary.

Precision offers only the choices advertised by the active provider within
OpenFilm's supported language options. A provider limited to English starts with
English rather than automatic detection; a valid user choice survives an
availability refresh. Providers without language capability metadata retain the
default choices for compatibility. An explicit empty or unsupported language
list disables transcription rather than submitting a request it cannot satisfy.
The interface and film-content languages remain independent of this selection.

| Requested device | Behavior                                                                                                                    |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------- |
| CPU              | Use CPU int8; do not attempt GPU.                                                                                           |
| Automatic        | Attempt CUDA float16 when available, then retry the whole source on CPU int8 after GPU initialization or inference failure. |
| GPU              | Attempt CUDA float16, with the same disclosed CPU fallback if GPU processing fails.                                         |

The job records actual execution, model, language and fallback reason. Selecting
GPU is a request, not proof of GPU availability or acceleration. A GPU fallback
must not be presented as GPU success.

The local adapter extracts an owned mono 16 kHz WAV, runs the configured
provider process and validates its timed output. Job stages expose source
checking, audio preparation, model loading, transcription, timestamp checking
and persistence. Words and segments use original source seconds. Invalid
output, a missing audio track, unavailable runtime/model, cancellation and source
changes do not become a completed transcript. Technical errors remain separate
from translated user guidance.

## Persistence and navigation

Cancellation ends the application Job without waiting for an unresponsive
provider to finish. Its later progress, result, or failure is ignored, so the
project can close, reopen, and retry while keeping the prior saved transcript.
A successful retry replaces the transcript only after the existing output and
source checks pass. Story, composition, source files, and word timing from saved
revisions remain unchanged by cancellation.

Providers still receive the same AbortSignal and should stop their own work.
The bundled Whisper adapter cancels its owned child process; releasing the
application's wait does not forcibly terminate arbitrary third-party execution.
This contract is shared by Desktop, HTTP, and headless application callers,
without a second Job system or a catalog migration.

Transcripts are stored in indexed catalog rows with source/model/provider
provenance. The UI loads 100 segments at a time, with explicit previous/next page
controls. Speech snapping uses the loaded page only; source markers and clip
edges remain available independently. A missing or changed original may prevent
analysis access until the source is restored. Reopening the project reuses valid
committed results without automatically running speech recognition again.

## Test evidence is distinct from speech recognition

`OPENFILM_WHISPER_RUNNER` is a diagnostic/test override, not a model selector in
the product UI. `tests/fixtures/whisper-protocol.py` and its explicitly labeled
fixture model directory exercise the real process protocol, extracted audio,
jobs, timed output validation, persistence and browser navigation without
optional model dependencies. Fixture metadata identifies
`fixture-protocol-not-asr`; predetermined text must never be described as
recognized speech.

Generated speech/video in browser fixtures is public procedural test material,
not a speech-quality benchmark. An actual local CPU Whisper run requires a real
engine and model and must be documented with its separate result. GPU behavior
requires compatible hardware and an actual run. Neither a fixture nor CPU
success establishes GPU performance.
