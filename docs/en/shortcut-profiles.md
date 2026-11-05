# Keyboard shortcut profiles

Choose the active keyboard profile in **Settings → Keyboard shortcut profiles**.
Open the Cut Desk shortcut reference to see the bindings currently in use.

To customize a profile, export its JSON file, edit the `bindings` object, then
import the saved file. OpenFilm checks the file and switches to the imported
profile. Removing a custom profile returns to **OpenFilm Default**.

```json
{
  "format": "openfilm-shortcut-profile",
  "version": 1,
  "name": "Review desk",
  "bindings": {
    "record.stepForward": {
      "code": "KeyP",
      "modifiers": []
    }
  }
}
```

The example changes the Record next-frame key to the physical P key. `code`
uses the browser's `KeyboardEvent.code` names, such as `KeyP`, `ArrowLeft`,
`Comma`, and `Space`. Action IDs are case-sensitive. A profile can contain only
the actions it changes; omitted actions keep their OpenFilm Default binding.
Export includes the complete resolved map.

Profiles cover the existing Source, Record, and General timeline shortcuts.
Repeated key chords are allowed across those separate contexts, but two actions
in the same context cannot use the same chord. Supported modifiers are `alt`
and no modifier; Shift continues to modify frame stepping and fine-edit
operations. Control/Command shortcuts, reserved browser/system chords,
function keys, Alt+arrow navigation, the shortcut-reference key, and gesture
controls are not remappable. The shortcut reference shows Source and Record
transport bindings separately, along with the current edit bindings.

Profiles are declarative data, not executable plugins. They remain in local app
preferences and are never saved into an OpenFilm project. OpenFilm rejects
unknown fields, commands, key codes, modifiers, conflicting bindings, invalid
versions, malformed JSON, and files larger than 16 KiB. Up to 16 imported
profiles can be kept; remove profiles you no longer use.
