# Editorial media workspace

OpenFilm uses quiet surfaces and media as the primary content. Story beats and
duration provide hierarchy. The design is desktop-first and favors readable,
recoverable actions over dense professional editing controls.

## Tokens

`apps/desktop/src/tokens.css` is the source of truth. The default is dark; light and
system themes use the same semantic roles. Existing component variable names are
aliases so incremental changes share one palette.

| Role                    | Tokens                                                                          |
| ----------------------- | ------------------------------------------------------------------------------- |
| Background and surfaces | `--of-bg`, `--of-surface-1` through `--of-surface-3`                            |
| Text                    | `--of-text-primary`, `--of-text-secondary`, `--of-text-muted`                   |
| Separators and controls | `--of-border-subtle`, `--of-border-strong`, `--of-border-control`, `--of-focus` |
| Main action             | `--of-accent`, `--of-accent-hover`, `--of-accent-ink`, `--of-accent-soft`       |
| Status                  | `--of-success`, `--of-warning`, `--of-danger` and corresponding soft surfaces   |
| Media overlays          | `--of-player`, `--of-on-media`, `--of-on-media-muted`, `--of-media-scrim`       |
| Geometry                | `--of-space-*`, `--of-radius-sm/md/lg/dialog/round`                             |
| Typography              | `--of-font-body/mono/caption/small/base/title`, `--of-line-body/heading`        |
| Motion and layers       | `--of-motion-fast/normal/ease`, `--of-z-media/sticky/notice/dialog`             |

The Quiet Studio revision uses carbon `#101216`, with cool neutral text and a blue
accent (`#b6c8ff` in dark and `#3454c5` in light). The light workspace uses pearl
`#f5f6f8` with white editing surfaces. Decorative borders are quiet hairlines;
text fields and native selects use the separate `--of-border-control` role.
Palette tests check actual text/surface pairs in both themes; core text targets
WCAG AA. Focus and control boundaries use stronger contrast than decorative
hairlines. Media players remain dark in either theme and use dedicated overlay
text tokens.

Button text and surfaces switch palettes together. Animate borders/opacity,
not interpolated foreground/background colors: intermediate theme colors can
violate contrast even when both settled palettes pass. Reduced motion still
disables the remaining transitions.

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

| Context               | Workspace gutter | Panel inset | Major section gap |
| --------------------- | ---------------- | ----------- | ----------------- |
| Up to 900 CSS px      | 16px             | 16px        | 20px              |
| Standard desktop      | 24px             | 20px        | 24px              |
| 1600 CSS px and wider | 32px             | 24px        | 32px              |

These map to `--of-workspace-gutter`, `--of-panel-inset` and
`--of-section-gap`. Related controls use an 8px gap and groups use 12px;
multiline form fields retain 16px separation. A selected surface uses the blue
fill/label or a single selected border. Neutral cards use surface separation,
with fewer nested frames and no double selection outline. The original film
logo and user-authored media/scene colors are independent of the workspace tint.

## Existing reusable primitives

### Quiet Studio component geometry

Controls share the 10px medium radius, content panels use the 16px large radius,
and Settings/command dialogs use the 20px dialog radius. Segmented views use a
shared inset surface and a raised selected segment; media tiles favor their
thumbnail rather than an extra framed card. Use the small shared shadow only
where an independently interactive surface benefits from elevation.

The top bar groups project identity, preferences and task actions. The project
switch is an accessible named icon button; the local connection indicator retains
its text for assistive technology and a hover title. The normal English/Traditional
Chinese desktop bar fits a single row at 1280px and wider; compact and expanded
locale layouts can wrap. Touch media actions remain visible without hover, with
44px action targets.

Export keeps the existing App-owned native preview alongside its settings on
desktop in a presentation-only grid. The same mounted player retains seek,
volume and rate when switching Edit/Export. Below 900px the bounded preview and
settings stack in reading order. No second player engine or renderer is introduced.
See [redesign validation](validation-quiet-studio-redesign.md) for measured layout,
interaction, contrast and remaining manual gates.

### Operation modes

General mode retains guided workflow copy and existing responsive spacing.
Expert mode reduces repeated guidance, opens advanced editor/export tools and
uses 16px desktop gutters/insets/section gaps (24px/20px/24px at 1600px and wider).
Body text and essential save/lock/error signals keep their existing roles.
The header and Settings share the device mode preference; no project content
changes or editor remounts accompany the switch. Quick actions support localized
search, keyboard navigation and the same save/review barriers in either mode.
See [workspace modes](workspace-modes.md) for behavior and acceptance evidence.

### Shared controls

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

An open project uses a fixed workspace rail for Library, Story, Edit, Export and
Versions. The workflow steps remain available below it as guided shortcuts; the
rail narrows to labeled-by-accessibility icon controls at compact desktop widths.
Library filters form a horizontal browsing strip so they do not compete with the
global workspace navigation. The top bar keeps project identity and project
switching in a consistent location. The last workspace is stored in local UI
preferences by project ID, so reopening a project resumes its previous view
without changing the project file or Composition.

The sticky rail follows the measured header height, including locale and zoom
changes. Focused workspace controls have enough scroll margin to clear the
header. A visible-on-focus skip link reaches the main workspace.

Story setup uses an inline editing area with adjacent authored-order preview,
field-level validation and explicit close/focus return. Closing retains the
draft for the current project session. Story views follow the tab keyboard
pattern (Left/Right, Home/End), reuse the existing save/review gates and expose
one labeled panel. Storyboard previews are native buttons; nested player and
button keys keep their native behavior. An unavailable source and a beat with
no chosen media are different visible states. See
[workspace interaction design](workspace-ux-refinement.md).

Desktop media inspectors scroll independently within a bounded height; beat
navigation fits its content instead of stretching to the full text editor.
At compact widths inspectors stack in normal page flow. Export preview boxes
have a definite container width and keep their aspect ratio within it, avoiding
overflow when minimum-height rules meet narrow windows. Header controls can
wrap while retaining room for the project identity.

The StoryGraph toolbar wraps within the actual canvas. Below 960px of graph
container width, side palettes collapse and open one at a time over the canvas,
with Escape/focus return; returning to a wide canvas restores the prior wide
panel choices. Resizing changes local panel chrome, not graph coordinates or
story order. Explicit Fit to content measures the canvas, toolbar and rendered
node sizes instead of assuming a 900×600 drawing area. Toolbar clicks and
scrolling do not start a canvas pan.

Graph beat text uses the same beat-save and pending-draft gates as Outline.
Continuous input keeps the latest draft while a save is pending; failure leaves
an explicit retry and restores field focus after a successful retry. Resizing
an actively edited palette preserves that field instead of hiding focus.
Selecting another beat waits for its pending save and verifies the project,
session generation and story owner before changing the active editor.

The expanded breakpoint sweep and source-level fixes are recorded in
[responsive surface validation](validation-responsive-surfaces.md).

Visual tests capture en-US, zh-TW, ja-JP and expanded en-XA screens and check
overflow, readable controls and missing keys. Accessibility checks combine token
contrast tests, browser keyboard assertions and axe checks of rendered core
screens. Screenshots support human inspection; passing automated checks is not a
claim that every assistive technology or native platform has been certified.
