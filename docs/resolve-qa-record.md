# DaVinci Resolve application QA record

**Status: NOT RUN — manual verification required.**

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
| Project frame rate                              | 30 and 30000/1001 parser fixtures; actual Resolve project not created                            |
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
