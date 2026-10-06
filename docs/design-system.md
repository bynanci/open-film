# Editorial media workspace

OpenFilm uses quiet surfaces and media as the primary content. Story beats and
duration provide hierarchy. The design is desktop-first and favors readable,
recoverable actions over dense professional editing controls.

## Tokens

`apps/desktop/src/tokens.css` is the source of truth. The default is dark; light and
system themes use the same semantic roles. Existing component variable names are
aliases so incremental changes share one palette.

| Role                    | Tokens                                                                        |
| ----------------------- | ----------------------------------------------------------------------------- |
| Background and surfaces | `--of-bg`, `--of-surface-1` through `--of-surface-3`                          |
| Text                    | `--of-text-primary`, `--of-text-secondary`, `--of-text-muted`                 |
| Separators and controls | `--of-border-subtle`, `--of-border-strong`, `--of-focus`                      |
| Main action             | `--of-accent`, `--of-accent-hover`, `--of-accent-ink`, `--of-accent-soft`     |
| Status                  | `--of-success`, `--of-warning`, `--of-danger` and corresponding soft surfaces |
| Media overlays          | `--of-player`, `--of-on-media`, `--of-on-media-muted`, `--of-media-scrim`     |
| Geometry                | `--of-space-*`, `--of-radius-sm/md/lg/round`                                  |
| Typography              | `--of-font-body/mono/caption/small/base/title`, `--of-line-body/heading`      |
| Motion and layers       | `--of-motion-fast/normal/ease`, `--of-z-media/sticky/notice/dialog`           |

Dark surfaces begin at `#101215`, with warm off-white text and an amber accent.
Palette tests check actual text/surface pairs in both themes; core text targets
WCAG AA. Focus and control boundaries use stronger contrast than decorative
hairlines. Media players remain dark in either theme and use dedicated overlay
text tokens.

## Type and spacing

Use the local system stack, including Traditional Chinese and Japanese fallbacks.
No downloadable web fonts are required. Body line height is 1.6; headings use
1.25. The fixed rem scale renders captions at 12px, body at 14px, workspace headings
at 28px and the Welcome heading at 32px with the default root size. Product headings
do not grow with window width. Monospace is reserved for timecodes and technical
paths. Selection, text carets and native scrollbars use the same semantic palette.

The spacing scale is based on 4px increments. Group related controls through
spacing and surfaces rather than a border around every item. Long story titles
wrap; durations and small state indicators do not shrink away. Paths show useful
filenames/trailing context with the complete value available as a tooltip or detail.

## Existing reusable primitives

- **Button:** semantic native button, clear primary/secondary/text/icon roles.
  Hover and active states change surface; selected state has shape or indicator
  as well as color. Disabled and loading controls communicate unavailable actions.
- **Input:** visible label, inherited font, useful focus outline and adjacent
  validation. Duration and film-language fields explain their scope.
- **Dialog:** named semantic dialog, initial focus, keyboard containment where
  modal, Escape handling and return focus. Destructive draft actions require an
  explicit decision; routine edits do not.
- **Media card:** thumbnail, duration, selection/favorite/lock/offline state.
  Actions remain keyboard-accessible even when visually quiet. Technical metadata
  belongs in the inspector.
- **Story beat:** flexible title/intent, fixed-readable duration, selected count
  and actual timing when composed. Selected and suggested memories are separate.
- **Timeline clip:** cached lazy thumbnail, stable selected/locked/missing states,
  drag and keyboard alternatives. Selecting one source does not decode every clip.
  The desktop editor keeps its player visible while the story-beat rail scrolls
  vertically and clip lanes scroll horizontally. Its inspector scrolls separately;
  arrow selection reveals a clip inside those regions without moving the page.
- **Inspector:** contextual controls for photo, video or audio, collapsible at
  smaller desktop widths. Unsupported controls are omitted.
- **Empty state:** states the next meaningful action, with one direct action to
  add media, build a story, create a cut or export.
- **Status:** compact Activity for jobs; inline recovery for validation, missing
  media and save failure. Technical details are progressively disclosed.

These are conventions over existing components and CSS, not a new component
framework. `product.css` handles shared product layout; focused editor, relink,
source and export-report styles retain their component responsibilities.

The refinement follows Impeccable's Operate/Polish guidance at upstream revision
`ca6ca49f6a74e2e23adb955fb3801f4aa6426f3d`: preserve the incumbent visual system,
remove repeated decorative labels, group controls by task and inspect rendered
interaction paths. The user requirement for local system/CJK fonts takes priority
over generic font recommendations. No runtime design service or edit hook is added.

## Interaction and validation

Focus uses a visible outline with offset, never color alone. Keyboard navigation,
reorder, undo/redo, delete and playback remain available. Reduced-motion preference
removes nonessential transitions. Layouts support 1024px and larger windows, with
explicit QA at 1280×720, 1440×900 and 1920×1080.

Visual tests capture en-US, zh-TW, ja-JP and expanded en-XA screens and check
overflow, readable controls and missing keys. Accessibility checks combine token
contrast tests, browser keyboard assertions and axe checks of rendered core
screens. Screenshots support human inspection; passing automated checks is not a
claim that every assistive technology or native platform has been certified.
