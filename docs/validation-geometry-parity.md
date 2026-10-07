# Geometry correctness validation

The original candidate `a4244f446c86ae0a32f41979f2bb2d515fa58730` had green CI
but failed the added real-browser transient-input regression. Inspector toggle
and direct source-box resize cases passed even before direct observation was
added. These are positive interaction coverage, not a reproduced observer fault.
The unsuccessful attempt to demand a red result is retained in Actions run
37569327733 rather than reported as a product failure.

Preview-only input resolution retains committed valid geometry while numeric
fields are temporarily empty or invalid. Domain and command validation remain
strict. Direct viewport observation additionally removes reliance on outer layout
callbacks, handles replaced elements and unregisters old observations.

An independent real-FFmpeg regression uses generated 80x40 coded pixels with
SAR 2:1. Their display aspect is 4:1. The old contain/setsar pipeline produced a
160x80 picture (2:1); the corrected display-aspect fit produces 160x40. Source
hashes remain unchanged. This fixture is not real-camera/HDR/4K certification.

The preceding candidate passed format, i18n, lint, typecheck, 998 unit/integration
tests and two focused browser cases. New SAR before-and-after logs, viewport
baseline, complete verify output and focused browser output are retained as
Actions artifacts. Full release browser/native/interchange CI and an exact-head
review remain separate gates; no workstation QA is implied.
