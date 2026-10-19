import {
  mkdtemp,
  mkdir,
  copyFile,
  readFile,
  rm,
  writeFile,
  utimes,
  access,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, expect, it, vi } from "vitest";
import type { Composition } from "@openfilm/core";
import * as media from "@openfilm/media";
import { hashFile, inspectMedia, runProcess } from "@openfilm/media";
import {
  graphicNode,
  graphicScene,
} from "../../../tests/fixtures/graphic-scene.js";
import { FFmpegRenderer, prepareGraphicScenes } from "../src/index.js";

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

it("renders six seconds of deterministic graphics with source-only images, CJK text and group compositing", async () => {
  const root = await mkdtemp(join(tmpdir(), "openfilm-graphics-"));
  roots.push(root);
  const source = join(root, "synthetic-green.png");
  await runProcess("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=0x00ff00:s=32x24",
    "-frames:v",
    "1",
    "-threads",
    "1",
    "-y",
    source,
  ]);
  const asset = await inspectMedia({
    path: source,
    uri: pathToFileURL(source).href,
    name: "synthetic-green.png",
  });
  const original = await hashFile(source);
  const common = {
    x: 0,
    y: 0,
    width: 60,
    height: 40,
    opacity: 1,
    zIndex: 0,
    start: 0,
    end: 6,
  };
  const composition: Composition = {
    id: "synthetic-film",
    storyId: "story",
    duration: 6,
    tracks: [],
    graphicScenes: [
      graphicScene({
        nodes: [
          graphicNode({
            id: "moving",
            fill: "#ffff00",
            width: 20,
            height: 20,
            y: 30,
            animation: {
              enter: { duration: 3, easing: "linear", from: { x: -100 } },
              exit: { duration: 3, easing: "linear", to: { x: 100 } },
            },
          }),
          {
            ...common,
            id: "image",
            type: "image",
            assetId: asset.id,
            x: 100,
            y: -30,
            width: 32,
            height: 24,
          },
          {
            ...common,
            id: "text",
            type: "text",
            text: "動態場景",
            fontSize: 20,
            width: 180,
            height: 40,
            y: -50,
          },
          {
            ...common,
            id: "group",
            type: "group",
            x: -85,
            y: -10,
            opacity: 0.5,
            width: 100,
            height: 80,
            children: [
              graphicNode({ id: "red", width: 60, height: 40 }),
              graphicNode({
                id: "blue",
                fill: "#0000ff",
                shape: "ellipse",
                width: 30,
                height: 20,
                x: 10,
                zIndex: 1,
              }),
            ],
          },
        ],
      }),
    ],
  };
  const prepared = await prepareGraphicScenes(
    composition,
    [asset],
    { width: 320, height: 180, frameRate: 30 },
    root,
  );
  const seen = new Map<number, Buffer>();
  for (const frame of [90, 0, 179, 17, 90, 0, 45, 179]) {
    const png = await prepared.frame(null, frame);
    if (seen.has(frame)) expect(png).toEqual(seen.get(frame));
    else seen.set(frame, png);
  }
  expect(seen.get(0)).not.toEqual(seen.get(90));
  const output = join(root, "animation.mp4");
  await new FFmpegRenderer().render(composition, [asset], output, {
    width: 320,
    height: 180,
    frameRate: 30,
  });
  const pixelsAt = async (index: number) =>
    (
      await runProcess("ffmpeg", [
        "-v",
        "error",
        "-i",
        output,
        "-vf",
        `select=eq(n\\,${index})`,
        "-frames:v",
        "1",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "pipe:1",
      ])
    ).stdout;
  const pixel = (bytes: Buffer, x: number, y: number) => [
    ...bytes.subarray((y * 320 + x) * 3, (y * 320 + x) * 3 + 3),
  ];
  for (const [index, x] of [
    [0, 60],
    [90, 160],
    [179, 259],
  ] as const) {
    const bytes = await pixelsAt(index);
    expect(bytes.length).toBe(320 * 180 * 3);
    expect(pixel(bytes, x, 120)[0]).toBeGreaterThan(220);
    expect(pixel(bytes, x, 120)[1]).toBeGreaterThan(220);
    expect(pixel(bytes, 260, 60)[1]).toBeGreaterThan(220);
    expect(pixel(bytes, 85, 80)[2]).toBeGreaterThan(110);
    expect(pixel(bytes, 85, 80)[0]).toBeLessThan(15);
    let glyphs = 0;
    for (let y = 20; y < 60; y++)
      for (let x = 70; x < 250; x++) {
        const p = pixel(bytes, x, y);
        if (p.every((value) => value > 180)) glyphs++;
      }
    expect(glyphs).toBeGreaterThan(100);
  }
  const a = await pixelsAt(90);
  await pixelsAt(0);
  expect(await pixelsAt(90)).toEqual(a);
  const manifest = JSON.parse(
    await readFile(`${output}.manifest.json`, "utf8"),
  );
  expect(manifest.sources).toContainEqual(
    expect.objectContaining({ assetId: asset.id, sha256: original }),
  );
  expect(manifest.fonts.length).toBeGreaterThan(0);
  expect(await hashFile(source)).toBe(original);
  const probe = await runProcess("ffprobe", [
    "-v",
    "error",
    "-count_frames",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=nb_read_frames,duration",
    "-of",
    "json",
    output,
  ]);
  expect(JSON.parse(probe.stdout.toString()).streams[0]).toMatchObject({
    nb_read_frames: "180",
    duration: "6.000000",
  });
  const evidence = process.env.OPENFILM_GRAPHIC_QA_OUTPUT;
  if (evidence) {
    await mkdir(evidence, { recursive: true });
    for (const [sourcePath, name] of [
      [source, "synthetic-green.png"],
      [output, "animation.mp4"],
      [`${output}.manifest.json`, "animation.mp4.manifest.json"],
    ])
      await copyFile(sourcePath!, join(evidence, name!));
    for (const frame of [0, 90, 179]) {
      await writeFile(
        join(evidence, `monitor-${frame}.png`),
        await prepared.frame(null, frame),
      );
      await runProcess("ffmpeg", [
        "-v",
        "error",
        "-i",
        output,
        "-vf",
        `select=eq(n\\,${frame})`,
        "-frames:v",
        "1",
        "-threads",
        "1",
        "-y",
        join(evidence, `decoded-${frame}.png`),
      ]);
    }
    await writeFile(
      join(evidence, "evidence.json"),
      JSON.stringify(
        {
          version: 1,
          synthetic: true,
          duration: 6,
          frameRate: 30,
          frameCount: 180,
          width: 320,
          height: 180,
          testedFrames: [0, 90, 179],
          shuffledProducerFrames: [90, 0, 179, 17, 90, 0, 45, 179],
          sourceSha256: original,
          outputSha256: await hashFile(output),
          fontSha256: manifest.fonts.map(
            (font: { sha256: string }) => font.sha256,
          ),
        },
        null,
        2,
      ),
    );
  }
}, 30000);

