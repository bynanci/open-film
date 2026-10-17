# Photo-film quality implementation plan

**Goal:** Produce an editable, recoverable twenty-second A/B photo film with
visible layout/motion/title and audible soundtrack differences.

**Architecture:** Extend existing optional Clip data and validated commands.
Use shared presentation/audio evaluation and a common local title raster for
Desktop and FFmpeg. Keep source assets immutable and output manifests private.

**Tech stack:** TypeScript, Vue, SQLite/project JSON, FFmpeg; Node-only fontkit
and resvg for actual glyph measurement and rendering.

**Spec:** [Photo-film quality contract](../../photo-film-quality.md), based on
the user-supplied review and frame evidence dated 2026-10-17.

## Tasks

1. Add strict optional versioned fields and pure evaluators. Tests first for
   legacy identity, protected regions, invalid coordinates, seek samples and gain.
2. Add presentation and audio-overlay commands using current history/receipts.
   Verify locks, source bounds, duration isolation, undo/redo and reopen.
3. Render actual layout/motion, measured CJK title layers and audio automation.
   Verify with decoded FFmpeg frames/samples rather than command snapshots.
4. Expose contextual Desktop controls with three locales, source-safe preview,
   existing autosave, keyboard controls and bounded rail rendering.
5. Preserve/report new data in interchange. Add title-preview API and private
   export manifest with actual source/font/output identities.
6. Generate public fixture A/B films, composition diff, contact sheets, probe,
   loudness/peak evidence; retain real viewing/listening as manual checks.
7. Run required checks and focused browser regressions; independently review
   correctness, fix findings, update TASKS/ROADMAP and publish the candidate.

## Review focus

- A protected region wider than a hero crop must remain visible.
- Selecting a secondary photo must validate and relink that source too.
- Audio operations and visual shortening must preserve unrelated tracks/locks.
- Chinese punctuation, missing glyphs and overlong text must fail explicitly.
- Arbitrary seeks and outgoing transition tails must sample the same motion.
