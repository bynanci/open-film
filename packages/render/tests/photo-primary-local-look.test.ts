// SPDX-License-Identifier: Apache-2.0
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, expect, it } from "vitest";
import {
  applyPrimaryColorPixel,
  filmLookMatrix,
  primaryColorCoefficients,
  validatePresetPackage,
  type Clip,
  type Composition,
  type FilmLook,
  type MediaAsset,
  type PrimaryColorCorrection,
} from "@openfilm/core";
import { createPresetSnapshot } from "@openfilm/application";
import { inspectMedia, hashFile, runProcess } from "@openfilm/media";
import { FFmpegRenderer, preparePhotoAmbientFills } from "../src/index.js";
import { presetPackage } from "../../../tests/fixtures/local-presets/package.js";
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
const settings = { width: 320, height: 180, frameRate: 12 };
const correction: PrimaryColorCorrection = {
  version: 1,
  temperature: 0.8,
  exposureEv: 1.5,
  contrast: 0.7,
};
const coefficients = primaryColorCoefficients(correction);
async function pixels(path: string, frame = 0) {
  return (
    await runProcess("ffmpeg", [
      "-v",
      "error",
      "-i",
      path,
      "-vf",
      `select=eq(n\\,${frame})`,
      "-frames:v",
      "1",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "pipe:1",
    ])
  ).stdout;
}
const sample = (data: Buffer, width: number, x: number, y: number) => [
  ...data.subarray((y * width + x) * 3, (y * width + x) * 3 + 3),
];
function primary(rgb: number[]) {
  return applyPrimaryColorPixel(
    [rgb[0]!, rgb[1]!, rgb[2]!, 255],
    coefficients,
  ).slice(0, 3);
}
function look(rgb: number[], recipe: FilmLook) {
  const m = filmLookMatrix(recipe);
  return [0, 5, 10].map((i) =>
    Math.max(
      0,
      Math.min(
        255,
        rgb[0]! * m[i]! +
          rgb[1]! * m[i + 1]! +
          rgb[2]! * m[i + 2]! +
          255 * m[i + 3]!,
      ),
    ),
  );
}
const error = (a: number[], b: number[]) =>
  Math.max(...a.map((v, i) => Math.abs(v - b[i]!)));
