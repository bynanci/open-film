# Garden Stone editorial media workspace

OpenFilm uses a restrained Japanese garden vocabulary: warm stone surfaces,
still-water neutrals, moss accents and a path of stepping stones through the
workflow. Media remains primary; Story beats and duration provide hierarchy.
The design is desktop-first and favors readable, recoverable actions over dense
professional editing controls. Shapes stay subtle so the interface remains a
film workspace rather than a decorative garden illustration.

## Tokens

`apps/desktop/src/tokens.css` is the source of truth. New users start with the
warm-stone light theme. Existing explicit dark, light and system preferences are
preserved. System follows the OS theme; both palettes use the same semantic roles.
Existing component variable names are aliases so incremental changes share one
palette.

| Role                    | Tokens                                                                          |
| ----------------------- | ------------------------------------------------------------------------------- |
| Background and surfaces | `--of-bg`, `--of-surface-1` through `--of-surface-3`                            |
| Text                    | `--of-text-primary`, `--of-text-secondary`, `--of-text-muted`                   |
| Separators and controls | `--of-border-subtle`, `--of-border-strong`, `--of-border-control`, `--of-focus` |
| Main action             | `--of-accent`, `--of-accent-hover`, `--of-accent-ink`, `--of-accent-soft`       |
| Status                  | `--of-success`, `--of-warning`, `--of-danger` and corresponding soft surfaces   |
| Media overlays          | `--of-player`, `--of-on-media`, `--of-on-media-muted`, `--of-media-scrim`       |
| Geometry                | `--of-space-*`, `--of-radius-sm/md/lg/dialog/round`                             |
| Elevation and light     | `--of-shadow-soft/raised/hover/floating/dialog/contact`, `--of-shadow-tint`     |
| Typography              | `--of-font-body/mono/caption/small/base/title`, `--of-line-body/heading`        |
| Motion and layers       | `--of-motion-fast/normal/ease`, `--of-z-media/sticky/notice/dialog`             |

The Garden Stone light palette uses warm limestone `#f2efe8`, paper `#fbf9f3`,
sand `#e9e5da`, ink `#272a24` and a moss accent `#3d6348`. Dark mode keeps a
quiet charcoal-green workspace with a light moss accent. Stone, sand, moss and
water colors are also available for restrained decorative details. Controls use
soft surface fills and shape instead of permanent frames; a strong focus ring
marks the active keyboard target.
Palette tests check actual text/surface pairs in both themes; core text targets
WCAG AA. Focus and control boundaries use stronger contrast than decorative
hairlines. Media players remain dark in either theme and use dedicated overlay
text tokens.

Button text and surfaces switch palettes together. Animate borders/opacity,
not interpolated foreground/background colors: intermediate theme colors can
violate contrast even when both settled palettes pass. Reduced motion still
disables the remaining transitions.

## Type and spacing

Use a local Mincho-capable system stack, including Traditional Chinese and
Japanese fallbacks. No downloadable web fonts are required. Body line height is
1.65; headings use 1.35 to preserve CJK legibility. The fixed rem scale renders
captions at 13px, small labels at 14px, body at 15px, workspace headings at 28px
and the Welcome heading at 36px with the default root size. Product headings do not grow with
window width. Monospace is reserved for timecodes and technical paths. Selection,
text carets and native scrollbars use the same semantic palette.

The spacing scale is based on 4px increments. Group related controls through
spacing and surfaces rather than a border around every item. Long story titles
wrap; durations and small state indicators do not shrink away. Paths show useful
filenames/trailing context with the complete value available as a tooltip or detail.

### Proportion and alignment

The Welcome and desktop Export compositions use a 1.618:1 visual split, with
preview taking the larger Export column. Tool layouts use bounded columns:
Story's index stays between 224px and 288px; the Edit inspector stays near
256–320px rather than growing with the window. Preview and Inspector occupy
the upper row, while the Story timeline spans the full lower row. Library's
inspector similarly has a bounded width so thumbnails retain the available space.
The navigation path uses a 168px desktop rail and a compact rail at narrower
widths. Titles, form controls and action groups share edges; durations use tabular
numerals. These are application layout choices, not traditional garden rules.

The layout uses quiet surfaces and spacing instead of boxes around each region.
Navigation and selected states use moss-tinted surfaces without decorative
outlines. Raised surfaces use a very soft shadow only where a panel needs to
read independently. Form controls retain a visible boundary and every keyboard
focus retains a high-contrast outline; those affordances are functional.

### Sun-angle shadow model

Raised surfaces share one locally calculated sun direction. OpenFilm approximates
the seasonal sun arc at a 35° north reference latitude from the system's local
date and wall clock. It derives azimuth and elevation, projects the cast shadow
away from the light, and varies offset, softness and intensity by surface height.
Low morning and evening light produces a longer, softer cast; midday light keeps
cards close to the surface. In darkness the system returns to a short, quiet
ambient shadow. A faint light-side edge keeps dark-theme surfaces legible.

