import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, expect, it } from "vitest";
import {
  evaluateClipAtTime,
  type Clip,
  type Composition,
  type MediaAsset,
} from "@openfilm/core";
import { hashFile, inspectMedia, localPath, runProcess } from "@openfilm/media";
import * as render from "../src/index.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
const settings = { width: 320, height: 180, frameRate: 30 };
const fill = {
  version: 1 as const,
  kind: "ambient" as const,
  blurSigma: 0.02,
  dim: 0.45,
};
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "openfilm-photo-ambient-"));
  roots.push(root);
  const image = async (name: string, filter: string): Promise<MediaAsset> => {
    const path = join(root, `${name}.png`);
    await runProcess("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      filter,
      "-frames:v",
      "1",
      "-threads",
      "1",
      "-y",
      path,
    ]);
    const asset = await inspectMedia({
      path,
      uri: pathToFileURL(path).href,
      name: `${name}.png`,
    });
    return { ...asset, contentHash: await hashFile(path) };
  };
  const source = await image(
    "portrait",
    "color=c=0x305090:s=100x200,drawbox=x=20:y=70:w=20:h=50:c=white:t=fill,drawbox=x=60:y=0:w=40:h=200:c=red:t=fill",
  );
  const work = join(root, "work");
  await mkdir(work);
  const clip: Clip = {
    id: "photo",
    assetId: source.id,
    timelineStart: 0,
    timelineDuration: 6,
    layout: { version: 2, preset: "contain", fill },
  };
  return { root, work, source, image, clip };
}
async function pixels(path: string, frame?: number) {
  return (
    await runProcess("ffmpeg", [
      "-v",
      "error",
      "-i",
      path,
      ...(frame === undefined ? [] : ["-vf", `select=eq(n\\,${frame})`]),
      "-frames:v",
      "1",
      "-pix_fmt",
      "rgb24",
      "-f",
      "rawvideo",
      "-",
    ])
  ).stdout;
}
const digest = (value: Uint8Array) =>
  createHash("sha256").update(value).digest("hex");

it("prepares raw centered cells once from verified bytes without baking the clip look", async () => {
  const { work, source, clip } = await fixture();
  const other = {
    ...clip,
    id: "other",
    look: { version: 1 as const, preset: "retro" as const, strength: 1 },
  };
  const prepared = await render.preparePhotoAmbientFills(
    [clip, other],
    [source],
    settings,
    work,
  );
  expect(prepared.assetOverrides.size).toBe(1);
  expect(prepared.fills.get("photo")).toEqual(prepared.fills.get("other"));
  expect(prepared.sources).toEqual([
    { assetId: source.id, sha256: source.contentHash },
  ]);
  const override = prepared.assetOverrides.get(source.id)!;
  expect(override.uri).not.toBe(source.uri);
  expect(await hashFile(localPath(override.uri))).toBe(source.contentHash);
  const rgb = await pixels(prepared.fills.get("photo")!.path);
  expect(rgb).toHaveLength(320 * 180 * 3);
  // Original corner is opaque #305090; dim applies once, no look or foreground.
  expect([...rgb.subarray(0, 3)]).toEqual([26, 44, 79]);
  await prepared.verifySources();
  await prepared.assertSourceIdentities();
  expect(await hashFile(localPath(source.uri))).toBe(source.contentHash);
});

it("keeps the diptych gap black and fails closed when a verified source changes", async () => {
  const { work, source, image, clip } = await fixture();
  const other = await image("green", "color=green:s=100x200");
  const prepared = await render.preparePhotoAmbientFills(
    [
      {
        ...clip,
        layout: {
          version: 2,
          preset: "diptych",
          gap: 8,
          fill,
          secondary: { assetId: other.id },
        },
      },
    ],
    [source, other],
    settings,
    work,
  );
  const rgb = await pixels(prepared.fills.get("photo")!.path);
  const at = (x: number) => [
    ...rgb.subarray((90 * 320 + x) * 3, (90 * 320 + x) * 3 + 3),
  ];
  expect(at(159)).toEqual([0, 0, 0]);
  expect(at(160)).toEqual([0, 0, 0]);
  expect(at(230)[1]).toBeGreaterThan(50);
  await writeFile(new URL(source.uri), "changed local original");
  await expect(prepared.verifySources()).rejects.toThrow(/chang/iu);
});

it("flattens only decorative fill alpha against black before darkening and leaves source bytes intact", async () => {
  const { work, image, clip } = await fixture();
  const half = await image(
    "half-alpha",
    "color=blue:s=64x64,format=rgba,colorchannelmixer=aa=0.5",
  );
  const sourceHash = await hashFile(localPath(half.uri));
  const prepared = await render.preparePhotoAmbientFills(
    [
      {
        ...clip,
        assetId: half.id,
        layout: {
          version: 2,
          preset: "contain",
          fill: { ...fill, blurSigma: 0 },
        },
      },
    ],
    [half],
    settings,
    work,
  );
  const rgb = await pixels(prepared.fills.get(clip.id)!.path);
  expect(rgb[0]).toBe(0);
  expect(rgb[1]).toBe(0);
  expect(Math.abs(rgb[2]! - 70)).toBeLessThanOrEqual(1);
  expect(await hashFile(localPath(half.uri))).toBe(sourceHash);
});

