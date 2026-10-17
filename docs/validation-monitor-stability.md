# Monitor stability and frame transport validation

This slice stabilizes the existing Story Edit monitor and exposes practical
monitor controls without adding another timeline or render model.

## Rendering

The FFmpeg preview composition uses an RGBA base while visual clips are overlaid,
rounds the source transform's center offset to output pixels, and aligns each
clip's presentation timestamp to the nearest output time-base tick. The `fps`
filter also uses `round=near`. This prevents odd-pixel transforms and fractional
clip starts from alternating between adjacent pixels or output frames. Final
encoding still uses the configured output pixel format.

Clip and title visibility now uses that same nearest output-frame start. This is
important for fractional starts: a clip at 0.01 seconds in a 30 fps output has
PTS rounded to frame 0, so its overlay must not wait for the unrounded 0.01
second enable boundary and lose that frame.

The installed FFmpeg overlay filter has no `flags` option, so the renderer does
not pass `flags=bicubic` to `overlay`. Resizing remains handled by the existing
scale filter before compositing; the overlay uses `eval=init` and RGB composition
to avoid repeated subpixel coordinate evaluation and chroma-subsampled placement.

FFmpeg's `-progress pipe:1` records are parsed as render progress. Values are
bounded and monotonic, and application jobs persist progress in coarse increments
before publishing it to observers. Render polling updates the visible job state
without reloading the media catalog or project on every progress tick. Terminal
render state still triggers the existing refresh path.

## Monitor controls

The Edit monitor provides preview-only Rule of Thirds and Action/Title Safe
guides, with 16:9, 9:16 and 1:1 framing guides. They do not alter project settings,
clip transforms or rendered output. `G` toggles both guide overlays when keyboard
focus is outside a text or form control.

Video transport displays source timecode at the selected media's frame rate,
steps by one source frame within the selected clip range, and can loop that clip.
Quick clockwise/counterclockwise 90-degree rotation and reset controls submit the
existing transform command, so undo, persistence and renderer geometry remain
shared with other clip edits.

The preview rounds measured frame dimensions to CSS pixels and uses a 2-pixel
hysteresis for workspace height. ResizeObserver watches the source monitor only;
the window resize listener continues to cover viewport changes.

Frame-space translations are rounded before converting into monitor CSS pixels,
so a one-pixel output move remains visible in a scaled-down preview. Selecting a
different clip that uses the same source reconfigures the existing media element
with that clip's in-point, speed and volume. Restarting after the selected source
range ends begins at the range in-point for both the custom transport and native
media controls. Frame stepping chooses the adjacent boundary in the requested
direction from off-frame playhead positions. Toggling the rendered preview above
the editor explicitly remeasures the available Story workspace height.

## Automated evidence

- `packages/render/tests/render.test.ts` renders a white source with an odd-pixel
  x offset, decodes two frames, and verifies stable output placement and pixels.
- The same suite verifies a fractional clip start activates on the output frame
  selected by its rounded PTS.
- The same suite verifies monotonic renderer progress ending at 1.
- `tests/unit/app-render-cancellation.test.ts` verifies render progress polling
  does not reload the catalog or project.
- `tests/unit/monitor-stability.test.ts` covers dimension rounding, workspace
  hysteresis, fractional CSS mapping, direction-aware frame stepping/clamping,
  quantized timecode, guide geometry and playback boundary decisions/restart.
- `tests/unit/timeline-clip-render-boundary.test.ts` verifies that a one-pixel
  frame transform remains a fractional CSS translation after viewport scaling.
- `tests/e2e/timeline-scale.spec.ts` exercises guides, keyboard toggling, source
  timecode, frame stepping, looping and stable monitor layout with a real 500-clip
  local project. It also verifies native playback restarts within the selected
  source range and that guide controls do not mutate the composition.
- `tests/e2e/editing.spec.ts` verifies quick rotation and reset use persisted clip
  geometry, and that selecting another clip from the same source resets the
  existing preview player's position, speed and volume.
- `tests/e2e/desktop.spec.ts` verifies the Story workspace remeasures after the
  rendered preview above it is shown or hidden.

These browser and FFmpeg fixtures verify software behavior. Physical display
presentation, native-window resize behavior, and real camera/proxy color behavior
remain workstation checks.
