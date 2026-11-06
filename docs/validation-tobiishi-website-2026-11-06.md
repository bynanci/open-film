# Tobi-ishi website validation — 2026-11-06

## Candidate

The `codex/tobiishi-website` branch depends on `codex/tobiishi-control-panel`
at `7084d3f`. The application implementation is `9209059`; its shared primitives
and local regression limits are recorded in the
[control-panel validation](validation-tobiishi-control-panels-2026-11-06.md).
Main was re-fetched at `d332fb3265077ca08f218f6ba9b6c65d2519eaa2`.

This candidate preserves VitePress 1.6.4, the `/open-film/` base, zh-TW root,
`/en/` and `/ja/`, existing article links, heading anchors and local search.
It adds a five-step homepage, a seven-category task-guide hub, contextual article
navigation and a coherent editorial garden composition. Angular backing planes
are shared with the application; readable text, media geometry, hit targets and
focus outlines stay rectangular. Typography uses local system fonts through
VitePress's font-free theme entry. No WOFF2 files are included in the built assets.

The public release remains v0.4.0 source-only. Screenshots identify the current
development workspace and its English interface. Original fictional garden
artwork and generated fixture media carry explicit origins; private media and
uninspected external references are not used as evidence.

## Checks

| Check                                                            | Local result                                                                                                                                                                    |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm --prefix docs run build`                                    | Passed, with the existing large-chunk advisory.                                                                                                                                 |
| `pnpm typecheck:website`                                         | Passed.                                                                                                                                                                         |
| `pnpm test:website`                                              | 13 passed against the final production build, optimized navigation logos, refreshed application captures and on-demand poster/error-flow implementation.                        |
| `pnpm test:docs-i18n`                                            | Passed: localized README sets and English reference mirrors, including the new guide hub.                                                                                       |
| `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm build` | Passed across the combined candidate; the application record contains the broader regression breakdown.                                                                         |
| Required hosted CI                                               | Not claimed. Branch publication is possible through Git, but GitHub GraphQL/REST access is blocked by 403 / invalid API authorization. The required CI merge gate remains open. |

The thirteen browser cases cover:

- zh-TW, en-US and ja-JP homepage → workflow step → task guide → setup section.
- Local search with a real locale index, Escape focus return, persisted theme,
  native sidebar disclosure keyboard behavior and active-page semantics.
- axe WCAG A/AA checks of rendered setup pages in all three locales.
- Home, guides and article layout at 390×844, 768×1024, 1280×720 and 1920×1080.
- Expanded labels, unavailable images and no horizontal page overflow.
- No initial MP4 request; keyboard play and pause of the real twelve-second film,
  with no requests to external services.
- A failed sample request presents a localized explanation and a working route
  to the production workflow.

All 48 locale-specific guide targets resolve to repository documents. The
focused documentation/token unit suites passed all 19 cases. Navigation logos
were reduced from about 600 KB to 10 KB while preserving their Desktop originals.

Local CJK fonts are installed for screenshot QA and installed in the CI docs lane.
Full-page capture visits lazy imagery before taking screenshots. Pixel-perfect
snapshots are deliberately not required; text, layout, keyboard and real network
behavior carry the assertions.

## Asset and film evidence

`docs/public/images/origins.json` binds original imagery and the rendered MP4 to
SHA-256 hashes and the application source revision. Product Library/Story/Edit
captures come directly from Playwright using shareable generated garden media.
The sample is produced by `OpenFilmApplication.render` with two crossfades,
without external finishing. FFprobe confirms 1280×720 at 24fps and 12 seconds;
decoded AAC samples have peak 0. It loads only after the visitor's play action.

See [asset origins](website-assets.md) and
[reproduction commands](tobiishi-website.md). The sample's 720p dimensions describe
this website asset, not an application output limit or a native benchmark.

## Remaining gates

Review and required exact-head hosted checks before merging the two candidates.
The application retains its missing native-system-dependency blocker and separate
Windows/macOS, camera, long-session performance, listening and real Resolve QA.
Website screenshots and generated fixture playback do not satisfy those gates.
