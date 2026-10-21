# NLE interchange status

OpenFilm prepares an OTIO cut layout with source file URLs, source trims, still
holds, audio, gaps and separate tracks. The official OpenTimelineIO 0.18.1 parser
accepts the file and preserves its structure through read/write/read. **DaVinci
Resolve is not installed in the verification environment; actual Resolve import
and playback have not been verified.** Parser success does not establish NLE
compatibility.

The Desktop Resolve card reads the browser-safe capability model in
[`packages/exporters/src/compatibility.ts`](https://github.com/bynanci/open-film/blob/main/packages/exporters/src/compatibility.ts).
Each feature records implementation level, schema/parser validation, real NLE
verification, manual recreation and unsupported state separately. Its real-NLE
evidence list is empty. Export-specific reports additionally list the effects
actually present in that cut; a plain-cut export does not falsely request speed
or transform recreation. Updating real QA requires both evidence and the model,
not a translated UI claim.

The Global Product Experience preflight rechecked repository, PR #1 and accessible
workspace artifacts at candidate `239436cf672be287dbaec4dd9771165609d1d061`.
Only generated fixtures and official-parser results exist; no actual Resolve QA
record, `.drp`/`.dra`, import screenshots or application test results were found.
The 2026-10-06 application preflight also confirmed that the current cloud
environment has neither Resolve nor exposed GPU devices or a graphical session.
The actual application check is blocked there, not passed. The manual gate
therefore remains open. Use [the QA record](resolve-qa-record.md)
to record each capability independently when application testing is performed.

Advanced edits are **metadata only**, a known implementation limit. Speed,
volume/mute, scale, rotation, position, incoming crossfades, titles, photo layouts,
protected regions, photo motion, title styles, film looks, audio automation, non-ripple track
editing and clip locks are retained exactly in OpenFilm metadata and must be
recreated manually in the NLE. They are not native OTIO effects. In particular,
a diptych exports a native cut using its primary photo; the second photo's URI,
asset ID, hash and portable reference travel as secondary-source metadata. The
NLE does not automatically render the second photo or reproduce the layout.
Export returns explicit warnings, and the
application writes an adjacent `.otio.report.json` compatibility report, including
current missing/inaccessible-source warnings. The edit compatibility portion is
also embedded in the OTIO document so it remains available with the file.

| Feature                                              | Implemented                                                                                             | Schema-valid                                           | Official parser read/write/read                               | Real NLE verified                                            |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------- | ------------------------------------------------------------ |
| Video cuts and source in/out at 1x                   | Native OTIO clip ranges                                                                                 | Yes                                                    | Yes, checked against generated source duration                | No — Resolve manual gate                                     |
| Still-image holds                                    | External image reference with explicit hold duration                                                    | Yes                                                    | Yes                                                           | No — verify Resolve still duration/interpretation            |
| Separate audio and music tracks                      | Native Audio tracks and source trims                                                                    | Yes                                                    | Yes                                                           | No — check routing and levels                                |
| Gaps, record offsets and multiple video/audio tracks | Native Gap/Track/Stack                                                                                  | Yes                                                    | Yes, each track and total duration checked                    | No — verify layer and channel mapping                        |
| Fractional project frame rate                        | RationalTime at 30000/1001                                                                              | Yes                                                    | Yes, seconds and rates preserved                              | No — check rounding/subframe behavior                        |
| Current file URLs and source identity                | ExternalReference plus asset ID/hash/reference metadata                                                 | Yes                                                    | Yes; real files, hashes and FFprobe bounds checked separately | No — relink on another machine if needed                     |
| Constant speed                                       | Original speed and full source range in metadata; native unretimed excerpt and, for slow clips, padding | Metadata yes; native retime not implemented            | Exact original fields and reserved slot verified              | Not implemented as an NLE effect; manual recreation required |
| Volume and mute                                      | Metadata only                                                                                           | Metadata yes; native audio gain not implemented        | Original values verified                                      | Manual recreation required                                   |
| Scale, rotation and position                         | Metadata only                                                                                           | Metadata yes; native transforms not implemented        | Original values verified                                      | Manual recreation required                                   |
| Incoming crossfade                                   | Metadata only; exported layout uses cuts                                                                | Metadata yes; native transition not implemented        | Original transition type/duration verified                    | Manual recreation required                                   |
| Generated title and overlay/title-track behavior     | Metadata only over a native Video cut track                                                             | Metadata yes; native title/compositing not implemented | Original title, transform and track type retained             | Manual recreation required                                   |
| Photo layout, focal point and protected region       | Metadata only; diptych retains both source identities while native cut uses primary photo               | Metadata yes; native photo composition not implemented | Exact fields and secondary source identities preserved        | Manual recreation required                                   |
| Hold, push-in and pan recipes                        | Metadata only; no native motion/keyframe effect                                                         | Metadata yes; native motion not implemented            | Recipe start/end and easing preserved                         | Manual recreation required                                   |
| Title roles, typography and layout                   | Metadata only                                                                                           | Metadata yes; native typography not implemented        | Exact style fields preserved                                  | Manual recreation required                                   |
| Film, scene and clip color looks                     | Exact versioned recipes and resolved per-clip look in metadata; no native color effect                  | Metadata yes; native color not implemented             | Color metadata fixture not yet checked by official parser     | Manual recreation required; actual Resolve QA remains open   |
| Audio fades, gain envelopes and ducking              | Metadata only; native cut has no automation                                                             | Metadata yes; native automation not implemented        | Exact local-time envelope and ducking regions preserved       | Manual recreation required                                   |
| Non-ripple soundtrack editing                        | Native Audio track timing; OpenFilm editing policy in metadata                                          | Metadata yes; editing policy not implemented by NLE    | Track timing policy preserved                                 | Recreate editing policy manually                             |
| Clip lock and beat identity                          | Metadata only                                                                                           | Yes                                                    | Preserved                                                     | Reapply locks/organization manually                          |
| Within-track overlapping clips                       | Rejected with an actionable error                                                                       | Not exported                                           | Not applicable                                                | Not claimed                                                  |
| FCPXML / ED