# Readable, smooth native captions

Deliver native editable captions whose typography, safe bottom inset and fade timing agree in browser preview and FFmpeg export. Preserve existing projects' rendering when the optional controls are absent. Enable higher quality/lossless bounded export so final delivery needs only one lossy video encode. No private media belongs in this repository.

- Existing TitleStyle fontFamily/fontWeight/fontSize remain the typography contract.
- Add optional `fadeIn` and `fadeOut` seconds, each finite 0..10, default 0.
- Add optional normalized `bottomInset`, finite 0..0.45, default 0.08.
- Extend `position` with `top`, using the existing 8% top safety margin (including scrim). Center and top ignore `bottomInset`; existing position defaults remain unchanged. Top may combine with right alignment to place captions away from a subject.
- `resolveTitleFadeFrames(style, duration, frameRate)` returns `{fadeInFrames, fadeOutFrames, frameCount}`. Round requested fade seconds to frames. Frame count is ceil(duration*fps - epsilon), at least 1. If requested fades exceed frameCount-1, distribute the available frames proportionally; a single-frame title remains visible.
- `titleOpacityAtTime(style, localTimelineTime, duration, frameRate)` returns linear frame-quantized opacity, zero outside the clip. With no fades it is one inside the clip. Fade-in starts at zero on the first frame; fade-out reaches zero on the last live frame. Preview uses timeline-local time even when source media has trim or speed.
- Native renderer applies equivalent alpha fades to the OpenFilm-generated title raster. Both title tracks and attached photo/video titles use this behavior.
- Inspector exposes font size, weight, fade in/out and bottom inset with existing presentation/undo handling. Never silently discard these fields when another control changes.
- `RenderOptions.quality` accepts `preview` (existing default CRF23/veryfast), `high` (CRF17/medium), or `lossless` (CRF0/veryfast). High/lossless photo and general resizing use Lanczos; default preview behavior stays compatible. No arbitrary encoder command strings are accepted.
- Keep existing crossfade transition types; focus-like movement uses existing protected PhotoMotion push-in/pull-out. No new blur transition or 4K delivery is in scope.

Review risks: fades on short clips; last-frame rounding; video trim/speed preview mapping; subtitle pixels remain ungraded; bottom inset and scrim keep glyphs inside frame; alpha/quality behavior agrees across native title tracks and attached titles.
