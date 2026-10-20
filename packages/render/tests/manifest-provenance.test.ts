// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, expect, it } from "vitest";
import {
  FILM_LOOK_PRESETS,
  FILM_LOOK_MATRIX_DOMAIN,
  FILM_LOOK_RECIPE_VERSION,
  FILM_LOOK_RECIPE_ORIGIN,
  FILM_LOOK_RECIPE_LICENSE,
  type MediaAsset,
} from "@openfilm/core";
import { runProcess } from "@openfilm/media";
import {
  canonicalRenderFontBindings,
  captureRenderSources,
  writeRenderManifest,
  type RenderFontBinding,
} from "../src/manifest.js";
import { FFmpegRenderer } from "../src/index.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "openfilm-manifest-provenance-"));
  roots.push(root);
  const path = join(root, "source.bin");
  await writeFile(path, "catalog source bytes; no probing required");
  const asset: MediaAsset = {
    id: "source",
    uri: pathToFileURL(path).href,
    name: "source.bin",
    mediaType: "video",
    tags: [],
    state: {},
    metadata: {},
  };
  return { root, path, asset };
}
it("retains distinct font uses across namespaces and delimiter-bearing identifiers", () => {
  const font = {
    family: "Sans",
    postscriptName: "Sans-Regular",
    sha256: "a".repeat(64),
  };
  const bindings: RenderFontBinding[] = [
    { ...font, usage: ["title", "track:clip", "id"] },
    { ...font, usage: ["title", "track", "clip:id"] },
    { ...font, usage: ["caption", "track:clip", "id"] },
    { ...font, usage: ["graphic", "track:clip", "id"] },
  ];
  expect(canonicalRenderFontBindings([...bindings].reverse())).toEqual([
    bindings[2],
    bindings[3],
    bindings[1],
    bindings[0],
  ]);
  expect(bindings.map((binding) => binding.usage.join(":"))).toEqual([
    "title:track:clip:id",
    "title:track:clip:id",
    "caption:track:clip:id",
    "graphic:track:clip:id",
  ]);
  expect(() =>
    canonicalRenderFontBindings([
      bindings[0]!,
      { ...bindings[0]!, sha256: "b".repeat(64) },
    ]),
  ).toThrow(/conflicting font usage bindings/u);
  expect(() =>
    canonicalRenderFontBindings([
      { ...font, usage: ["title", "track"] } as unknown as RenderFontBinding,
    ]),
  ).toThrow(/invalid font usage binding/u);
});
it("rejects a direct renderer crop snapshot with only legacy font-set evidence", async () => {
  const { root } = await fixture();
  const composition = { id: "film", storyId: "story", duration: 1, tracks: [] };
  const settings = { width: 160, height: 90, frameRate: 12 };
  const sha = (value: unknown) =>
    createHash("sha256").update(JSON.stringify(value)).digest("hex");
  await expect(
    new FFmpegRenderer().render(
      composition,
      [],
      join(root, "legacy.mp4"),
      settings,
      {
        snapshot: {
          compositionSha256: sha(composition),
          settingsSha256: sha(settings),
          assetsSha256: sha([]),
          fonts: [],
          assertCurrent() {},
        },
      },
    ),
  ).rejects.toThrow(/no font usage bindings/u);
  expect(await readdir(root)).toEqual(["source.bin"]);
});
it("records original recipe provenance, a reproducible registry digest and the actual FFmpeg build", async () => {
  const { root, path, asset } = await fixture();
  const manifestPath = join(root, "manifest.json");
  await writeRenderManifest(
    manifestPath,
    path,
    { id: "film", storyId: "story", duration: 1, tracks: [] },
    { width: 160, height: 90, frameRate: 30 },
    await captureRenderSources([asset]),
    [],
    [],
  );
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const registry = FILM_LOOK_PRESETS.map(({ id, matrix }) => ({ id, matrix }));
  // The hash payload has fixed, alphabetically ordered keys at every object level.
  const canonicalRegistry = JSON.stringify({
    matrixDomain: FILM_LOOK_MATRIX_DOMAIN,
    registry,
    registryVersion: FILM_LOOK_RECIPE_VERSION,
  });
  expect(manifest.looks).toMatchObject({
    matrixSpace: "encoded-sdr-rgb",
    recipeOrigin: FILM_LOOK_RECIPE_ORIGIN,
    recipeLicense: FILM_LOOK_RECIPE_LICENSE,
    registrySha256: createHash("sha256")
      .update(canonicalRegistry)
      .digest("hex"),
    pipeline: {
      decodeTransfer: "retained",
      transferConversion: "none-additional",
      hdrToneMapping: {
        operator: "hable",
        output: "bt709",
        stage: "before-look-matrix",
      },
      matrixPixelFormat: "rgba8",
      rgbClamp: "after-matrix",
      rgbLift: "coefficient-times-source-alpha",
      alpha: "preserved",
      browserSourcePreview: "approximate",
      renderedOutput: "authoritative",
    },
  });
  const lines = (await runProcess("ffmpeg", ["-version"])).stdout
    .toString("utf8")
    .split(/\r?\n/u)
    .map((line) => line.trim());
  expect(manifest.renderer.ffmpegVersion).toBe(lines[0]);
  expect(manifest.renderer.ffmpegConfiguration).toBe(
    lines.find((line) => line.startsWith("configuration:")) ?? null,
  );
  expect(manifest.renderer.ffmpegLibraries).toEqual(
    lines.filter((line) => /^lib\w+\s+\d/u.test(line)),
  );
  expect(manifest.renderer.ffmpegLibraries.length).toBeGreaterThan(0);
});
it("preserves only explicit catalog color fields and represents unknown values with null", async () => {
  const { asset } = await fixture();
  const known = {
    ...asset,
    hdr: true,
    metadata: {
      "openfilm.color": {
        hdr: true,
        primaries: "bt2020",
        transfer: "smpte2084",
        matrix: "bt2020nc",
        range: "tv",
        pixelFormat: "yuv420p10le",
        bitDepth: 10,
        extraPrivateField: "omit-me",
      },
    },
  };
  const catalog = structuredClone(known);
  const [source] = await captureRenderSources([known]);
  expect(source).toHaveProperty("catalogColorMetadata", {
    hdr: true,
    primaries: "bt2020",
    transfer: "smpte2084",
    matrix: "bt2020nc",
    range: "tv",
    pixelFormat: "yuv420p10le",
    bitDepth: 10,
  });
  expect(known).toEqual(catalog);
  const [unknown] = await captureRenderSources([asset]);
  expect(unknown).toHaveProperty("catalogColorMetadata", {
    hdr: null,
    primaries: null,
    transfer: null,
    matrix: null,
    range: null,
    pixelFormat: null,
    bitDepth: null,
  });
  const [malformed] = await captureRenderSources([
    {
      ...asset,
      metadata: {
        "openfilm.color": {
          hdr: "false",
          primaries: 123,
          transfer: {},
          matrix: [],
          range: null,
          pixelFormat: "gbrp",
          bitDepth: Number.NaN,
        },
      },
    },
  ]);
  expect(malformed).toHaveProperty("catalogColorMetadata", {
    hdr: null,
    primaries: null,
    transfer: null,
    matrix: null,
    range: null,
    pixelFormat: "gbrp",
    bitDepth: null,
  });
});
