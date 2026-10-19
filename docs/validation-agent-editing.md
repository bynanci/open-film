# M5 / F08 Reviewable Agent Editing validation

This is PR 5B, based on merged Layer Editor PR #30 at
`a33340c43d40f82825bc788e1c82625883e6acbb`. It reuses the saved Composition,
GraphicScene v1, the current TimelineEditor revision, and the layer Inspector.
It adds no timeline, project schema, provider implementation, or independent
persistence path.

## Behavior and safety contract

- A Desktop request targets its selected GraphicScene layer. The application
  accepts one to eight unique selected node IDs for headless/API callers and
  binds every proposal to the saved Composition revision, project, Composition,
  scene and selected IDs.
- The local parser uses a small deterministic grammar for translation, size,
  rotation, opacity, visibility and text. Unsupported instructions become
  typed conflicts; they are not guessed or sent to a provider automatically.
- Provider responses must be a single bounded JSON object with allowlisted
  `translate` or `set` operations. Operations cannot add/remove layers, change
  media sources, or execute HTML/JavaScript. Every value is validated against
  the selected node type, GraphicScene bounds and lock ancestry before it can
  appear as an action.
- Optional text generation uses `KnowledgeService.generateReviewText`,
  `ProviderRegistry` and explicit descriptor-bound `text` consent. The prompt
  includes only the instruction and selected layer visual snapshot; it omits
  asset IDs, paths, project files and other layers. No provider call occurs
  before consent for a remote provider.
- The UI displays affected IDs, reasons, before/after values and typed
  conflicts. Actions start unselected and the user explicitly selects the
  exact changes to accept; the application applies only the action IDs supplied
  by the user in proposal order. Acceptance is one existing
  `graphic.scene.upsert` edit and therefore uses normal autosave, stale revision,
  Undo/Redo and reopen behavior. Actions that only validate after earlier
  operations declare those prerequisites and remain unavailable until they are
  selected.
- Proposals remain ephemeral and are rejected when stale, missing, locked,
  unselected, conflicting or unavailable. An uncertain acceptance stores its
  exact request ID in project/Composition-scoped local storage before sending
  the write, so a response lost across reload can be retried without creating a
  second edit. If receipt storage fails, the write is not sent. Switching owners
  reloads the corresponding receipt; a stale retry fails closed. Pending
  acceptance blocks keyboard and button Undo/Redo, direction acceptance,
  navigation, export/flush and further composition mutations. The app restores
  the receipt barrier before mounting the Graphics inspector. A proposal is
  disabled until the current local composition draft is saved. The pending gate
  survives inspector unmounts until the receipt is retried or explicitly
  discarded.
- Candidate edits are validated against retained GraphicScene template records
  before actions are shown and again at acceptance; provenance-bound text cannot
  create a receipt that will fail on every retry.
- Provider previews run outside the global mutation queue, carry an abort signal,
  stop on client/project/server close, and have a bounded 60-second deadline.
  After the provider returns, saved-revision and active-project checks fail stale
  requests closed.

## Regression evidence

- `tests/unit/graphic-scene-agent-review.test.ts` covers dropping a stale
  in-flight Desktop preview without leaving the editor busy.
- `packages/solver/tests/graphic-scene-agent.test.ts` covers the local grammar,
  strict JSON parsing, before/after actions, explicit action selection, bounds,
  locked ancestors, unselected IDs, proposal prerequisites and bounded reasons
  for long local text instructions.
- `packages/application/tests/graphic-scene-agent.test.ts` covers preview
  without save, local accept, one-step Undo/Redo, reopen, provider refusal before
  consent, selected-only provider disclosure, unselected output conflicts,
  locked layers, stale revision rejection and protected Conversation Card text.
- `tests/integration/graphic-scene-adapters.test.ts` covers HTTP preview and
  acceptance through the same server-held TimelineEditor, followed by HTTP
  Undo. A deliberately uncooperative provider fixture verifies stale previews
  fail after a concurrent saved edit, timeout abort works, and other edits
  complete while provider generation waits.
- `tests/e2e/graphic-scenes.spec.ts` covers Desktop Preview → Select → Explicit
  Accept, deselect disabling acceptance, retrying a lost acceptance response,
  inspector switching while an acceptance is pending, reload restoration before
  opening Graphics, blocked keyboard Undo and direction acceptance, pending
  state blocking Story navigation, saved layer position and Undo.
- `packages/application/tests/graphic-scenes.test.ts` creates a synthetic
  background MP4, accepts a deterministic layer translation, renders a new real
  H.264 MP4, probes 320×180 / 12 fps / 72 frames / 6 seconds, decodes the
  three-second frame and verifies the red shape moved to its accepted position.
  The test also compares the render manifest source SHA-256 with the original
  synthetic source and checks that surfaced warnings equal the manifest.

## Validation status

At source head `cfe3cd6cc558cf620fbfecd35deb800bbaef0e59`, `pnpm test` passed
all 197 files / 2,885 tests, including the actual synthetic-source FFmpeg
render regression. `pnpm format:check`, `pnpm test:i18n` (1,610 semantic keys
across English, Traditional Chinese and Japanese), `pnpm lint`,
`pnpm typecheck`, and `pnpm build` passed. The production bundle reports the
existing size advisory (898.39 kB uncompressed). With the isolated pinned
OpenTimelineIO interpreter,
`OPENFILM_OTIO_PYTHON=/tmp/openfilm-interchange-venv/bin/python pnpm test:interchange`
passed all 18 checks against OpenTimelineIO 0.18.1.

The complete browser suite passed 163/163 with
`PATH=/tmp/openfilm-e2e-venv/bin:$PATH OPENFILM_CHROMIUM=/usr/bin/chromium pnpm test:e2e`.
This includes the GraphicScene receipt-before-write, reload restoration,
keyboard history, direct direction acceptance, inspector switch and exact retry
checks. Both exact-head GitHub Verify runs passed their TypeScript/media and
native-shell jobs (runs [39270057403](https://github.com/bynanci/open-film/actions/runs/39270057403)
and [39270047074](https://github.com/bynanci/open-film/actions/runs/39270047074)).
Cargo is unavailable locally; the two native-shell CI jobs are the native gate.
The fresh Codex code review of PR head `425b874` completed without findings; all
12 prior review threads are resolved. The Codex security review on the unchanged
implementation source completed without findings.

The implementation source CI is green. The later PR head `425b87445d7342bef62e48b14c591f9b7687e3b1`
changed only this validation record; `git diff cfe3cd6..425b874` contains no
source changes. Its duplicate documentation-only Verify runs
[39275438727](https://github.com/bynanci/open-film/actions/runs/39275438727) and
[39275421234](https://github.com/bynanci/open-film/actions/runs/39275421234)
passed native-shell, formatting, i18n, verify, interchange and CLI smoke steps,
but their TypeScript/media jobs remained `in_progress` beyond the configured
30-minute job timeout while GitHub's jobs endpoint returned intermittent 502
errors. This is recorded as an Actions runner/status blocker, not as a passing
exact-document-head CI result. The full implementation-source CI and all local
checks above passed on `cfe3cd6`; no source files changed after that validation.

Provider model quality, external endpoint availability, physical display
quality, hardware/4K throughput and downstream Resolve/NLE finishing remain
manual gates; synthetic fixtures do not certify them.
