# Standard and expert workspace modes

The user requests a general interface and a faster interface for frequent users.
Continue their authorized implementation work in the existing Vue workspace.

## Approach

Use one workspace with progressive disclosure and a device preference. Separate
applications or project variants would duplicate navigation and edit state;
changing only labels would not improve frequent operations. The implementation
choice is a shared interface with different density/tool defaults plus searchable
commands. No project schema, timeline, renderer or provider changes are needed.

## Behavior

- Default to `standard`, including missing/invalid stored mode values. Remember
  `standard | expert` in the existing local preference record; preserve theme,
  film language, storage root and project workspace history.
- Offer an always-visible header mode selector and descriptive choices in Settings.
  Mode changes affect presentation only, retain component instances, drafts,
  selection, playhead/history and ongoing jobs, and perform no project writes.
- Standard keeps workflow guidance and comfortable spacing. Advanced editor
  actions remain available through a native disclosure. Essential controls,
  save/conflict/lock/missing-source messages remain visible.
- Expert uses smaller desktop gutters/panel insets, compact navigation and less
  repeated guidance. Advanced editor/export tools start expanded. Text sizes,
  contrast and keyboard focus remain readable; coarse pointers retain roomy targets.
- Add a command dialog, available through a labelled trigger and Cmd/Ctrl+K.
  Expert shows its keyboard hint. Search localized labels and stable aliases;
  arrows select enabled results, Enter opens, Escape closes and restores focus.
- Commands are a closed list of existing workspace, story perspective, pipeline,
  new-story and Settings entry points. No render, generation, deletion, restore or
  arbitrary code runs from the dialog. Existing flush/lock/review gates remain
  authoritative. Reject unknown/disabled IDs and stale project/session commands.
- Do not intercept shortcuts in text fields, IME composition, another dialog,
  repeated key events or handled events. Project/session changes close commands.

## Acceptance

Real browser cases exercise both modes, keyboard search/empty/disabled results,
focus return, source locks, dirty draft and history retention, reload/project
switch persistence, translated long labels and compact/wide layouts in both
themes. Unit tests cover validated preferences and localized search. Run format,
i18n, lint, typecheck, build, relevant browser regressions and full Vitest in
sequence where port 4310 is shared. Record actual results and manual gates.

The scope defaults above are implementation decisions, not additional user claims.
