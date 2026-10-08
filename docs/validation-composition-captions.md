# Composition-caption validation

The slice starts from OpenFilm main
`34b6ff093294f97061dfb0ecb270413a52b6b7ee` on branch
`codex/composition-aware-captions`. It does not include or modify the separate
open PR #8/#9 cancellation/owner-recovery branches. At inspection both were Ready,
exact-head checks green and unresolved review threads zero. Neither is merged by
this task. Main and workstation issue #7 were checked again before implementation.

The pinned OpenCut source review, actual-versus-announced capability distinction,
licensing boundary and eight-row gap matrix are in [the reference record](opencut-reference.md).
The application behavior and manual/headless steps are in [the workflow](composition-captions.md).

## Regression evidence before the full candidate gate

- HTTP/CLI tests first failed because the caption route returned 404 and `--track`
  was not accepted. Actual browser flow first failed at the missing caption UI.
- Domain/serializer tests cover source trims, fixed speed, split instances, gaps,
  repeated assets, alignment, rounding, malformed source metadata, limits and
  overlap preservation. Application tests cover revision/source races during
  preparation and staged publication, missing transcripts, cancellation, failures,
  retry, receipts, symlink rejection and 10,000-segment bounded reads.
- The export-only CLI lifecycle regression protects exact project bytes and live
  job records, including a newer project saved by another process before close.
- Independent review reproduced SRT entity corruption with FFmpeg's actual
  subtitle decoder. Format-specific output now preserves ampersands and rejects
  ambiguous HTML/ASS/timing-shaped text with a WebVTT fallback. Signed timestamp
  injection cases were added; matching the serializer to its own parser was not
  used as the format gate.
- Chromium's native TextTrack parser reads WebVTT timing and decoded Unicode/text;
  FFprobe reads SRT packets and FFmpeg decodes text to independently check content.
- Focused browser suite: 8 passed. Four locale layout checks cover en-US, zh-TW,
  ja-JP and en-XA at 1280×720, 1440×900 and 1920×1080. They check bounded lists,
  keyboard scroll/pagination, clipping, horizontal overflow and axe. An initial
  accessibility failure exposed unfocusable scroll regions; a RED→GREEN component
  regression and the final browser run verify the fix.
- Browser ownership tests hold a real response across project replacement and
  reject a stale transcript snapshot before publication. Downloaded subtitle and
  manifest bytes, source hashes, corrected revisions and unchanged film data are
  checked. The tests reuse persisted synthetic transcripts, without model calls.

These targeted results establish the implemented workflow, not a final SHA gate.
Complete gate results and candidate identity are recorded below after execution.

## Manual gates remain open

No actual Resolve import/playback/relink/save-reopen, real ASR/LLM quality, GPU
performance, representative camera/HDR/4K or Windows installer test was performed.
OS-specific process ownership remains its separate workstation contract. Subtitle
format/parser success does not verify a particular NLE's playback or overlap
presentation. No OpenCut runtime was built or executed, no code was copied, and
no speed or productivity percentage is claimed.