it.each(["contain", "diptych", "moving-diptych"] as const)(
  "grades verified raw foreground and ambient once before a local Film Look, with ungraded transformed separators: %s",
  async (variant) => {
    const root = await mkdtemp(join(tmpdir(), "photo-primary-local-look-"));
    roots.push(root);
    const assets: MediaAsset[] = [];
    for (const [index, color] of ["0x5090c4", "0xb05030"].entries()) {
      const path = join(root, `source-${index}.png`);
      await runProcess("ffmpeg", [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        `color=c=${color}:s=80x180,format=rgb24`,
        "-frames:v",
        "1",
        "-threads",
        "1",
        path,
      ]);
      const asset = await inspectMedia({
        path,
        uri: pathToFileURL(path).href,
        name: `Synthetic portrait ${index}`,
      });
      asset.contentHash = await hashFile(path);
      assets.push(asset);
    }
    const pkg = presetPackage();
    Object.assign(pkg.entries[0]!.recipe, {
      matrix: [
        0.7, 0.2, 0, 0.12, 0, 0, 0.85, 0.1, -0.08, 0, 0.15, 0, 0.75, 0.06, 0, 0,
        0, 0, 1, 0,
      ],
    });
    const admitted = validatePresetPackage(pkg),
      entry = admitted.entries.find((e) => e.kind === "film-look")!;
    const localLook: FilmLook = {
      version: 2,
      preset: "local",
      strength: 1,
      snapshot: createPresetSnapshot<"film-look">(admitted, entry),
    };
    const diptych = variant !== "contain",
      moving = variant === "moving-diptych";
    const clip: Clip = {
      id: "photo",
      assetId: assets[0]!.id,
      timelineStart: 0,
      timelineDuration: 1,
      layout: {
        version: 2,
        preset: diptych ? "diptych" : "contain",
        fill: { version: 1, kind: "ambient", blurSigma: 0.02, dim: 0.45 },
        ...(diptych ? { gap: 16, secondary: { assetId: assets[1]!.id } } : {}),
      },
      ...(moving
        ? {
            transform: { x: 20 },
            motion: {
              version: 2,
              preset: "push-in",
              from: { scale: 1, x: 0, y: 0 },
              to: { scale: 1.06, x: 0, y: 0 },
              easing: {
                version: 1,
                kind: "cubic-bezier",
                x1: 0.42,
                y1: 0,
                x2: 0.58,
                y2: 1,
              },
            },
          }
        : {}),
    };
    const film: Composition = {
      id: "film",
      storyId: "story",
      duration: 1,
      defaultPrimaryColor: correction,
      defaultLook: localLook,
      tracks: [{ id: "picture", type: "video", clips: [clip] }],
    };
    const work = join(root, "raw");
    await mkdir(work);
    const raw = await preparePhotoAmbientFills([clip], assets, settings, work),
      fill = raw.fills.get(clip.id)!;
    const rawPixels = await pixels(fill.path),
      sourcePixels = await pixels(new URL(assets[0]!.uri).pathname);
    const output = join(root, "graded.mp4");
    await new FFmpegRenderer().render(film, assets, output, settings, {
      quality: "high-detail",
    });
    const observations: unknown[] = [],
      offset = moving ? 20 : 0;
    const regions = [
      {
        name: "ambient",
        x: diptych ? 12 : 20,
        raw: sample(rawPixels, 320, diptych ? 12 : 20, 90),
      },
      {
        name: "foreground",
        x: diptych ? 80 : 160,
        raw: sample(sourcePixels, 80, 40, 90),
      },
    ];
    if (diptych)
      regions.push({
        name: "secondary",
        x: 240,
        raw: sample(await pixels(new URL(assets[1]!.uri).pathname), 80, 40, 90),
      });
    for (const frame of [11, 0, 6]) {
      const actual = await pixels(output, frame);
      expect(await pixels(output, frame)).toEqual(actual);
      for (const region of regions) {
        const expected = look(primary(region.raw), localLook),
          observed = sample(actual, 320, region.x + offset, 90);
        expect(
          error(observed, expected),
          `${variant}/${region.name}/frame${frame}`,
        ).toBeLessThanOrEqual(3);
        // The same witnesses distinguish omitted/double primary and reversed stage order.
        for (const wrong of [
          look(region.raw, localLook),
          look(primary(primary(region.raw)), localLook),
          primary(look(region.raw, localLook)),
        ])
          expect(error(expected, wrong)).toBeGreaterThan(6);
        observations.push({
          frame,
          region: region.name,
          raw: region.raw,
          expected,
          observed,
        });
      }
      if (diptych) {
        expect(
          Math.max(...sample(actual, 320, 160 + offset, 90)),
        ).toBeLessThanOrEqual(3);
        if (moving)
          expect(Math.max(...sample(actual, 320, 160, 90))).toBeGreaterThan(20);
      }
    }
    await raw.verifySources();
    await raw.assertSourceIdentities();
    for (const asset of assets)
      expect(await hashFile(new URL(asset.uri).pathname)).toBe(
        asset.contentHash,
      );
    const manifest = JSON.parse(
      await readFile(`${output}.manifest.json`, "utf8"),
    );
    expect(manifest.photoPresentation.fills[0].sha256).toBe(fill.sha256);
    expect(
      manifest.presetSnapshots.some(
        (s: { snapshotSha256: string }) =>
          s.snapshotSha256 === localLook.snapshot.snapshotSha256,
      ),
    ).toBe(true);
    const evidence = process.env.OPENFILM_COMBINED_PHOTO_QA_OUTPUT;
    if (evidence) {
      await writeFile(
        join(root, "observations.json"),
        JSON.stringify(
          { variant, correction, look: localLook, observations },
          null,
          2,
        ),
      );
      await mkdir(evidence, { recursive: true });
      await cp(root, join(evidence, variant), { recursive: true });
    }
  },
);
