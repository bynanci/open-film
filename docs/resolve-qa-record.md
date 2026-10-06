# DaVinci Resolve application QA record

**Status: BLOCKED — actual Resolve application QA has not run.**

## Application preflight — 2026-10-06

The requested real-application check inspected candidate
`713a8e4bb10a4f4dd926496d9999fe59d3ee4481` on
`codex/global-product-i18n` ([PR #2](https://github.com/bynanci/open-film/pull/2)).
Remote `main` remained `10caced98a22b79116f2ec63a965ed9e25c9b272`.

| Requirement                               | Observed environment                                                                                       | Result                                                     |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Operating system                          | Debian GNU/Linux 13.6, x86_64 container                                                                    | Recorded; no Resolve OS/version pairing tested             |
| Resolve executable and scripting module   | No `resolve` on PATH, standard Resolve installation directories absent, no `DaVinciResolveScript.py` found | Blocked: application unavailable                           |
| GPU device access                         | `/dev/dri`, `/dev/nvidia0`, `/dev/nvidiactl` and `/dev/kfd` absent                                         | Blocked: no GPU exposed to this environment                |
| Graphical session                         | No DISPLAY/Wayland session, X11 socket directory or running desktop display server                         | Blocked: no application desktop available                  |
| Actual import, playback and saved project | No Resolve process was launched                                                                            | Not run; no screenshots or `.drp`/`.dra` evidence produced |

Installing a parser or rerunning an exporter cannot complete these application
checks. A Resolve-capable workstation with a working GPU/desktop and access for
testing is required. Keep every real-NLE feature unverified until observations
are collected there. The candidate SHA above identifies the prepared source,
not a successful Resolve import.

## Prepared workstation handoff

The retained bundle for the implementation SHA above is
`/tmp/openfilm-resolve-qa-713a8e4.tar.gz` (138,067 bytes). Its SHA-256 is
`96cfa8f84a5b46058ffb258bc3d587a9aa1f8fab3fd201b7a65f96ac4c974d0d`.
The archive contains generated CC0 media, three OTIO fixtures and compatibility
reports, a source/timeline manifest, round-trip documents, the manual procedure,
`run-context.json` and 19 verified file checksums. This path is a local retained
artifact, not a durable repository download or a Resolve project.

Official OpenTimelineIO 0.18.1 read/write/read and the four source files' hashes
and source bounds passed; a temporarily missing source was rejected as expected.
Each fixture has four tracks, six clips and a 12-second timeline. `cuts.otio` and
`edited.otio` use 24 fps; `fractional.otio` uses 30000/1001. Advanced effects in
`edited.otio` remain metadata only and require manual recreation.

The implementation matches the recorded SHA. The handoff context separately
records the five documentation-only working-tree changes made during preflight.
The archive's absolute source URLs reference its original generated directory;
moving it to a workstation requires relinking the `media files` folder. Actual
Resolve relinking, timing, playback and save/reopen results are still unrecorded.

To regenerate a retained bundle after installing the documented local dependencies:

```sh
OPENFILM_OTIO_PYTHON=/path/to/otio-venv/bin/python pnpm test:interchange --output /path/to/empty/resolve-reference
```

Obtain the Resolve workstation's OS, version/edition and test access before
attempting the application procedure. Record observations and save the native
project there; do not mark this handoff as completed application QA.

## Existing parser evidence

The Global Product Experience preflight examined PR #1 and accessible repository
and workspace evidence at candidate
`239436cf672be287dbaec4dd9771165609d1d061`. The retained
`/tmp/openfilm-resolve-p4-final` bundle is generated CC0 media plus official
OpenTimelineIO parser validation. Its manifest reports `realResolveVerified=false`.
No actual Resolve application import evidence was found. Do not substitute parser
success or file existence for the following checks.

| Required evidence                               | Recorded result                                                                                  |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Resolve version / edition                       | Not recorded; application QA not run                                                             |
| Operating system / version                      | Not recorded; Linux parser tests do not establish Resolve behavior                               |
| OpenFilm exact SHA used for actual import       | Not recorded                                                                                     |
| OTIO fixture and source manifest                | Generated `cuts.otio`, `edited.otio`, `fractional.otio` are available; not imported into Resolve |
| Project frame rate                              | 24 and 30000/1001 parser fixtures; actual Resolve project not created                            |
| Import method                                   | Not exercised                                                                                    |
| Source references / media relinking             | Parser/source-file checks pass; Resolve relinking unverified                                     |
| Video cuts / source trims                       | Parser-validated; real NLE unverified                                                            |
| Still duration                                  | Parser-validated; real NLE unverified                                                            |
| Gaps / record offsets                           | Parser-validated; real NLE unverified                                                            |
| Multiple tracks / layering                      | Parser-validated; real NLE unverified                                                            |
| Audio tracks / routing                          | Parser-validated; real NLE unverified                                                            |
| Fractional frame rate                           | Parser-validated; Resolve rounding unverified                                                    |
| Save / close / reopen                           | Not exercised in Resolve                                                                         |
| Speed, gain/mute, transforms, crossfade, titles | Metadata only; manual recreation required; no native-effect claim                                |
| Within-track overlapping clips                  | Unsupported by the current OTIO exporter                                                         |

When actual application QA is performed, replace individual unverified results
with measured observations and attach the Resolve version, OS, exact source SHA,
fixture manifest, screenshots and saved project. Keep unsupported or manually
recreated features separate from verified native interchange. Then update
`nle-compatibility.md`, `validation-real-editing.md`, `TASKS.md` and `ROADMAP.md`
together. Follow the [manual import procedure](nle-compatibility.md#manual-resolve-import-procedure).
