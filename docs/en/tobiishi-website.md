# Tobi-ishi website and task guides

The public VitePress site shares the desktop's warm stone palette, local system
type stacks, original angular backing planes and location-free lighting utility.
The first task is starting a film from source; the site does not present an
unverified installer as a download.

## Visitor route

The homepage introduces one film-making route: Add Media, Organize, Story, Edit
and Export. Each stone links to the corresponding saved workflow section. A
task-guide hub groups setup, source handling, story, editing, delivery, recovery
and contributor references. Setup and workflow articles add numbered in-page
navigation while retaining existing URLs and heading anchors.

Traditional Chinese remains at the root, English under `/en/`, and Japanese under
`/ja/`. Advanced references that have no localized page are explicitly labelled
as English references. Runtime translation or remote translation services are
not used. Local search keeps the existing locale tokenizers and loads its index
when opened. Closing it returns keyboard focus to its origin. Native sidebar
disclosures replace nested interactive controls inside VitePress's responsive
sidebar shell.

## Shared design boundary

`design/tokens.css`, `design/stone-surfaces.css` and `design/garden-lighting.ts`
contain the shared primitives. The website adapter lives under
`docs/.vitepress/theme/`; application-specific styles stay in the desktop.
Content, rectangular hit areas, focus outlines, screenshots and film frames are
not clipped into stones. Only backing planes and decorative artwork are shaped.
Theme changes, keyboard controls and reduced motion remain available.

There is no new framework, tracking service, remote font or runtime model call.
The theme uses VitePress's font-free entry point and system fonts. Its original
garden illustrations and actual sample-media screenshots have separate
[asset provenance](website-assets.md). The silent sample MP4 loads on demand and
is produced through the application renderer, without external finishing.

## Development and verification

From the repository root:

```sh
pnpm install --frozen-lockfile
npm --prefix docs ci
npm --prefix docs run dev
```

Build before testing the production site:

```sh
npm --prefix docs run build
pnpm typecheck:website
pnpm exec playwright install chromium
pnpm test:website
pnpm test:docs-i18n
```

The website browser server uses port 4175 and writes screenshots/traces to
`website-test-results/`. It is separate from the application browser server.
Do not run the application browser suite and native benchmark runner tests
concurrently: both require port 4310.

Website checks cover three locales, 390/768/1280/1920px widths, task links,
search and focus, theme persistence, native sidebar keyboard behavior, axe,
expanded labels, unavailable imagery, and local on-demand MP4 playback. They
avoid pixel-perfect assertions. Shared-design changes also trigger the Pages
deployment workflow; hosted CI checks the site build, types and browser behavior.

To regenerate shareable evidence with the corresponding application source:

```sh
OPENFILM_CAPTURE_SITE=1 pnpm test:e2e tests/e2e/tobiishi-workflow.spec.ts --grep 'captures the actual'
pnpm exec tsx scripts/website/generate-sample.ts
```

The capture opt-in requires this website's generated images. Keep the development
source revision and image hashes in `docs/public/images/origins.json` current
when publishing screenshots. Generated fixtures and hosted checks do not replace
native installer, camera, performance, listening or real NLE verification.