it("rejects unsafe declarative input and excessive work before source/output IO", async () => {
  const base: Composition = {
    id: "safe",
    storyId: "story",
    duration: 6,
    tracks: [],
    graphicScenes: [graphicScene()],
  };
  await expect(
    new FFmpegRenderer().render(
      {
        ...base,
        graphicScenes: [
          { ...graphicScene(), html: "<script>throw 1</script>" },
        ],
      } as never,
      [],
      "/not-created/unsafe.mp4",
      { width: 320, height: 180, frameRate: 30 },
    ),
  ).rejects.toMatchObject({ code: "graphics.invalid" });
  await expect(
    new FFmpegRenderer().render(base, [], "/not-created/oversized.mp4", {
      width: 8192,
      height: 8192,
      frameRate: 60,
    }),
  ).rejects.toMatchObject({ code: "graphics.resourceLimit" });
  let accessed = false;
  const unsafe = graphicScene();
  Object.defineProperty(unsafe, "nodes", {
    enumerable: true,
    get() {
      accessed = true;
      return [];
    },
  });
  await expect(
    new FFmpegRenderer().render(
      { ...base, graphicScenes: [unsafe] },
      [],
      "/not-created/accessor.mp4",
    ),
  ).rejects.toMatchObject({ code: "graphics.invalid" });
  expect(accessed).toBe(false);
});

