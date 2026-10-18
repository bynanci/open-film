import {
  validateComposition,
  type Clip,
  type Composition,
  type MediaAsset,
  type Track,
} from "@openfilm/core";

export const qualitySettings = { width: 960, height: 540, frameRate: 30 };
export const qualitySampleTimes = [
  0, 1.5, 2.9, 2.966667, 3, 3.133333, 4.5, 5.9, 5.966667, 6, 6.1, 6.233333, 8,
  9.9, 10, 11.5, 12.9, 12.966667, 13, 14.5, 15.9, 16, 18, 19.9,
];

/** A fixed comparison recipe: same timeline and sources, explicit design edits. */
export function buildPhotoFilmQualityScenario(assets: MediaAsset[]): {
  baseline: Composition;
  designed: Composition;
} {
  const sourceIds = [
    "portrait-center",
    "landscape-pair",
    "landscape-detail",
    "portrait-left",
    "portrait-right",
    "far-apart-subjects",
  ];
  for (const id of [
    ...sourceIds,
    "square-detail",
    "landscape-closing",
    "synthetic-music",
    "synthetic-narration",
  ])
    if (!assets.some((asset) => asset.id === id))
      throw new Error(`Quality scenario requires asset ${id}`);
  const starts = [0, 3, 6, 10, 13, 16];
  const durations = [3, 3, 4, 3, 3, 4];
  const video: Track = {
    id: "pictures",
    type: "video",
    clips: sourceIds.map((assetId, index) => ({
      id: `picture-${index + 1}`,
      assetId,
      beatId: "quality-reference",
      timelineStart: starts[index]!,
      timelineDuration: durations[index]!,
    })),
  };
  const title = (
    id: string,
    text: string,
    start: number,
    duration: number,
  ): Clip => ({
    id,
    assetId: "portrait-center",
    title: text,
    timelineStart: start,
    timelineDuration: duration,
  });
  const baseline: Composition = {
    id: "quality-A",
    storyId: "generated-quality-reference",
    duration: 20,
    tracks: [
      video,
      {
        id: "titles",
        type: "titles",
        clips: [
          title("film-title", "一起，把日常留下", 0, 3),
          title("scene-statement", "那些平凡而重要的片刻", 6, 4),
          title("subtitle", "這是測試字卡，並非私人故事。", 10, 3),
        ],
      },
      {
        id: "music",
        type: "music",
        timing: "overlay",
        clips: [
          {
            id: "music-bed",
            assetId: "synthetic-music",
            sourceIn: 0,
            sourceOut: 20,
            timelineStart: 0,
            timelineDuration: 20,
            transform: { volume: 0.65 },
          },
        ],
      },
      {
        id: "narration",
        type: "audio",
        timing: "overlay",
        clips: [
          {
            id: "narration",
            assetId: "synthetic-narration",
            sourceIn: 0,
            sourceOut: 8,
            timelineStart: 6,
            timelineDuration: 8,
            transform: { volume: 0.8 },
          },
        ],
      },
    ],
  };
  const designed = structuredClone(baseline);
  designed.id = "quality-B";
  const pictures = designed.tracks[0]!.clips;
  pictures[0]!.layout = {
    version: 1,
    preset: "hero",
    focalPoint: { x: 0.5, y: 0.5 },
    protectedRegion: { x: 0.39, y: 0.34, width: 0.22, height: 0.3 },
  };
  pictures[0]!.motion = {
    version: 1,
    preset: "push-in",
    easing: "ease-in-out",
    from: { scale: 1, x: 0, y: 0 },
    to: { scale: 1.06, x: 0, y: 0 },
  };
  pictures[1]!.layout = {
    version: 1,
    preset: "hero",
    protectedRegion: { x: 0.15, y: 0.35, width: 0.7, height: 0.45 },
  };
  pictures[2]!.layout = {
    version: 1,
    preset: "hero",
    focalPoint: { x: 0.63, y: 0.52 },
    protectedRegion: { x: 0.55, y: 0.4, width: 0.16, height: 0.4 },
  };
  pictures[2]!.motion = {
    version: 1,
    preset: "pan",
    easing: "linear",
    from: { scale: 1.05, x: -10, y: 0 },
    to: { scale: 1.05, x: 10, y: 0 },
  };
  pictures[3]!.layout = {
    version: 1,
    preset: "diptych",
    gap: 16,
    secondary: { assetId: "square-detail" },
  };
  pictures[4]!.layout = {
    version: 1,
    preset: "diptych",
    gap: 16,
    secondary: { assetId: "landscape-closing" },
  };
  pictures[5]!.layout = {
    version: 1,
    preset: "hero",
    protectedRegion: { x: 0.02, y: 0.3, width: 0.96, height: 0.5 },
  };
  pictures[5]!.motion = {
    version: 1,
    preset: "hold",
    easing: "linear",
    from: { scale: 1, x: 0, y: 0 },
    to: { scale: 1, x: 0, y: 0 },
  };
  // Keep the mixed portrait/landscape boundary a cut; a later gentle dissolve
  // is separately sampled. Crossfade extends outgoing hold without ripple.
  pictures[2]!.transition = { type: "crossfade", duration: 0.2 };
  const titles = designed.tracks[1]!.clips;
  titles[0]!.titleStyle = {
    version: 1,
    role: "film-title",
    fontFamily: "Noto Sans CJK TC",
    fontSize: 42,
    maxWidth: 850,
    position: "center",
    background: "scrim",
  };
  titles[1]!.titleStyle = {
    version: 1,
    role: "scene-statement",
    fontFamily: "Noto Sans CJK TC",
    fontSize: 32,
    maxWidth: 800,
    position: "bottom",
    background: "scrim",
  };
  titles[2]!.titleStyle = {
    version: 1,
    role: "subtitle",
    fontFamily: "Noto Sans CJK TC",
    fontSize: 24,
    maxWidth: 820,
    position: "bottom",
    background: "scrim",
  };
  designed.tracks[2]!.clips[0]!.audioAutomation = {
    version: 1,
    role: "music",
    fadeIn: 1,
    fadeOut: 2,
    points: [
      { time: 0, gain: 1 },
      { time: 20, gain: 1 },
    ],
    ducking: [{ start: 5.7, end: 14.3, gain: 0.25, attack: 0.3, release: 0.3 }],
  };
  designed.tracks[3]!.clips[0]!.audioAutomation = {
    version: 1,
    role: "narration",
    fadeIn: 0.15,
    fadeOut: 0.2,
  };
  const options = { assetIds: assets.map((asset) => asset.id) };
  return {
    baseline: validateComposition(baseline, options),
    designed: validateComposition(designed, options),
  };
}