it("rejects budget, missing and cancelled fill work without replacing a completed render", async () => {
  const { root, work, source, clip } = await fixture();
  await expect(
    render.preparePhotoAmbientFills(
      [clip],
      [source],
      { width: 4096, height: 4096 },
      work,
    ),
  ).rejects.toThrow(/budget|limit/iu);
  const controller = new AbortController();
  controller.abort();
  await expect(
    render.preparePhotoAmbientFills([clip], [source], settings, work, {
      signal: controller.signal,
    }),
  ).rejects.toThrow(/cancel|abort/iu);
  const output = join(root, "previous.mp4");
  await writeFile(output, "completed output");
  await writeFile(`${output}.manifest.json`, "completed manifest");
  const invalid = { ...source, contentHash: "0".repeat(64) };
  const composition: Composition = {
    id: "film",
    storyId: "story",
    duration: 6,
    tracks: [{ id: "visual", type: "video", clips: [clip] }],
  };
  await expect(
    new render.FFmpegRenderer().render(
      composition,
      [invalid],
      output,
      settings,
    ),
  ).rejects.toThrow(/SHA-256|hash|chang/iu);
  expect(await readFile(output, "utf8")).toBe("completed output");
  expect(await readFile(`${output}.manifest.json`, "utf8")).toBe(
    "completed manifest",
  );
  expect(
    (await readdir(root)).some((name) => name.startsWith(".render-")),
  ).toBe(false);
});

it("renders six seconds of ambient custom motion with independent seek, edge and original hash evidence", async () => {
  const { root, work, source, clip } = await fixture();
  clip.motion = {
    version: 2,
    preset: "pan",
    easing: {
      version: 1,
      kind: "cubic-bezier",
      x1: 0.25,
      y1: 0.1,
      x2: 0.25,
      y2: 1,
    },
    from: { scale: 1.08, x: -6, y: 0 },
    to: { scale: 1.08, x: 6, y: 0 },
  };
  const before = structuredClone(clip);
  const sourceHash = await hashFile(localPath(source.uri));
  const composition: Composition = {
    id: "film",
    storyId: "story",
    duration: 6,
    tracks: [{ id: "visual", type: "video", clips: [clip] }],
  };
  const output = join(root, "ambient.mp4");
  await new render.FFmpegRenderer().render(
    composition,
    [source],
    output,
    settings,
  );
  const probe = JSON.parse(
    (
      await runProcess("ffprobe", [
        "-v",
        "error",
        "-count_frames",
        "-show_entries",
        "stream=nb_read_frames,width,height,r_frame_rate:format=duration",
        "-of",
        "json",
        output,
      ])
    ).stdout.toString(),
  );
  expect(probe.streams[0]).toMatchObject({
    width: 320,
    height: 180,
    r_frame_rate: "30/1",
    nb_read_frames: "180",
  });
  expect(Number(probe.format.duration)).toBe(6);
  const samples = new Map<number, string>();
  const edges: number[] = [];
  for (const frame of [0, 90, 179, 35, 140, 179, 0, 90]) {
    const rgb = await pixels(output, frame);
    const hash = digest(rgb);
    if (samples.has(frame)) expect(hash).toBe(samples.get(frame));
    samples.set(frame, hash);
    const white = Array.from({ length: 320 }, (_, x) => x).find(
      (x) =>
        rgb[(90 * 320 + x) * 3]! > 220 &&
        rgb[(90 * 320 + x) * 3 + 1]! > 220 &&
        rgb[(90 * 320 + x) * 3 + 2]! > 220,
    )!;
    const evaluated = evaluateClipAtTime(
      clip,
      frame / 30,
      { [source.id]: { width: 100, height: 200 } },
      settings,
    );
    // Source shape starts at normalized x=.2, fitted x=115 + 18 = 133.
    expect(
      Math.abs(
        white -
          (160 +
            (133 - 160) * evaluated.transform.scale +
            evaluated.transform.x),
      ),
    ).toBeLessThanOrEqual(1.5);
    edges.push(white);
    expect(rgb[(90 * 320 + 10) * 3 + 2]).toBeGreaterThan(30);
  }
  expect(edges[2]! - edges[0]!).toBeGreaterThan(8);
  expect(clip).toEqual(before);
  expect(await hashFile(localPath(source.uri))).toBe(sourceHash);
  const manifest = JSON.parse(
    await readFile(`${output}.manifest.json`, "utf8"),
  );
  expect(manifest.renderer.presentationVersion).toBe(2);
  expect(manifest.photoPresentation.bezierBisectionSteps).toBe(24);
  expect(manifest.photoPresentation.fills[0].sources).toEqual([
    { assetId: source.id, sha256: sourceHash },
  ]);
  expect(manifest.sources[0].sha256).toBe(sourceHash);
  const evidence = process.env.OPENFILM_PHOTO_FINISHING_QA_OUTPUT;
  if (evidence) {
    await mkdir(evidence, { recursive: true });
    await copyFile(output, join(evidence, "ambient.mp4"));
    await copyFile(
      `${output}.manifest.json`,
      join(evidence, "ambient.manifest.json"),
    );
    await copyFile(
      new URL(source.uri),
      join(evidence, "synthetic-portrait.png"),
    );
    const prepared = await render.preparePhotoAmbientFills(
      [clip],
      [source],
      settings,
      work,
    );
    await copyFile(
      prepared.fills.get(clip.id)!.path,
      join(evidence, "ambient-raw.png"),
    );
    await writeFile(
      join(evidence, "render-evidence.json"),
      JSON.stringify(
        {
          version: 1,
          sourceSha256: sourceHash,
          outputSha256: await hashFile(output),
          frameSha256: Object.fromEntries(samples),
          edges,
          probe,
          ffmpeg: (await runProcess("ffmpeg", ["-version"])).stdout
            .toString()
            .split("\n")[0],
        },
        null,
        2,
      ),
    );
  }
});
