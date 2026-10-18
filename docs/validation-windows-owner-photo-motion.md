# Windows recovery and photo motion validation

Implementation: `78e1a956a8e0ad2e3c694467d9d51a3c6f498bfb`.
The subsequent changes to benchmark scripts and portable test fixtures do not
change the film renderer or recovery implementation.

## Exercised behavior

- Windows review owners share a hashed machine/OS-boot scope across actual Node
  processes. Same-scope dead processes can recover; live or occupied PIDs remain
  protected. Missing, denied, legacy and foreign evidence stays unknown. Raw
  machine identifiers are never persisted.
- Fractional photo motion uses cubic affine sampling. Slow horizontal/vertical
  movement stays continuous, and the first rendered frame matches the authored
  position. Identity holds bypass resampling. A seven-second diptych comparison
  produced identical decoded hashes for all 210 frames with this fast path.
- Windows case aliases for the same regular Pixel sidecar resolve to one
  canonical URI. Same-directory, regular-file and symlink restrictions remain.
- NTFS benchmark generation falls back to exclusive copies only when supported
  link errors occur or an UNKNOWN error has measured Windows link-limit evidence.
  An inability to inspect that evidence preserves the original error.

## Local verification

Windows x64, Node 24.14.0, pnpm 11.11.0 and FFmpeg 9.0.2 were used. Tests requiring
`flite` use the official full FFmpeg build; the film uses the essentials build.
Python protocol tests use an explicit `OPENFILM_TEST_PYTHON` interpreter, avoiding
the WindowsApps `python3` alias.

- Focused native photo/layout/orientation checks: 20 passed.
- General FFmpeg rendering checks: 16 passed.
- Pixel checks: 26 passed.
- Portable project/export/relink checks: 32 passed.
- Whisper protocol and glossary checks: 36 passed.
- Media-intelligence integration checks with the flite fixture: 7 passed.
- Photo-film browser checks: 11 passed, including English, Traditional Chinese
  and Japanese, editable motion/titles/audio, history and reopening.
- Production build and built-CLI import/render/export/reopen smoke passed.

The browser and built-CLI checks do not substitute for a clean Windows installer
test. Protocol fixtures do not establish speech or language-model accuracy.

## Workstation gates still open

[Issue #7](https://github.com/bynanci/open-film/issues/7) remains open. This
workstation run does not establish real Resolve import/native project export,
real ASR or LLM reference-set quality, GPU execution, original Pixel/Insta360
camera behavior, sustained real 4K media, a clean self-contained installer, or
macOS automatic dead-owner recovery. Synthetic benchmark generation and Windows
recovery regressions are partial evidence only.
