# Run Resolve QA on a workstation

The cloud runner has no Resolve installation, exposed GPU or graphical desktop.
Use it to prepare the test, then perform the application check on a computer that
can run Resolve. Installing OpenTimelineIO or adding a virtual display does not
replace that application check.

## Get the reference bundle

Open a successful [Verify run](https://github.com/bynanci/open-film/actions/workflows/ci.yml)
for the candidate being tested. Download its `resolve-qa-reference-<checkout SHA>`
artifact and unzip it on the Resolve computer. `bundle.json` records the actual
OpenFilm checkout SHA, candidate SHA when supplied by CI, dirty files, fixture
inventory and hashes. A pull-request run can use a merge checkout; record both
identities rather than treating its SHA as the PR head.

The bundle contains generated CC0 photos, video and audio, three OTIO fixtures,
parser reports, `WORKSTATION.md` and `resolve_qa.py`. No personal media or Resolve
installation is included. Generating it from a checkout requires the normal
FFmpeg/OTIO dependencies:

```sh
OPENFILM_OTIO_PYTHON=/path/to/otio-venv/bin/python pnpm test:interchange --output /path/to/empty/resolve-reference
```

The recipient does not need Node, pnpm, FFmpeg or OpenTimelineIO. Python 3.9+ is
used only for preparation and the optional scripting path. Resolve must already
run normally with a supported GPU and desktop. No account, remote QA service or
paid workstation is provisioned by this flow.

## Prepare the moved sources

Open a terminal in the unzipped bundle. On Windows:

```powershell
py resolve_qa.py prepare
```

On macOS/Linux:

```sh
python3 resolve_qa.py prepare
```

The command checks fixture and media hashes, creates a new output folder and
prints its path. It rewrites source URLs to this computer's media locations,
including spaces, Unicode, `#` and `&`. Original fixtures and source bytes remain
unchanged. Run preparation again if the entire bundle moves; do not reuse copies
that point to its old location.

Use the printed path below as `<prepared folder>`. To create an honest manual
record with expected timing, without connecting to Resolve:

```sh
python3 resolve_qa.py manual --prepared "<prepared folder>" --fixture cuts
```

On Windows, substitute `py` for `python3`. The output is a **not-run template**;
creating it does not prove that an import happened.

## Import through Resolve's interface

Use this path when scripting is unavailable, including editions without the
documented external API. With no Python installed, use the original fixtures and
manually relink their `media files` folder instead of using prepared copies.

1. Save your existing work. Create a separate QA project in Resolve, set **24 fps**
   and import the prepared `cuts.otio` through **File → Import → Timeline** if this
   version offers OpenTimelineIO. An unavailable OTIO choice is a recorded
   limitation, not a successful check of another format.
2. Relink the supplied media folder if needed. Confirm four tracks, six clips and
   12 seconds against the manifest. Check source trims, photo holds, offsets,
   gaps, layers and both audio tracks. Inspect the first/last video frames and
   actually listen to playback.
3. Use a separate project at **30000/1001** for `fractional.otio`. Record measured
   frame positions and any rounding. Use `edited.otio` separately and its report
   to recreate speed, volume/mute, transforms, crossfade, titles and locks; those
   edits remain metadata-only in the exported cut.
4. Save, close and reopen each project. Retain a `.drp` export and screenshots of
   the timeline and source properties. Record each result individually using the
   [full procedure and expected timings](nle-compatibility.md#manual-resolve-import-procedure).

For your own film, the Desktop Export workspace provides an actual OTIO download
and localized import/relink instructions. Transfer the original media too: an
OTIO file does not contain the photos and video. Keep the OpenFilm project,
compatibility report and MP4 preview as the editing reference.

## Optional installed-API observations

Consult **your installed Resolve Developer/Scripting README** for supported
edition, Python version, module location and scripting settings. External API
availability is version/edition dependent; do not enable network scripting or
download a replacement proprietary module to bypass an unavailable capability.
The runner loads only the locally installed module:

```sh
python3 resolve_qa.py probe
python3 resolve_qa.py probe --api "<installed Developer/Scripting folder>"
python3 resolve_qa.py run --prepared "<prepared folder>" --fixture cuts
```

`probe` returns connection/version information or an explicit blocked result.
Before `run`, save and close any open project yourself and return to Project
Manager. The runner refuses to replace an active project. It creates a uniquely
named QA project, attempts the installed timeline-import API, records observable
timing/source/track data, and saves/reopens only its own project. Repeat separately
with `--fixture fractional` and `--fixture edited`.

An API unable to import OTIO reports **manual-import-required**. A timing mismatch
or missing observation remains recorded instead of being silently accepted.
Successful structural API observations still require the real playback, relink
and manual-effect checks above. The runner never changes the repository capability
model or sets every feature to verified.

## Bring back measured evidence

Keep the bundle manifest, prepared-fixture hashes, API or manual observations,
Resolve version/edition, OS/GPU, project frame rate, import method, relinking
results, screenshots and `.drp`. Note any missing evidence and reproduction steps.

Review that evidence and update [the QA record](resolve-qa-record.md), compatibility
matrix/model, validation record, TASKS and ROADMAP together. Only the capabilities
actually checked in that Resolve version may become real-NLE verified. Parser
tests, unit doubles and a successful API connection cannot establish image, audio,
color or effect fidelity. The cloud's real Resolve result remains **not run**.
