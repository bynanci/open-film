# Professional Cut Desk Phase 1C Responsive Workspace and Accessibility — Validation

Date: 2026-10-31.
Capability: Responsive resizable Cut Desk with tabbed and dual-monitor layouts, persistent preference storage with safe corruption recovery, accessible keyboard shortcut reference sheet (`ShortcutSheet.vue`), 44×44px coarse pointer touch targets, high-contrast focus indicators, screen reader announcements, and reduced-motion compliance without introducing a secondary timeline engine.

## Key Invariants and Contracts

1. **Dual-Monitor and Tabbed-Monitor Layouts**:
   - Provides both `"tabbed"` (single monitor switched between Record and Source) and `"dual"` (side-by-side Source and Record with resizable divider) monitor presentation in Expert mode.
   - Preserves explicit active target (`activeTarget: "record" | "source"`), visual active target outline ring (`.is-active-target`), and screen-reader announcements (`role="status"`, `aria-live="polite"`).
   - In dual mode, transport and edit commands route deterministically to whichever target is active without modifying un-targeted media.
   - Narrow viewports ($\le 1100$px) automatically adapt to vertical stacking, avoiding horizontal scrollbars or page overflow across 1024×768, 1440×900, and 1920×1080.

2. **Safe Preference Recovery on Corruption**:
   - `cutDeskMonitorLayout` and `cutDeskSplitRatio` are stored under `openfilm.preferences.v1`.
   - Non-conforming or corrupted data (missing storage, invalid JSON, unexpected types, or out-of-range ratios) safely falls back to defaults (`"tabbed"`, `0.5`) without throwing errors.
   - Split ratios are bounded strictly within $[0.25, 0.75]$.
   - Saved creative decisions never use localStorage; preferences only govern transient view layouts.

3. **Accessible Shortcut Reference Sheet**:
   - Accessible modal dialog (`role="dialog"`, `aria-modal="true"`) with `aria-labelledby` and `aria-describedby` links.
   - Groups Cut Desk commands across 5 functional categories: Transport, Marks, Edit points, Timeline, and Gestures.
   - Supports `Escape` to close, Tab key focus trapping, and focus restoration to trigger element upon closing.
   - Toggled via `?` shortcut key or the explicit footer button.

4. **Accessibility (a11y) and Coarse Pointer Targets**:
   - Enforces minimum 44×44px hit targets under `@media (pointer: coarse)` across all interactive elements (splitter, close button, layout switch buttons).
   - Provides clear `:focus-visible` styling (2px high-contrast outline with offset).
   - Follows `prefers-reduced-motion: reduce`, disabling transitions and animations for users requesting reduced motion.

5. **General Mode and Single Timeline Invariant**:
   - General mode preserves its guided layout, controls, and history without dual-monitor controls.
   - Both General and Expert modes operate directly on the single authoritative `Composition`; no secondary timeline model is introduced.

## Test Evidence

- `tests/unit/cut-desk-responsive-a11y.test.ts` (17/17 passed):
  - Validates safe recovery from corrupt storage, invalid JSON, and out-of-bounds split ratios.
  - Validates persistence of valid layouts and split ratio clamping.
  - Validates `ShortcutSheet` dialog ARIA attributes, IDs, group contents, and accessible close button.
  - Validates keyboard splitter clamping and target isolation.
- `tests/unit/i18n.test.ts` (11/11 passed):
  - Validates complete multi-locale parity across English (`en-US`), Traditional Chinese (`zh-TW`), and Japanese (`ja-JP`).
- `tests/e2e/professional-cut-desk.spec.ts`:
  - Validates keyboard reachability, visible focus, zero page overflow, and zero serious/critical axe accessibility violations across all three viewports (1024×768, 1440×900, 1920×1080).
- `pnpm test:contracts` (72/72 files, 1402/1402 passed).
- `pnpm typecheck` (0 errors).
- `pnpm format:check` and `pnpm lint` (0 warnings).
