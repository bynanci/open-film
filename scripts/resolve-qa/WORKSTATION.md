# Test OpenFilm in your installed DaVinci Resolve

This bundle contains generated CC0 sources, not private media. It is a QA reference,
not your film. An actual Resolve workstation is required for application evidence.
No cloud GPU or remote access is needed: download the GitHub Actions artifact,
extract it locally, and keep its whole folder together. `bundle.json` records the
OpenFilm checkout SHA, candidate SHA, dirty files, CI run, and file hashes.

## Prepare on Windows, macOS or Linux

Use 64-bit Python **3.9 or newer**. Preparation and manual recording use only its
standard library; no repository checkout, Node, pnpm, FFmpeg, OTIO package or
internet connection is needed on the receiving workstation.

In PowerShell/Terminal, change into the extracted folder. Windows can use
`py -3` in place of `python3` in every command below.

```sh
python3 resolve_qa.py prepare
```

The printed `output` is a new `prepared-…` folder. It contains relocated OTIO
copies pointing at the extracted `media files` folder, plus a preparation record.
Spaces, Unicode, `#` and `&` are encoded correctly as file URLs. Original OTIO,
manifest, and source bytes remain unchanged. Hash mismatches stop preparation.
Run preparation again if you move the bundle. Never edit a prepared OTIO in place.

For commands below, replace `prepared-…` with that actual folder name. Quote paths
containing spaces. Test `cuts` first; repeat for `fractional` and `edited` separately.

## Manual UI route — including installations without external scripting

This route does **not** require Studio or scripting. The installed Resolve version
must itself offer OTIO timeline import; if it does not, record that limitation.
A paid edition is not a prerequisite for preparing the bundle or recording QA.

```sh
python3 resolve_qa.py manual --prepared "prepared-…" --fixture cuts
```

This creates `manual-…/manual-evidence.json`, initially **not run**. Fill it with
observations, screenshots and the native project path after performing the steps:

1. Save and close your own project. Create a separate local QA project at **24 fps**.
2. Use Resolve's timeline import UI to import **`prepared-…/cuts.otio`**. Record the
   actual menu/import method, Resolve version **and edition**, OS, frame rate, and
   any import warning. If sources are offline, use Resolve's relink UI and choose
   this bundle's **`media files`** folder. Record the result, not just file existence.
3. Compare every clip against `expected` in the evidence JSON: video/audio track
   index, source path/hash, source-in seconds, record start frames, and duration
   frames. Inspect video first/last frames, still holds, all gaps, layers and audio.
   There are two video and two audio tracks, six clips and a 12-second cut fixture.
4. Play the timeline. Check audio routing/levels, missing media and image/color
   interpretation. A linked file hash does not prove successful decoding/playback.
5. Save, close, and reopen this QA project. Repeat timing, source and playback
   checks. Export a `.drp` into the new evidence folder and attach screenshots.
6. Repeat `manual --fixture fractional` in a separate project set to **29.97 fps
   (30000/1001)**. Record exact frame positions and any rounding of deliberately
   fractional positions. Do not silently allow a one-frame error.
7. Repeat for `edited` at 24 fps. Speed, gain/mute, transform, crossfade, titles and
   locks remain **metadata only**, not native imported effects. Read
   `edited.otio.report.json` and `nle-compatibility.md`; recreation is manual.
   Compare unretimed native cuts separately from any effects you recreate.

Set individual observation statuses only after checking them. The template's
`realNleVerified: false` must not be flipped simply because import opens. Send the
completed evidence directory, screenshots and `.drp` back for review. Keep the
bundle so source identity and original export can be reproduced.

If Python is unavailable, the original fixtures can still be imported manually
and relinked to `media files` in Resolve, but source hashes and automatic relocation
have **not** been checked on that workstation. Record that limitation explicitly.

## Optional installed scripting API route

Resolve must already be running. The vendor scripting README is supplied with its
**installed** Developer/Scripting folder; treat that version's README as authoritative.
External scripting is documented for **Resolve Studio**. If your version/edition
has no suitable access, use the manual route above; do not enable nonexistent
settings or install a downloaded substitute module. Where supported, enable
**local** external scripting in Resolve preferences, not network access.

```sh
python3 resolve_qa.py probe
```

Probe prints version, product, OS and installed API module hash when connected.
Unavailable API/application/permissions produce `blocked` and exit code **2**.
For a nonstandard official installation add:

```sh
python3 resolve_qa.py probe --api "/installed/Developer/Scripting"
```

Vendor `RESOLVE_SCRIPT_API` and `RESOLVE_SCRIPT_LIB` environment overrides are
respected. The runner loads only that installed `Modules/DaVinciResolveScript.py`.
Python must be compatible with the installed Resolve build and native library;
a working Python preparation step does not establish API compatibility.

**Save and close your current project yourself; return to Project Manager first.**
The runner refuses to operate when any project is active. It never deletes projects,
changes databases, closes an unsaved project, or quits Resolve.

```sh
python3 resolve_qa.py run --prepared "prepared-…" --fixture cuts
```

This creates a unique local `OpenFilm_QA_…` project. It sets the frame rate and
**attempts** `MediaPool.ImportTimelineFromFile` with the prepared OTIO. The API's
published format list does not explicitly promise OTIO support. If import fails,
`manual-import-required` is recorded and the new QA project stays open for manual
UI import. Another interchange format is never substituted.

When import succeeds, the runner records actual tracks, clip timing, available
source frame values, and linked-file hashes. It saves the new project, attempts a
`.drp` export, closes only that successfully saved project, reopens it, and compares
observations. The reopened QA project stays visible for playback and screenshots.
If the active project changes during execution, it stops without saving or closing
that other project. Do not interact with Resolve during these short scripted steps.

Evidence is written to a new `run-…/evidence.json` even when preflight is blocked.
Statuses distinguish **mismatch**, **unavailable**, **manual-import-required** and
**api-checks-passed-manual-qa-required**. Raw source end/time values are recorded;
audio source timing and ambiguous endpoint conventions still require manual checks.
A reported 29.97 project rate is compared to 30000/1001 within 0.0001 fps; clip
positions/durations use a strict 0.0001-frame tolerance, preserving rounding failures.
Older APIs without source/subframe methods yield unavailable evidence, not success.
Neither a mock nor this bundle's parser run is accepted as Resolve application proof.

## API research and limits

The workstation's installed `Developer/Scripting/README.txt` and official examples
are authoritative. Research used the accessible
[versioned 20.2 API documentation mirror](https://github.com/wheheohu/bmd_doc/tree/4d4831ef1daa3364424522eb6d4a289fbc3b4cd1/ResolveAPI_versioned_docs/version-20.2.0)
of the vendor API description. This is a community mirror, not Blackmagic-hosted
verification. Official Blackmagic pages were not retrievable from the cloud
verification environment. No Resolve application is installed there.

The documented source frame/time accessors and subframe precision argument were
added in **19.0.2**. The runner checks the connected version before using them.
`CreateProject`, `SetSetting`, `ImportTimelineFromFile`, `GetItemListInTrack`,
`GetClipProperty`, `SaveProject`, `ExportProject`, `CloseProject` and `LoadProject`
follow those published signatures. Their real behavior on your installed version
is the point of this QA; it has not been pre-certified by the cloud tests.