Lighting refreshes every 15 minutes and when the app returns to the foreground.
It makes no location request and sends no data outside the device. Because no
geolocation is requested, this is a Garden Stone lighting approximation rather
than a claim of exact local astronomy. Shadow changes use the shared motion token
and animate smoothly. Reduced-motion preferences set the shared transition
duration to zero; lighting values still refresh without animated interpolation.

| Context               | Workspace gutter | Panel inset | Major section gap |
| --------------------- | ---------------- | ----------- | ----------------- |
| Up to 900 CSS px      | 16px             | 16px        | 20px              |
| Standard desktop      | 24px             | 20px        | 24px              |
| 1600 CSS px and wider | 32px             | 24px        | 32px              |

These map to `--of-workspace-gutter`, `--of-panel-inset` and
`--of-section-gap`. Related controls use an 8px gap and groups use 12px;
multiline form fields retain 16px separation. Medium and large radii use restrained unequal corners with broad, flat edges, while touch targets and hit areas stay
rectangular and predictable. A selected surface uses a moss fill and label rather
than a decorative frame. Neutral cards use surface separation, with fewer nested
frames and no double selection outline. The original film logo and user-authored
media/scene colors are independent of the workspace tint.

## Existing reusable primitives

### Garden Stone component geometry

Controls and workspace surfaces use restrained asymmetric corners and flat
edges, without oval or capsule silhouettes. Segmented views float on the surface with a moss-filled selected segment;
media tiles favor their thumbnail rather than an extra framed card. Use the small
shared shadow to separate interactive stepping-stone cards without outlining
them.

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
  validation. Text begins at the reading edge; numeric values and time use
  right alignment with tabular numerals. Filled, softly rounded surfaces replace
  permanent outlines, while keyboard focus keeps a high-contrast ring. Duration
  and film-language fields explain their scope. Editing controls keep a 44px
  minimum hit area; range and choice inputs retain their compact native shape.
- **Select:** use the shared token-colored caret and reserved end padding so the
  current value and open affordance never collide. Filled surfaces distinguish
  controls from prose; keyboard focus supplies the stronger boundary.
- **Dialog:** named semantic dialog, initial focus, keyboard containment where
  modal, Escape handling and return focus. Destructive draft actions require an
  explicit decision; routine edits do not.
- **Media card:** thumbnail, duration, selection/favorite/lock/offline state.
  Square, edge-to-edge previews use a regular 16px media radius, distinct from
  the garden-inspired workspace surfaces. A 190px responsive tile floor and 20px
  grid gutters keep thumbnails large enough to scan. A compact, always-visible
  action row sits before the two-line filename, using system sans-serif type.
  Favorite, lock, offline and duration indicators remain explicit. Storyboard
  strips and compact source previews share the media geometry; timeline clips
  keep their duration-oriented width. Technical metadata belongs in the inspector.
- **Story beat:** flexible title/intent, fixed-readable duration, selected count
  and actual timing when composed. Selected and suggested memories are separate.
- **Timeline clip:** cached lazy thumbnail, stable selected/locked/missing states,
  drag and keyboard alternatives. Selecting one source does not decode every clip.
  The desktop editor keeps its player visible while the story-beat rail scrolls
  vertically and clip lanes scroll horizontally. Its inspector scrolls separately;
  arrow selection reveals a clip inside those regions without moving the page.
- **Inspector:** contextual controls for photo, video or audio, collapsible at
  smaller desktop widths. Its six sections use two columns of borderless selector cards, keeping CJK
  labels readable within the bounded Inspector width. Soundtrack choices read as rows, and
  mute/solo/lock controls use the same semantic status colors as the rest of the
  workspace. Unsupported controls are omitted.
- **Empty state:** states the next meaningful action, with one direct action to
  add media, build a story, create a cut or export. The local `GardenStones.vue`
  SVG uses angular, uneven stepping stones following one continuous route on
  welcome and empty surfaces. Keep it out of dense browsing and editing regions so user
  media remains the strongest image. No remote artwork or fonts are loaded.
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
Versions. Workspace navigation and workflow steps use filled, borderless cards
as a path of stepping stones; moss, success and attention colors distinguish
their states. The rail narrows to labeled-by-accessibility icon controls at
compact desktop widths.
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

### Tobi-ishi layout interpretation

See [stepping-stone rationale](garden-path-design.md) for movement,
spacing, stopping points and the distinction between traditional principles
and OpenFilm layout choices.

See [editing layout rationale](layout-refinement.md) for pane allocation and reference access limitations.
