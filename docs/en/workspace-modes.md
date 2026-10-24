# General and expert operation modes

Choose a mode from the header or Settings. The default is General; the device
remembers the choice across reloads and project switches. It is independent of
the project, film language, theme and each project's last workspace.

| Behavior                | General                                              | Expert                                                  |
| ----------------------- | ---------------------------------------------------- | ------------------------------------------------------- |
| Guidance                | Workflow progress and introductory copy              | Direct workspace navigation with less repeated guidance |
| Desktop spacing         | Existing 24px gutter / 20px inset / 24px section gap | 16px / 16px / 16px; 24px / 20px / 24px on wide screens  |
| Editor advanced actions | Expand Advanced tools when needed                    | Expanded on entry                                       |
| Export formats          | Expand Advanced formats when needed                  | Expanded on entry                                       |
| Quick actions           | Header button or Cmd/Ctrl+K                          | Same actions, with a visible keyboard hint              |

Both modes use the same editor, locks, save/recovery and Undo/Redo history.
Switching mode changes presentation without remounting the editor or changing
the selected clip, playhead, draft or Composition. Save failures, missing-source
warnings, locks and pending review controls retain their existing visibility.
General mode can still access every advanced action.

## Fast navigation

Press Cmd/Ctrl+K or choose Quick actions. Search translated labels or stable
aliases such as `edit`, `graph`, `storyboard` and `pipeline`. Arrow keys choose an
enabled result, Enter opens it, Escape returns focus. The native Close button
retains Enter/Space behavior. Unavailable actions show an explanation.
During editor loading, navigation becomes available once the existing editor
state has finished hydrating; a loading read is not reported as a failed save.

The closed command catalog opens Library, Story, Edit, Export, Versions, the
three story perspectives, new-story setup, Pipeline and Settings. It runs no
render, generation, deletion, restore or arbitrary command. Workspace and story
changes still use the existing save/flush/review gates. Project/session ownership
is checked across awaits; background save results retain the selected action.

Shortcuts do not intercept text fields, selects, contenteditable elements, IME
composition, another dialog, repeated events or already-handled keys. Quick
actions are navigation aids, not another timeline or an AI execution surface.

## Implementation boundary

`WorkspaceMode` is the validated `standard | expert` device preference in
`openfilm.preferences.v1`. Unknown/missing values select General; storage failures
retain the session choice. No project or SQLite schema migration is required.

The mode selector, command dialog and editor disclosures use existing semantic
tokens and en-US/zh-TW/ja-JP catalogs. Inspector tabs size to their content and
wrap rather than squeezing CJK labels into vertical columns. Native desktop
screen readers, OS IME, touch and real browser zoom remain workstation gates.

See [validation](validation-workspace-modes.md).
