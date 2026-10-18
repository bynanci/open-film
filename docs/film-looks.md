# Film looks

Choose **Edit → Film look** to set a whole-film style, then adjust the selected
scene or clip. The six original treatments are Soft film (gentle, Fuji-inspired
greens), Americana, Clean camera, Retro, Natural and Sport. They are creative
color recipes, not measurements of a camera or film stock. They do not create
depth of field, recover detail or change playback speed.

Strength runs from 0% to 100%. **Original** deliberately keeps source colors;
**Inherit** removes this scope's override. Looks affect photos and video,
including both sources of a diptych, without coloring titles, audio, controls or
the empty canvas. Source files, trims and film duration remain unchanged.

## Saved editing and output choices

Effective priority is **clip → scene → whole film → original**. Changing a parent
setting preserves all child overrides. A change that would alter a protected
clip, locked source or locked paired photo is rejected as a whole; unlock it
explicitly first. A parent change that leaves its effective look unchanged is
permitted. The shared command boundary handles autosave, one-step Undo/Redo,
revision conflicts, request retries and reopening.

In **Export → MP4 look**, keep saved scene/clip settings or choose one look for
this output. The latter explicitly includes locked clips, but does not change
the project or its history. Render preview uses that same output choice. The
source editing monitor continues to show the saved look. Changing the choice
marks the prior rendered preview stale. The temporary output choice resets when
switching projects/compositions and is not included in editable exports.

JSON and OTIO retain authored settings and effective look evidence. They do not
apply a color effect inside another editor. Active looks require manual recreation
there; limited FCPXML/EDL exports reject them rather than silently lose them.
See [NLE compatibility](nle-compatibility.md). Real Resolve verification remains a
workstation manual gate.

## Portable contract

Optional fields extend the existing schema-1.0.0 composition; no SQLite migration
is needed. Existing projects without these fields retain their original output.

```ts
interface FilmLook {
  version: 1;
  preset:
    | "none"
    | "soft-film"
    | "americana"
    | "clean-camera"
    | "retro"
    | "natural"
    | "sport";
  strength: number; // finite, 0..1
}
// Composition.defaultLook?: FilmLook
// Composition.beatLooks?: { beatId: string; look: FilmLook }[]
// Clip.look?: FilmLook
```

`TimelineCommand` uses `type: "look"`, a `film`, `beat` or `clip` scope, its
required ID for non-film scopes, and `look: FilmLook | null`. `null` removes the
override; `none` and strength zero explicitly stop inheritance. Invalid fields,
unknown presets, versions and scopes fail validation. The application, HTTP and
CLI share the same solver and persistence boundary.

```bash
# Render-only choice; project settings stay unchanged.
pnpm cli render --project /tmp/demo.openfilm --look soft-film --look-strength 0.7
pnpm cli export --project /tmp/demo.openfilm --format mp4 --look natural
```

Without these flags, rendering keeps saved settings. `--look-strength` requires
`--look`; editable export formats reject render-only look flags. HTTP render and
MP4 export accept `lookOverride`; omit it or use `null` to preserve saved looks.
The application validates and copies the override before asynchronous work, and
the server validates before reserving a job. A caller cannot mutate a running
render by changing its request object.

## Numerical and color boundary

Core owns immutable version-1 original recipes in **encoded-SDR RGB**, expressed
as a row-major 4×5 RGBA matrix. Strength linearly interpolates coefficients from
identity to the recipe. RGB is clamped after the operation; alpha is unchanged.
The constant column is zero. RGB lift uses the alpha column, so lift is multiplied
by alpha and is constant only for opaque pixels. Tests pin the version-1 registry
with a golden SHA-256; changing recipes requires an explicit version strategy.

The browser adapter uses SVG `feColorMatrix` with `sRGB` interpolation on source
elements. FFmpeg applies the same coefficients to decoded RGBA8 sources before
source geometry/compositing, retaining the existing decode behavior. Existing HDR
conversion uses Hable tone mapping to BT.709 before the matrix. `format=rgba`
does not convert BT.709 transfer to sRGB; this feature adds no such conversion.
Unknown source color metadata stays unknown rather than being guessed.

Shared coefficients establish a shared equation, not universal pixel parity.
Browser/video decode, transfer functions, display profiles, clipping, quantization
and encoding can change appearance. **Use the rendered FFmpeg preview/output to
judge the final result**, particularly with video and HDR. Executed SDR PNG color
fixtures establish their measured tolerance only; they do not certify arbitrary
camera sources, wide-gamut displays or a professional color-management pipeline.

Each private render manifest records resolved scope, preset, strength and matrix,
the complete registry and its checksum, original-recipe origin/license, pipeline
assumptions, source hashes/catalog color metadata, output encoding/hash, and actual
FFmpeg build identity. Manifests contain local paths and are private evidence.
They describe a reproducible recipe, not hardware appearance certification.

## Open-source boundaries

The recipes are original OpenFilm work under GPL-3.0-only. No third-party LUT,
camera profile, model, remote font or online translation is needed. OpenColorIO
and other upstream projects inform the documented processing boundaries; they
are not imported as runtime engines. External LUT import, film simulation,
scene-linear grading and full color management remain later work.

See [pinned reference/adaptation decisions](film-look-open-source-reference.md),
[third-party obligations](third-party.md) and
[executed validation](validation-film-looks.md).