it("refuses executable image bytes without publishing or modifying the original", async () => {
  const root = await mkdtemp(join(tmpdir(), "openfilm-graphic-safe-"));
  roots.push(root);
  const source = join(root, "disguised.png");
  const bytes = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg"><script>throw 1</script><image href="https://example.invalid/private"/></svg>',
  );
  await writeFile(source, bytes);
  const asset = {
    id: "image",
    name: "synthetic",
    uri: pathToFileURL(source).href,
    mediaType: "image" as const,
    state: {},
    tags: [],
    metadata: {},
  };
  const composition: Composition = {
    id: "film",
    storyId: "story",
    duration: 6,
    tracks: [],
    graphicScenes: [
      graphicScene({
        nodes: [
          {
            id: "image",
            type: "image",
            assetId: asset.id,
            x: 0,
            y: 0,
            width: 40,
            height: 30,
            opacity: 1,
            zIndex: 0,
            start: 0,
            end: 6,
          },
        ],
      }),
    ],
  };
  const output = join(root, "unsafe.mp4");
  await expect(
    new FFmpegRenderer().render(composition, [asset], output, {
      width: 320,
      height: 180,
      frameRate: 30,
    }),
  ).rejects.toMatchObject({ code: "graphics.unavailable" });
  expect(await readFile(source)).toEqual(bytes);
  await expect(access(output)).rejects.toMatchObject({ code: "ENOENT" });
  await expect(access(`${output}.manifest.json`)).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it("matches legacy image bytes with the manifest hash even if an external write restores mtime", async () => {
  const root = await mkdtemp(join(tmpdir(), "openfilm-graphic-provenance-"));
  roots.push(root);
  const source = join(root, "source.png"),
    replacement = join(root, "replacement.png");
  for (const [path, color] of [
    [source, "green"],
    [replacement, "red"],
  ])
    await runProcess("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      `color=c=${color}:s=32x24`,
      "-frames:v",
      "1",
      "-threads",
      "1",
      "-y",
      path!,
    ]);
  // PNG permits trailing bytes after IEND. Equalize the files so size and
  // restored mtime cannot accidentally stand in for content provenance.
  const first = await readFile(source),
    second = await readFile(replacement);
  const length = Math.max(first.length, second.length);
  await writeFile(
    source,
    Buffer.concat([first, Buffer.alloc(length - first.length)]),
  );
  await utimes(source, 1700000000, 1700000000);
  const bytes = Buffer.concat([second, Buffer.alloc(length - second.length)]);
  expect(bytes.length).toBe((await readFile(source)).length);
  const asset = await inspectMedia({
    path: source,
    uri: pathToFileURL(source).href,
    name: "legacy.png",
  });
  delete asset.contentHash;
  const composition: Composition = {
    id: "film",
    storyId: "story",
    duration: 6,
    tracks: [],
    graphicScenes: [
      graphicScene({
        nodes: [
          {
            id: "image",
            type: "image",
            assetId: asset.id,
            x: 0,
            y: 0,
            width: 40,
            height: 30,
            opacity: 1,
            zIndex: 0,
            start: 0,
            end: 6,
          },
        ],
      }),
    ],
  };
  const actual = media.hashFile;
  let changed = false;
  vi.spyOn(media, "hashFile").mockImplementation(async (path, signal) => {
    const hash = await actual(path, signal);
    if (path === source && !changed) {
      changed = true;
      await writeFile(source, bytes);
      await utimes(source, 1700000000, 1700000000);
    }
    return hash;
  });
  const output = join(root, "changed.mp4");
  await expect(
    new FFmpegRenderer().render(composition, [asset], output, {
      width: 320,
      height: 180,
      frameRate: 30,
    }),
  ).rejects.toThrow(/changed between manifest capture/);
  expect(changed).toBe(true);
  await expect(access(output)).rejects.toMatchObject({ code: "ENOENT" });
});
