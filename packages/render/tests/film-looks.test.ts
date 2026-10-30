import { assertRenderQaMetric } from "../../../tests/helpers/render-qa-policy.js";
// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, expect, it } from "vitest";
import {
  FILM_LOOK_PRESETS,
  filmLookMatrix,
  type Clip,
  type Composition,
  type FilmLook,
  type MediaAsset,
} from "@openfilm/core";
import { inspectMedia, runProcess } from "@openfilm/media";
import { filmLookFilters } from "../src/look-filters.js";
import { FFmpegRenderer, type RenderOptions } from "../src/index.js";

const roots: string[] = [];
const settings = { width: 160, height: 90, frameRate: 30 };
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "openfilm-film-looks-"));
  roots.push(root);
  const path = join(root, "patch.png");
  await runProcess("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=0x705038:s=160x90,format=rgb24",
    "-frames:v",
    "1",
    "-threads",
    "1",
    "-y",
    path,
  ]);
  const asset = await inspectMedia({
    path,
    name: "patch.png",
    uri: pathToFileURL(path).href,
  });
  const composition: Composition = {
    id: "looks",
    storyId: "story",
    duration: 0.2,
    tracks: [
      {
        id: "visual",
        type: "video",
        clips: [
          {
            id: "clip",
            assetId: asset.id,
            timelineStart: 0,
            timelineDuration: 0.2,
          },
        ],
      },
    ],
  };
  const render = async (
    film: Composition,
    name: string,
    options?: RenderOptions,
    assets: MediaAsset[] = [asset],
  ) => {
    const output = join(root, `${name}.mp4`);
    await new FFmpegRenderer().render(film, assets, output, settings, options);
    const pixels = await decode(output);
    return {
      output,
      pixels,
      manifest: JSON.parse(await readFile(`${output}.manifest.json`, "utf8")),
    };
  };
  return { root, asset, composition, render };
}
it("renders a saved film look into actual decoded pixels", async () => {
  const { composition, render } = await fixture();
  const original = await render(composition, "original");
  const graded = await render(
    {
      ...composition,
      defaultLook: { version: 1, preset: "retro", strength: 1 },
    } as Composition,
    "graded",
  );
  expect(graded.pixels).not.toEqual(original.pixels);
});
const look = (
  preset: Exclude<FilmLook["preset"], "local">,
  strength = 1,
): FilmLook => ({
  version: 1,
  preset,
  strength,
});
const sample = (pixels: Buffer, x = 80, y = 45, frame = 0) => [
  ...pixels.subarray(
    (frame * settings.width * settings.height + y * settings.width + x) * 3,
    (frame * settings.width * settings.height + y * settings.width + x) * 3 + 3,
  ),
];
async function decode(path: string) {
  return (
    await runProcess("ffmpeg", [
      "-v",
      "error",
      "-i",
      path,
      "-pix_fmt",
      "rgb24",
      "-f",
      "rawvideo",
      "-",
    ])
  ).stdout;
}
function transformed(rgb: number[], recipe: FilmLook, alpha = 255) {
  const matrix = filmLookMatrix(recipe);
  return [0, 5, 10].map((row) =>
    Math.max(
      0,
      Math.min(
        255,
        rgb[0]! * matrix[row]! +
          rgb[1]! * matrix[row + 1]! +
          rgb[2]! * matrix[row + 2]! +
          alpha * matrix[row + 3]!,
      ),
    ),
  );
}
function closeChannels(
  actual: number[],
  expected: number[],
  tolerance: 1 | 3 = 3,
) {
  for (let i = 0; i < 3; i++)
    assertRenderQaMetric(
      tolerance === 1
        ? "filmLook.losslessChannelError"
        : "filmLook.channelError",
      Math.abs(actual[i]! - Math.round(expected[i]!)),
    );
}
it("renders all six shared matrices with distinct pixels and correct strength", async () => {
  const { asset, composition, render } = await fixture();
  const source = sample(await decode(fileURLToPath(asset.uri)));
  const signatures: string[] = [];
  for (const preset of FILM_LOOK_PRESETS.filter(({ id }) => id !== "none")) {
    const recipe = look(preset.id);
    const result = await render(
      { ...composition, defaultLook: recipe },
      preset.id,
    );
    const actual = sample(result.pixels);
    closeChannels(actual, transformed(source, recipe));
    signatures.push(actual.join(","));
    const half = await render(
      { ...composition, defaultLook: look(preset.id, 0.5) },
      `${preset.id}-half`,
    );
    closeChannels(
      sample(half.pixels),
      transformed(source, look(preset.id, 0.5)),
    );
    expect(result.manifest.looks.clips).toEqual([
      {
        clipId: "clip",
        assetIds: [asset.id],
        source: "film",
        preset: preset.id,
        strength: 1,
        matrix: filmLookMatrix(recipe),
      },
    ]);
  }
  expect(new Set(signatures).size).toBe(6);
});
it("preserves legacy decoded pixels exactly for none, strength zero and omitted looks", async () => {
  const { composition, render } = await fixture();
  const original = await render(composition, "original");
  for (const recipe of [look("none"), look("retro", 0)]) {
    expect(filmLookFilters(recipe)).toEqual([]);
    const result = await render(
      { ...composition, defaultLook: recipe },
      `identity-${recipe.preset}`,
    );
    expect(result.pixels).toEqual(original.pixels);
  }
});
it("resolves film, beat, clip, explicit none and zero strength on actual frames", async () => {
  const { asset, composition, render } = await fixture();
  const source = sample(await decode(fileURLToPath(asset.uri)));
  const clips: Clip[] = [
    { ...composition.tracks[0]!.clips[0]!, id: "film" },
    { ...composition.tracks[0]!.clips[0]!, id: "beat", beatId: "scene" },
    {
      ...composition.tracks[0]!.clips[0]!,
      id: "clip",
      beatId: "scene",
      look: look("clean-camera"),
    },
    {
      ...composition.tracks[0]!.clips[0]!,
      id: "none",
      beatId: "scene",
      look: look("none"),
    },
    {
      ...composition.tracks[0]!.clips[0]!,
      id: "zero",
      beatId: "scene",
      look: look("sport", 0),
    },
  ].map((clip, i) => ({ ...clip, timelineStart: i * 0.2 }));
  const film: Composition = {
    ...composition,
    duration: 1,
    defaultLook: look("retro"),
    beatLooks: [{ beatId: "scene", look: look("sport") }],
    tracks: [{ ...composition.tracks[0]!, clips }],
  };
  const saved = structuredClone(film);
  const result = await render(film, "hierarchy");
  const effective = [
    look("retro"),
    look("sport"),
    look("clean-camera"),
    look("none"),
    look("sport", 0),
  ];
  effective.forEach((recipe, index) =>
    closeChannels(
      sample(result.pixels, 80, 45, index * 6 + 2),
      transformed(source, recipe),
    ),
  );
  expect(
    result.manifest.looks.clips.map(
      (entry: { source: string }) => entry.source,
    ),
  ).toEqual(["film", "beat", "clip", "clip", "clip"]);
  expect(result.manifest.looks).toMatchObject({
    registryVersion: 1,
    matrixSpace: "encoded-sdr-rgb",
    override: null,
    registry: FILM_LOOK_PRESETS,
  });
  for (const override of [look("americana"), look("none")]) {
    const uniform = await render(film, `uniform-${override.preset}`, {
      lookOverride: override,
    });
    for (let index = 0; index < clips.length; index++)
      closeChannels(
        sample(uniform.pixels, 80, 45, index * 6 + 2),
        transformed(source, override),
      );
    expect(uniform.manifest.looks.override).toEqual(override);
    expect(
      uniform.manifest.looks.clips.every(
        (entry: { source: string }) => entry.source === "export",
      ),
    ).toBe(true);
  }
  const preserved = await render(film, "explicit-preserve", {
    lookOverride: null,
  });
  expect(preserved.pixels).toEqual(result.pixels);
  expect(film).toEqual(saved);
});
it("grades both diptych sources while leaving the gap, letterbox and title colors intact", async () => {
  const { asset, composition, render } = await fixture();
  const film: Composition = {
    ...composition,
    defaultLook: look("retro"),
    tracks: [
      {
        ...composition.tracks[0]!,
        clips: [
          {
            ...composition.tracks[0]!.clips[0]!,
            layout: {
              version: 1,
              preset: "diptych",
              gap: 16,
              secondary: { assetId: asset.id },
            },
            title: "WHITE",
            titleStyle: {
              version: 1,
              role: "film-title",
              fontSize: 20,
              position: "center",
              background: "none",
            },
          },
        ],
      },
    ],
  };
  const result = await render(film, "diptych-title");
  const source = sample(await decode(fileURLToPath(asset.uri)));
  closeChannels(
    sample(result.pixels, 30, 45),
    transformed(source, look("retro")),
  );
  closeChannels(
    sample(result.pixels, 130, 45),
    transformed(source, look("retro")),
  );
  closeChannels(sample(result.pixels, 80, 5), [0, 0, 0], 1);
  closeChannels(sample(result.pixels, 5, 5), [0, 0, 0], 1);
  const white = Array.from({ length: 40 * 80 }, (_, i) =>
    sample(result.pixels, 40 + (i % 80), 25 + Math.floor(i / 80)),
  ).filter((rgb) => rgb.every((channel) => channel > 240));
  expect(white.length).toBeGreaterThan(10);
  expect(result.manifest.looks.clips[0].assetIds).toEqual([asset.id, asset.id]);
});
it("grades video sources and keeps different looks through a crossfade", async () => {
  const { root, asset, composition, render } = await fixture();
  const video = join(root, "source.mp4");
  await runProcess("ffmpeg", [
    "-v",
    "error",
    "-loop",
    "1",
    "-i",
    fileURLToPath(asset.uri),
    "-t",
    "1",
    "-c:v",
    "libx264",
    "-threads",
    "1",
    "-pix_fmt",
    "yuv420p",
    "-y",
    video,
  ]);
  const sourceAsset = await inspectMedia({
    path: video,
    uri: pathToFileURL(video).href,
    name: "source.mp4",
  });
  const source = sample(await decode(video));
  const first: Clip = {
    ...composition.tracks[0]!.clips[0]!,
    assetId: sourceAsset.id,
    timelineDuration: 0.4,
    look: look("retro"),
  };
  const second: Clip = {
    ...first,
    id: "second",
    timelineStart: 0.4,
    look: look("sport"),
    transition: { type: "crossfade", duration: 0.2 },
  };
  const result = await render(
    {
      ...composition,
      duration: 0.8,
      tracks: [{ ...composition.tracks[0]!, clips: [first, second] }],
    },
    "crossfade",
    {},
    [sourceAsset],
  );
  closeChannels(
    sample(result.pixels, 80, 45, 3),
    transformed(source, look("retro")),
  );
  closeChannels(
    sample(result.pixels, 80, 45, 21),
    transformed(source, look("sport")),
  );
  const a = transformed(source, look("retro")),
    b = transformed(source, look("sport"));
  closeChannels(
    sample(result.pixels, 80, 45, 15),
    a.map((value, index) => (value + b[index]!) / 2),
    3,
  );
});
it("uses the alpha channel for lift and preserves transparent and partial alpha pixels", async () => {
  const { root } = await fixture();
  const source = join(root, "alpha.rgba");
  const bytes = Buffer.from([
    110, 80, 50, 0, 110, 80, 50, 128, 110, 80, 50, 255,
  ]);
  await writeFile(source, bytes);
  for (const preset of FILM_LOOK_PRESETS.filter(({ id }) => id !== "none")) {
    const recipe = look(preset.id);
    const output = (
      await runProcess("ffmpeg", [
        "-v",
        "error",
        "-f",
        "rawvideo",
        "-pixel_format",
        "rgba",
        "-video_size",
        "3x1",
        "-i",
        source,
        "-vf",
        filmLookFilters(recipe).join(","),
        "-frames:v",
        "1",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgba",
        "-",
      ])
    ).stdout;
    for (let i = 0; i < 3; i++) {
      const alpha = bytes[i * 4 + 3]!;
      closeChannels(
        [...output.subarray(i * 4, i * 4 + 3)],
        transformed([110, 80, 50], recipe, alpha),
        1,
      );
      expect(output[i * 4 + 3]).toBe(alpha);
    }
  }
});
it("snapshots and validates the export override before source I/O", async () => {
  const { root, asset, composition, render } = await fixture();
  const override = look("retro");
  const output = join(root, "snapshot.mp4");
  const operation = new FFmpegRenderer().render(
    composition,
    [asset],
    output,
    settings,
    { lookOverride: override },
  );
  override.preset = "sport";
  override.strength = 0;
  await operation;
  const expected = await render(
    { ...composition, defaultLook: look("retro") },
    "expected-snapshot",
  );
  expect(await decode(output)).toEqual(expected.pixels);
  const missing = {
    ...asset,
    uri: pathToFileURL(join(root, "missing.png")).href,
  };
  await expect(
    new FFmpegRenderer().render(
      composition,
      [missing],
      join(root, "invalid.mp4"),
      settings,
      { lookOverride: look("retro", Number.NaN) },
    ),
  ).rejects.toThrow(/strength/iu);
  await expect(
    new FFmpegRenderer().render(
      { ...composition, defaultLook: look("retro", 2) },
      [missing],
      join(root, "invalid-saved.mp4"),
      settings,
    ),
  ).rejects.toThrow(/strength/iu);
});
it("applies the matrix after HDR tone mapping and retains metadata guards", async () => {
  const { root, composition, render } = await fixture();
  const path = join(root, "pq.mkv");
  await runProcess("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=0x705038:s=160x90:r=30,format=yuv420p10le,setparams=range=limited:color_primaries=bt2020:color_trc=smpte2084:colorspace=bt2020nc",
    "-t",
    "0.2",
    "-c:v",
    "ffv1",
    "-threads",
    "1",
    "-y",
    path,
  ]);
  const asset = await inspectMedia({
    path,
    uri: pathToFileURL(path).href,
    name: "pq.mkv",
  });
  expect(asset.hdr).toBe(true);
  const { hdrToneMapFilter } = await import("@openfilm/media");
  const mapped = (
    await runProcess("ffmpeg", [
      "-v",
      "error",
      "-i",
      path,
      "-vf",
      `${hdrToneMapFilter(asset)},format=rgb24`,
      "-frames:v",
      "1",
      "-f",
      "rawvideo",
      "-",
    ])
  ).stdout;
  const film: Composition = {
    ...composition,
    defaultLook: look("retro"),
    tracks: [
      {
        ...composition.tracks[0]!,
        clips: [{ ...composition.tracks[0]!.clips[0]!, assetId: asset.id }],
      },
    ],
  };
  const result = await render(film, "pq-graded", {}, [asset]);
  closeChannels(
    sample(result.pixels),
    transformed(sample(mapped), look("retro")),
  );
  await expect(
    render(film, "pq-missing-metadata", {}, [
      { ...asset, metadata: { ...asset.metadata, "openfilm.color": {} } },
    ]),
  ).rejects.toThrow(/incomplete or unsupported color metadata/iu);
});
