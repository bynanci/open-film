import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  applySilenceCutProposal,
  buildAudioMixPlan,
  createSilenceCutProposal,
  createExportProfile,
  mapAudioAutomationForClipWindow,
  resolveProjectTimebase,
  resolveClipFrameRange,
  type Composition,
  type Clip,
  type CoverageAudioBindingV1,
} from "@openfilm/core";
import { hashFile, inspectCanonicalAudio, runProcess } from "@openfilm/media";
import { applyTimelineCommand } from "@openfilm/solver";
import {
  FFmpegRenderer,
  audioSourceAssetIds,
  compileAudioMixPlan,
  measureAudioOutput,
} from "../src/index.js";
import {
  toneSource,
  decodePolicyAudio,
  spectralAmplitude,
  firstAudibleSample,
  recordPolicyEvidence,
} from "../../../tests/fixtures/audio-policy.js";
const timebase = resolveProjectTimebase({
  width: 160,
  height: 90,
  frameRate: 30,
});
const settings = { width: 160, height: 90, frameRate: 30, timebase };
const profile = createExportProfile({
  ratio: "16:9",
  width: 160,
  height: 90,
  frameRate: 30,
  format: "wav",
});
const clean: string[] = [];
afterEach(async () => {
  for (const path of clean.splice(0))
    await rm(path, { recursive: true, force: true });
});
async function root() {
  const path = await mkdtemp(join(tmpdir(), "openfilm-audio-policy-"));
  clean.push(path);
  return path;
}
const clip = (id: string, assetId: string, start = 0, duration = 12): Clip => ({
  id,
  assetId,
  timelineStart: start,
  timelineDuration: duration,
  sourceIn: 0,
  sourceOut: duration,
});
const comp = (...clips: Clip[]): Composition => ({
  id: "cut",
  storyId: "s",
  duration: 12,
  tracks: [{ id: "v", type: "video", clips }],
});
const binding = (
  mode: "keep-primary" | "mix-secondary" | "replace-primary",
  id = "b",
  start = 4,
  end = 6,
): CoverageAudioBindingV1 => ({
  version: 1,
  bindingId: id,
  compositionId: "cut",
  primaryClipId: "p",
  secondaryClipId: "s",
  startSample: start * 48000,
  endSample: end * 48000,
  policy:
    mode === "keep-primary"
      ? { version: 1, mode }
      : { version: 1, mode, role: "ambience", gain: 0.5 },
});
const renderer = new FFmpegRenderer();
async function wav(
  path: string,
  composition: Composition,
  assets: Parameters<typeof renderer.render>[1],
  coverage: CoverageAudioBindingV1[] = [],
  role?: "dialogue" | "ambience" | "music",
) {
  const sources = await Promise.all(
    assets.map(async (asset) => ({
      assetId: asset.id,
      sha256: await hashFile(fileURLToPath(asset.uri)),
    })),
  );
  await renderer.render(composition, assets, path, settings, {
    audioOnly: true,
    exportProfile: profile,
    ...(coverage.length ? { audioMixContext: { timebase, coverage } } : {}),
    ...(role ? { audioRole: role } : {}),
  });
  const decoded = await decodePolicyAudio(path);
  for (const source of sources)
    expect(
      await hashFile(
        fileURLToPath(assets.find((a) => a.id === source.assetId)!.uri),
      ),
    ).toBe(source.sha256);
  await recordPolicyEvidence(`render-${basename(path).replace(/\W+/g, "-")}`, {
    command:
      "FFmpegRenderer.render(composition, assets, path, settings, options)",
    composition,
    settings,
    options: { audioOnly: true, exportProfile: profile, coverage, role },
    sources,
    encodedSha256: await hashFile(path),
    decodedPcmSha256: decoded.sha256,
    decodedFrames: decoded.samples.length / 2,
    manifest: JSON.parse(await readFile(`${path}.manifest.json`, "utf8")),
  });
  return decoded;
}

describe("shared audio graph", () => {
  it("keeps every canonical 1x pulse phase within one sample of one common impulse baseline", async () => {
    const dir = await root(),
      positions = [9600, 28800, 48000, 54000, 102000, 124800, 177600],
      source = await toneSource(
        dir,
        "independent-pulses",
        0,
        4,
        48000,
        2,
        positions,
      ),
      baselineSource = await toneSource(
        dir,
        "common-impulse",
        0,
        4,
        48000,
        2,
        true,
      );
    const configured = (id: string, assetId: string, start = 0) => ({
      ...clip(id, assetId, 0, 4),
      audioTiming: {
        version: 1 as const,
        sampleRate: 48000 as const,
        timelineStartSample: start,
        sourceInSample: 0,
        sourceOutSample: 192000,
      },
    });
    const baseline = await wav(
      join(dir, "common-latency.wav"),
      comp(configured("baseline", baselineSource.id)),
      [baselineSource],
    );
    const delay = firstAudibleSample(baseline.samples);
    expect(delay).toBeGreaterThanOrEqual(0);
    const result = await wav(
      join(dir, "phases.wav"),
      comp(configured("phases", source.id, 816)),
      [source],
    );
    const actual: number[] = [];
    for (let n = 0; n < result.samples.length / 2; n++)
      if (
        Math.abs(result.samples[n * 2]!) > 0.05 &&
        (n === 0 || Math.abs(result.samples[(n - 1) * 2]!) <= 0.05)
      )
        actual.push(n);
    expect(actual).toHaveLength(positions.length);
    for (const [index, position] of positions.entries())
      expect(
        Math.abs(actual[index]! - (position + 816 + delay)),
      ).toBeLessThanOrEqual(1);
    await recordPolicyEvidence("canonical-pulse-phases", {
      delay,
      positions,
      actual,
      errors: positions.map(
        (position, index) => actual[index]! - (position + 816 + delay),
      ),
    });
    expect(await hashFile(fileURLToPath(source.uri))).toBe(source.contentHash);
  });
  it("compiles one canonical source/tempo/effect branch before sample segmentation", async () => {
    const dir = await root(),
      asset = await toneSource(dir, "source", 440),
      p = clip("p", asset.id),
      s = clip("s", asset.id);
    p.audioTiming = {
      version: 1,
      sampleRate: 48000,
      timelineStartSample: 1,
      sourceInSample: 0,
      sourceOutSample: 480000,
    };
    p.audioAutomation = {
      version: 1,
      role: "dialogue",
      fadeIn: 2,
      points: [
        { time: 0, gain: 0.2 },
        { time: 10, gain: 0.8 },
      ],
    };
    const composition = comp(p, s),
      plan = buildAudioMixPlan(composition, [asset], {
        timebase,
        coverage: [
          binding("replace-primary"),
          binding("replace-primary", "b2", 8, 9),
        ],
      }),
      graph = compileAudioMixPlan(
        plan,
        composition,
        new Map([
          ["p", 0],
          ["s", 1],
        ]),
      ),
      text = graph.filters.join(";");
    expect(
      text.match(/aresample=48000:async=1:min_hard_comp=0:first_pts=0/g),
    ).toHaveLength(1);
    // The legacy occurrence retains its exact processor domain; canonical 1x
    // does not run phase-changing time stretch.
    expect(text.match(/atempo=1/g)).toHaveLength(1);
    expect(text.match(/afade=t=in/g)).toHaveLength(1);
    expect(text).toContain("atrim=start_sample=0:end_sample=480000");
    expect(text).toContain("[0:a:0]aresample");
    expect(text).toContain("asplit=3");
    expect(text).toContain("adelay=288000S:all=1");
    expect(graph.labels).toHaveLength(5);
  });
  it("keeps the legacy graph output and manifests unchanged when fields are absent", async () => {
    const dir = await root(),
      asset = await toneSource(dir, "legacy", 440, 3),
      composition = comp(clip("p", asset.id, 0.017, 2));
    const path = join(dir, "legacy-output.wav"),
      actual = await wav(path, composition, [asset]);
    const reference = join(dir, "reference.wav");
    await runProcess("ffmpeg", [
      "-v",
      "error",
      "-i",
      fileURLToPath(asset.uri),
      "-af",
      "atrim=start=0:end=2,asetpts=PTS-STARTPTS,atempo=1,volume=1,apad,atrim=duration=2,adelay=17:all=1,amix=inputs=1:duration=longest:normalize=0,alimiter=limit=0.95,apad,atrim=duration=12",
      "-c:a",
      "pcm_s24le",
      "-ar",
      "48000",
      "-ac",
      "2",
      reference,
    ]);
    expect(actual.samples).toEqual(
      (await decodePolicyAudio(reference)).samples,
    );
    expect(
      JSON.parse(await readFile(`${path}.manifest.json`, "utf8")),
    ).not.toHaveProperty("audioPolicy");
  });
  it("replaces only the named primary windows before stem selection with no double gain", async () => {
    const dir = await root(),
      primary = await toneSource(dir, "primary", 440),
      secondary = await toneSource(dir, "secondary", 880),
      music = await toneSource(dir, "music", 1320),
      p = clip("p", primary.id),
      s = { ...clip("s", secondary.id), transform: { volume: 0.2 } },
      m = {
        ...clip("m", music.id),
        audioAutomation: { version: 1 as const, role: "music" as const },
      };
    const composition = comp(p, s, m),
      coverage = [
        binding("replace-primary"),
        binding("replace-primary", "b2", 8, 9),
      ],
      context = { timebase, coverage };
    expect([
      ...audioSourceAssetIds(
        composition,
        [primary, secondary, music],
        "ambience",
        context,
      ),
    ]).toEqual([secondary.id]);
    const output = await wav(
        join(dir, "replace.wav"),
        composition,
        [primary, secondary, music],
        coverage,
      ),
      stem = await wav(
        join(dir, "dialogue.wav"),
        composition,
        [primary, secondary, music],
        coverage,
        "dialogue",
      ),
      solo = await wav(
        join(dir, "solo.wav"),
        comp(clip("solo", secondary.id)),
        [secondary],
      );
    const control = spectralAmplitude(solo.samples, 880, 4.3);
    expect(
      20 * Math.log10(spectralAmplitude(output.samples, 880, 4.3) / control),
    ).toBeCloseTo(20 * Math.log10(0.5), 1);
    expect(spectralAmplitude(output.samples, 440, 4.3) / control).toBeLessThan(
      10 ** (-45 / 20),
    );
    expect(
      spectralAmplitude(output.samples, 1320, 4.3) / control,
    ).toBeGreaterThan(0.95);
    expect(spectralAmplitude(stem.samples, 440, 4.3) / control).toBeLessThan(
      10 ** (-45 / 20),
    );
    expect(spectralAmplitude(stem.samples, 440, 6.3) / control).toBeGreaterThan(
      0.95,
    );
    expect(spectralAmplitude(output.samples, 880, 6.3) / control).toBeLessThan(
      10 ** (-45 / 20),
    );
    const manifest = JSON.parse(
      await readFile(join(dir, "replace.wav.manifest.json"), "utf8"),
    );
    expect(manifest.audioPolicy).toMatchObject({
      version: 1,
      sampleRate: 48000,
      planSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    for (const asset of [primary, secondary, music])
      expect(await hashFile(fileURLToPath(asset.uri))).toBe(asset.contentHash);
  });
  it("uses sample J/L onsets and leaves rational picture cut frames unchanged", async () => {
    const dir = await root(),
      a = await toneSource(dir, "a", 440),
      b = await toneSource(dir, "b", 880),
      pulse = await toneSource(dir, "pulse", 0, 1, 48000, 2, true);
    const baseline = await wav(
        join(dir, "baseline.wav"),
        comp(clip("pulse", pulse.id, 0, 1)),
        [pulse],
      ),
      delay = firstAudibleSample(baseline.samples);
    const p = {
        ...clip("p", a.id, 0, 6),
        audioTiming: {
          version: 1 as const,
          sampleRate: 48000 as const,
          timelineStartSample: 0,
          sourceInSample: 0,
          sourceOutSample: 312000,
        },
      },
      s = {
        ...clip("s", b.id, 6, 6),
        sourceIn: 1,
        sourceOut: 7,
        audioTiming: {
          version: 1 as const,
          sampleRate: 48000 as const,
          timelineStartSample: 252001,
          sourceInSample: 12000,
          sourceOutSample: 335999,
        },
      };
    const actual = await wav(join(dir, "jl.wav"), comp(p, s), [a, b]);
    const secondaryOnly = await wav(join(dir, "j-only.wav"), comp(s), [b]);
    expect(
      Math.abs(firstAudibleSample(secondaryOnly.samples) - delay - 252001),
    ).toBeLessThanOrEqual(1);
    expect(actual.samples.length).toBe(12 * 48000 * 2);
    for (const timebase of [
      settings.timebase,
      { ...settings.timebase, rateNumerator: 30000, rateDenominator: 1001 },
    ])
      expect(resolveClipFrameRange(s, timebase).startFrame).toBe(180);
  });
  it("rejects actual short handles before publication despite optimistic metadata", async () => {
    const dir = await root(),
      asset = await toneSource(dir, "short", 440, 1),
      p = clip("p", asset.id, 0, 1);
    p.audioTiming = {
      version: 1,
      sampleRate: 48000,
      timelineStartSample: 0,
      sourceInSample: 0,
      sourceOutSample: 96000,
    };
    asset.duration = 20;
    const path = join(dir, "invalid.wav");
    await expect(wav(path, comp(p), [asset])).rejects.toThrow(/handle|source/i);
    await expect(readFile(path)).rejects.toThrow();
  });
});

it.each([0.5, 1, 2])(
  "matches the canonical source/tempo reference for 44.1 kHz AAC priming and a 125ms delayed stream at speed %s",
  async (speed) => {
    const dir = await root(),
      source = await toneSource(dir, "44100", 880, 4, 44100, 1),
      aac = join(dir, "primed.m4a"),
      delayed = join(dir, "delayed.mp4");
    await runProcess("ffmpeg", [
      "-v",
      "error",
      "-i",
      fileURLToPath(source.uri),
      "-c:a",
      "aac",
      aac,
    ]);
    await runProcess("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=s=160x90:r=30:d=5",
      "-itsoffset",
      "0.125",
      "-i",
      fileURLToPath(source.uri),
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-c:v",
      "libx264",
      "-threads",
      "1",
      "-c:a",
      "aac",
      delayed,
    ]);
    for (const [name, path] of [
      ["aac", aac],
      ["delayed", delayed],
    ]) {
      const asset = {
        ...source,
        id: name!,
        uri: new URL(`file://${path}`).href,
        mediaType: name === "delayed" ? ("video" as const) : ("audio" as const),
        contentHash: await hashFile(path!),
      };
      const facts = await inspectCanonicalAudio(asset);
      expect(facts.lengthSamples).toBeGreaterThan(148801);
      const p = clip("p", asset.id, 0, 3);
      p.transform = { speed };
      p.audioTiming = {
        version: 1,
        sampleRate: 48000,
        timelineStartSample: 817,
        sourceInSample: 4801,
        sourceOutSample: 100801,
      };
      const actual = await wav(
          join(dir, `${name}-${speed}-actual.wav`),
          comp(p),
          [{ ...asset, metadata: { "openfilm.ffprobe": facts.probe } }],
        ),
        reference = join(dir, `${name}-${speed}-reference.wav`),
        length = Math.round(96000 / speed);
      await runProcess("ffmpeg", [
        "-v",
        "error",
        "-i",
        path!,
        "-map",
        "0:a:0",
        "-af",
        `aresample=48000:async=1:min_hard_comp=0:first_pts=0,atrim=start_sample=4801:end_sample=100801,asetpts=PTS-STARTPTS,${speed === 1 ? "" : `atempo=${speed},`}apad,atrim=end_sample=${length},volume=1,adelay=817S:all=1,amix=inputs=1:duration=longest:normalize=0,alimiter=limit=0.95,apad,atrim=duration=12`,
        "-c:a",
        "pcm_s24le",
        "-ar",
        "48000",
        "-ac",
        "2",
        reference,
      ]);
      const expected = await decodePolicyAudio(reference);
      let error = 0;
      for (let i = 0; i < actual.samples.length; i++)
        error = Math.max(
          error,
          Math.abs(actual.samples[i]! - expected.samples[i]!),
        );
      expect(error).toBeLessThanOrEqual(2 / 2 ** 23);
    }
  },
);

it("renders actual AAC MP4 with all three coverage policies, preserving automation phase and unrelated music", async () => {
  const dir = await root(),
    a = await toneSource(dir, "primary", 440),
    b = await toneSource(dir, "secondary", 880),
    m = await toneSource(dir, "music", 1320),
    p = clip("p", a.id),
    s = clip("s", b.id),
    music = {
      ...clip("m", m.id),
      audioAutomation: { version: 1 as const, role: "music" as const },
    };
  p.audioAutomation = {
    version: 1,
    role: "dialogue",
    fadeIn: 3,
    points: [
      { time: 0, gain: 0.3 },
      { time: 12, gain: 0.9 },
    ],
    ducking: [{ start: 5, end: 8, gain: 0.4, attack: 0.2, release: 0.2 }],
  };
  const primaryControl = await wav(join(dir, "primary-control.wav"), comp(p), [
      a,
    ]),
    solo = await wav(
      join(dir, "secondary-control.wav"),
      comp(clip("solo", b.id)),
      [b],
    ),
    level = spectralAmplitude(solo.samples, 880, 4.3);
  for (const mode of [
    "keep-primary",
    "mix-secondary",
    "replace-primary",
  ] as const) {
    const coverage = [binding(mode), binding(mode, "b2", 8, 9)],
      composition = comp(p, s, music),
      path = join(dir, `${mode}.mp4`);
    await renderer.render(composition, [a, b, m], path, settings, {
      audioMixContext: { timebase, coverage },
    });
    const decoded = await decodePolicyAudio(path),
      dialogue = await wav(
        join(dir, `${mode}-dialogue.wav`),
        composition,
        [a, b, m],
        coverage,
        "dialogue",
      );
    await recordPolicyEvidence(`mp4-${mode}`, {
      composition,
      settings,
      coverage,
      encodedSha256: await hashFile(path),
      decodedPcmSha256: decoded.sha256,
      manifest: JSON.parse(await readFile(`${path}.manifest.json`, "utf8")),
    });
    for (const start of [2.3, 4.3, 6.3, 8.3, 10.3]) {
      const covered = start === 4.3 || start === 8.3,
        secondaryExpected = covered && mode !== "keep-primary",
        primaryExpected = !(covered && mode === "replace-primary");
      const secondaryRatio =
        spectralAmplitude(decoded.samples, 880, start) / level;
      if (secondaryExpected)
        expect(
          Math.abs(20 * Math.log10(secondaryRatio / 0.5)),
        ).toBeLessThanOrEqual(0.5);
      else expect(secondaryRatio).toBeLessThanOrEqual(10 ** (-45 / 20));
      expect(
        Math.abs(
          20 *
            Math.log10(spectralAmplitude(decoded.samples, 1320, start) / level),
        ),
      ).toBeLessThanOrEqual(0.5);
      if (primaryExpected)
        expect(
          Math.abs(
            20 *
              Math.log10(
                spectralAmplitude(dialogue.samples, 440, start) /
                  spectralAmplitude(primaryControl.samples, 440, start),
              ),
          ),
        ).toBeLessThanOrEqual(0.5);
      else
        expect(
          spectralAmplitude(dialogue.samples, 440, start) / level,
        ).toBeLessThanOrEqual(10 ** (-45 / 20));
    }
  }
});

it("preserves transient PCM and the original sub-ms origin through repeated fractional splits", async () => {
  const dir = await root(),
    source = await toneSource(
      dir,
      "fractional-splits",
      0,
      5,
      48000,
      2,
      [7000, 12000, 17000, 22000, 27000, 35000, 65000, 90000, 130000, 170000],
    ),
    sourceIn = 0.1234567,
    start = 0.00137,
    original: Composition = {
      id: "cut",
      storyId: "s",
      duration: 3.1,
      tracks: [
        {
          id: "audio",
          type: "audio",
          clips: [
            {
              ...clip("voice", source.id, start, 3),
              sourceIn,
              sourceOut: sourceIn + 3.75,
              transform: { speed: 1.25 },
              audioAutomation: {
                version: 1,
                role: "dialogue",
                fadeIn: 0.4,
                fadeOut: 0.7,
              },
            },
          ],
        },
      ],
    };
  let document: Parameters<typeof applyTimelineCommand>[0] = {
    story: { id: "s", title: "Synthetic", beats: [] },
    composition: original,
  };
  for (const local of [0.10001, 0.20002, 0.30003, 0.40004, 0.9876536]) {
    const target = document.composition.tracks[0]!.clips.find(
      (item) =>
        item.timelineStart < start + local &&
        item.timelineStart + item.timelineDuration > start + local,
    )!;
    document = applyTimelineCommand(
      document,
      [source],
      {
        type: "clip.split",
        clipId: target.id,
        sourceTime: sourceIn + local * 1.25,
      },
      { origin: "direct", timebase },
    );
  }
  const before = await wav(join(dir, "fractional-before.wav"), original, [
      source,
    ]),
    after = await wav(join(dir, "fractional-after.wav"), document.composition, [
      source,
    ]);
  expect(after.samples).toHaveLength(before.samples.length);
  let maximumError = 0;
  for (let index = 0; index < before.samples.length; index++)
    maximumError = Math.max(
      maximumError,
      Math.abs(after.samples[index]! - before.samples[index]!),
    );
  expect(maximumError).toBeLessThanOrEqual(2 / 2 ** 23);
});

it("rejects fractional source and placement spans before compiling a stale mix plan", async () => {
  const dir = await root(),
    source = await toneSource(dir, "fractional-conflict", 440, 6),
    originalClip: Clip = {
      ...clip("voice", source.id, 0, 4),
      sourceOut: 5.2,
      transform: { speed: 1.3 },
      audioAutomation: { version: 1, role: "dialogue", fadeIn: 0.5 },
    },
    original = comp(originalClip),
    plan = buildAudioMixPlan(original, [source], { timebase, coverage: [] }),
    start = 0.2 / 1.3,
    removedEnd = 0.4 / 1.3,
    unsafe = comp({
      ...originalClip,
      timelineStart: start,
      sourceIn: 0.4,
      timelineDuration: 4 - removedEnd,
      audioAutomation: mapAudioAutomationForClipWindow(
        originalClip,
        removedEnd,
        4 - removedEnd,
      ),
    });
  expect(() =>
    buildAudioMixPlan(unsafe, [source], { timebase, coverage: [] }),
  ).toThrowError(
    expect.objectContaining({ code: "timeline.audioAutomationConflict" }),
  );
  expect(() =>
    compileAudioMixPlan(plan, unsafe, new Map([["voice", 0]])),
  ).toThrowError(
    expect.objectContaining({ code: "timeline.audioAutomationConflict" }),
  );
});

it("rejects independent timing added to a mapped composition or an already prepared mix plan", async () => {
  const dir = await root(),
    source = await toneSource(dir, "mixed-clock", 440, 2),
    original = comp({
      ...clip("voice", source.id, 0, 2),
      audioAutomation: { version: 1, role: "dialogue", fadeIn: 0.2 },
    }),
    mapped = applyTimelineCommand(
      {
        story: { id: "s", title: "Synthetic", beats: [] },
        composition: original,
      },
      [source],
      { type: "clip.split", clipId: "voice", sourceTime: 1 },
      { origin: "direct", timebase },
    ).composition,
    plan = buildAudioMixPlan(mapped, [source], { timebase, coverage: [] });
  mapped.tracks[0]!.clips[0]!.audioTiming = {
    version: 1,
    sampleRate: 48000,
    timelineStartSample: 12000,
    sourceInSample: 12000,
    sourceOutSample: 48000,
  };
  expect(() =>
    buildAudioMixPlan(mapped, [source], { timebase, coverage: [] }),
  ).toThrow(/independent sound timing/);
  expect(() =>
    compileAudioMixPlan(
      plan,
      mapped,
      new Map(mapped.tracks[0]!.clips.map((item, index) => [item.id, index])),
    ),
  ).toThrow(/verified source and DSP clock/);
});

it.each([44100, 48000])(
  "preserves legacy 1x transient PCM through direct split and reviewed ripple at %i Hz",
  async (sampleRate) => {
    const dir = await root(),
      source = await toneSource(
        dir,
        "legacy-split-pulses",
        0,
        2,
        sampleRate,
        2,
        [0.1, 0.2, 0.25, 0.3, 0.5, 0.75, 1.25, 1.5, 1.75].map((time) =>
          Math.round(time * sampleRate),
        ),
      ),
      originalClip: Clip = {
        ...clip("voice", source.id, 0, 2),
        audioAutomation: {
          version: 1,
          role: "dialogue",
          fadeIn: 0.2,
          fadeOut: 0.3,
          points: [
            { time: 0, gain: 0.8 },
            { time: 2, gain: 0.4 },
          ],
        },
      },
      original: Composition = {
        id: "cut",
        storyId: "s",
        duration: 2,
        tracks: [{ id: "audio", type: "audio", clips: [originalClip] }],
      },
      split = applyTimelineCommand(
        {
          story: { id: "s", title: "Synthetic", beats: [] },
          composition: original,
        },
        [source],
        { type: "clip.split", clipId: "voice", sourceTime: 1 },
        { origin: "direct", timebase },
      ).composition,
      proposal = createSilenceCutProposal(
        original,
        {
          version: 1,
          assetId: source.id,
          sourceHash: source.contentHash!,
          duration: 2,
          sampleRate: 48000,
          windowSeconds: 0.02,
          audioStreamIndex: 0,
          parameters: { thresholdDb: -40, minimumSilenceSeconds: 0.2 },
          silenceIntervals: [{ start: 0.8, end: 1.2 }],
          provenance: {
            providerId: "synthetic-test",
            version: "1",
            sourceHash: source.contentHash!,
            createdAt: "2026-11-05T00:00:00Z",
          },
        },
        { baseRevision: "legacy-clock", paddingSeconds: 0, assets: [source] },
      ),
      ripple = applySilenceCutProposal(original, proposal, {
        assets: [source],
        timebase,
      }),
      before = await wav(join(dir, "legacy-original.wav"), original, [source]),
      splitPcm = await wav(join(dir, "legacy-split.wav"), split, [source]),
      ripplePcm = await wav(join(dir, "legacy-ripple.wav"), ripple, [source]);
    expect(splitPcm.samples).toHaveLength(before.samples.length);
    let splitError = 0;
    for (let index = 0; index < before.samples.length; index++)
      splitError = Math.max(
        splitError,
        Math.abs(splitPcm.samples[index]! - before.samples[index]!),
      );
    expect(splitError).toBeLessThanOrEqual(2 / 2 ** 23);
    const expected = [
      ...before.samples.slice(0, 38400 * 2),
      ...before.samples.slice(57600 * 2),
    ];
    expect(ripplePcm.samples).toHaveLength(expected.length);
    let rippleError = 0;
    for (let index = 0; index < expected.length; index++) {
      const sample = Math.floor(index / 2);
      if (sample >= 38400 && sample < 38400 + 242) continue;
      rippleError = Math.max(
        rippleError,
        Math.abs(ripplePcm.samples[index]! - expected[index]!),
      );
    }
    expect(rippleError).toBeLessThanOrEqual(2 / 2 ** 23);
  },
);

it.each([44100, 48000])(
  "keeps the full render audio sample mapping through an automated silence ripple at %i Hz",
  async (sampleRate) => {
    const dir = await root(),
      source = await toneSource(
        dir,
        `ripple-${sampleRate}`,
        440,
        10,
        sampleRate,
      ),
      originalClip: Clip = {
        ...clip("voice", source.id, 0, 8),
        sourceOut: 10,
        transform: { speed: 1.25 },
        audioAutomation: {
          version: 1,
          role: "dialogue",
          fadeIn: 2.5,
          fadeOut: 3,
          points: [
            { time: 0, gain: 0.8 },
            { time: 4, gain: 0.3 },
            { time: 8, gain: 0.95 },
          ],
          ducking: [
            {
              start: 0.5,
              end: 4.25,
              gain: 0.4,
              attack: 1,
              release: 0.75,
            },
            { start: 4, end: 7.5, gain: 0.7, attack: 0.25, release: 1 },
          ],
        },
      },
      beforeComposition: Composition = {
        id: "cut",
        storyId: "s",
        duration: 8,
        tracks: [{ id: "audio", type: "audio", clips: [originalClip] }],
      },
      evidence = {
        version: 1 as const,
        assetId: source.id,
        sourceHash: source.contentHash!,
        duration: 10,
        sampleRate: 48000 as const,
        windowSeconds: 0.02 as const,
        audioStreamIndex: 0,
        parameters: { thresholdDb: -40, minimumSilenceSeconds: 1 },
        silenceIntervals: [{ start: 2, end: 4 }],
        provenance: {
          providerId: "synthetic-test",
          version: "1",
          sourceHash: source.contentHash!,
          createdAt: "2026-11-05T00:00:00Z",
        },
      },
      proposal = createSilenceCutProposal(beforeComposition, evidence, {
        baseRevision: "sample-clock-ripple",
        paddingSeconds: 0.25,
        assets: [source],
      }),
      afterComposition = applySilenceCutProposal(beforeComposition, proposal, {
        assets: [source],
        timebase,
      }),
      before = await wav(join(dir, "before.wav"), beforeComposition, [source]),
      after = await wav(join(dir, "after.wav"), afterComposition, [source]),
      expected: number[] = [];

    const directMix = async (composition: Composition, path: string) => {
      const plan = buildAudioMixPlan(composition, [source], {
          timebase,
          coverage: [],
        }),
        inputs = new Map<string, number>(),
        args = ["-v", "error", "-nostdin", "-threads", "1"];
      for (const [index, clip] of composition.tracks[0]!.clips.entries()) {
        inputs.set(clip.id, index);
        args.push("-i", fileURLToPath(source.uri));
      }
      const graph = compileAudioMixPlan(plan, composition, inputs),
        filters = [
          ...graph.filters,
          `${graph.labels.map((label) => `[${label}]`).join("")}amix=inputs=${graph.labels.length}:duration=longest:normalize=0[mix]`,
        ];
      expect(
        graph.filters.filter((filter) =>
          filter.includes("]atrim=start=0:end=10,asetpts=PTS-STARTPTS"),
        ),
      ).toHaveLength(1);
      args.push(
        "-filter_complex",
        filters.join(";"),
        "-map",
        "[mix]",
        "-c:a",
        "pcm_f32le",
        "-ar",
        "48000",
        "-ac",
        "2",
        path,
      );
      await runProcess("ffmpeg", args);
      return decodePolicyAudio(path);
    };
    const beforeDirect = await directMix(
        beforeComposition,
        join(dir, "before-direct.wav"),
      ),
      afterDirect = await directMix(
        afterComposition,
        join(dir, "after-direct.wav"),
      );

    expect(proposal.timelineIntervals).toEqual([{ start: 1.8, end: 3 }]);
    for (let frame = 0; frame < 86400; frame++)
      expected.push(before.samples[frame * 2]!, before.samples[frame * 2 + 1]!);
    for (let frame = 144000; frame < 384000; frame++)
      expected.push(before.samples[frame * 2]!, before.samples[frame * 2 + 1]!);
    expect(after.samples).toHaveLength(expected.length);
    const directExpected = [
      ...beforeDirect.samples.slice(0, 86400 * 2),
      ...beforeDirect.samples.slice(144000 * 2, 384000 * 2),
    ];
    expect(afterDirect.samples).toHaveLength(directExpected.length);
    let directMaximumError = 0;
    for (let index = 0; index < directExpected.length; index++)
      directMaximumError = Math.max(
        directMaximumError,
        Math.abs(afterDirect.samples[index]! - directExpected[index]!),
      );
    const spliceSample = 86400,
      limiterLookaheadSamples = Math.ceil(0.005 * 48000) + 2;
    let maximumErrorOutsideLimiterLookahead = 0;
    for (let index = 0; index < expected.length; index++) {
      const frame = Math.floor(index / 2);
      if (
        frame >= spliceSample &&
        frame < spliceSample + limiterLookaheadSamples
      )
        continue;
      maximumErrorOutsideLimiterLookahead = Math.max(
        maximumErrorOutsideLimiterLookahead,
        Math.abs(after.samples[index]! - expected[index]!),
      );
    }
    // The shared output limiter has a 5 ms lookahead. A cut changes its local
    // input context, so only that attack window is excluded from exact PCM
    // comparison; the source-clock mix graph above remains sample-identical.
    expect(directMaximumError).toBeLessThanOrEqual(2 / 2 ** 23);
    expect(maximumErrorOutsideLimiterLookahead).toBeLessThanOrEqual(
      2 / 2 ** 23,
    );
    const secondProposal = createSilenceCutProposal(
        afterComposition,
        {
          ...evidence,
          silenceIntervals: [{ start: 6, end: 7 }],
          parameters: { ...evidence.parameters, minimumSilenceSeconds: 0.2 },
        },
        {
          baseRevision: "second-sample-clock-ripple",
          paddingSeconds: 0.25,
          assets: [source],
        },
      ),
      twiceComposition = applySilenceCutProposal(
        afterComposition,
        secondProposal,
        { assets: [source], timebase },
      ),
      twice = await wav(join(dir, "twice.wav"), twiceComposition, [source]),
      twiceDirect = await directMix(
        twiceComposition,
        join(dir, "twice-direct.wav"),
      ),
      expectedTwice = [
        ...before.samples.slice(0, 86400 * 2),
        ...before.samples.slice(144000 * 2, 240000 * 2),
        ...before.samples.slice(259200 * 2),
      ],
      expectedTwiceDirect = [
        ...beforeDirect.samples.slice(0, 86400 * 2),
        ...beforeDirect.samples.slice(144000 * 2, 240000 * 2),
        ...beforeDirect.samples.slice(259200 * 2),
      ];
    expect(secondProposal.timelineIntervals).toEqual([
      { start: 3.8, end: 4.2 },
    ]);
    expect(twice.samples).toHaveLength(expectedTwice.length);
    expect(twiceDirect.samples).toHaveLength(expectedTwiceDirect.length);
    let twiceDirectError = 0,
      twiceFinalError = 0;
    for (let index = 0; index < expectedTwice.length; index++) {
      twiceDirectError = Math.max(
        twiceDirectError,
        Math.abs(twiceDirect.samples[index]! - expectedTwiceDirect[index]!),
      );
      const sample = Math.floor(index / 2);
      if (
        [86400, 182400].some(
          (splice) =>
            sample >= splice && sample < splice + limiterLookaheadSamples,
        )
      )
        continue;
      twiceFinalError = Math.max(
        twiceFinalError,
        Math.abs(twice.samples[index]! - expectedTwice[index]!),
      );
    }
    expect(twiceDirectError).toBeLessThanOrEqual(2 / 2 ** 23);
    expect(twiceFinalError).toBeLessThanOrEqual(2 / 2 ** 23);
  },
);

it("preserves the existing limiter and above-unity gain against an independent identity-tempo baseline", async () => {
  const dir = await root(),
    asset = await toneSource(dir, "overload", 440),
    legacy = {
      ...clip("p", asset.id),
      transform: { volume: 20 },
      audioAutomation: {
        version: 1 as const,
        role: "dialogue" as const,
        fadeIn: 0.2,
      },
    };
  const referencePath = join(dir, "overload-identity-reference.wav");
  await runProcess("ffmpeg", [
    "-v",
    "error",
    "-i",
    fileURLToPath(asset.uri),
    "-af",
    "atrim=start=0:end=12,asetpts=PTS-STARTPTS,apad,atrim=duration=12,afade=t=in:st=0:d=0.2,volume=20,adelay=0:all=1,amix=inputs=1:duration=longest:normalize=0,alimiter=limit=0.95,apad,atrim=duration=12",
    "-c:a",
    "pcm_s24le",
    "-ar",
    "48000",
    "-ac",
    "2",
    referencePath,
  ]);
  const reference = await decodePolicyAudio(referencePath);
  const independent = {
      ...legacy,
      audioTiming: {
        version: 1 as const,
        sampleRate: 48000 as const,
        timelineStartSample: 0,
        sourceInSample: 0,
        sourceOutSample: 576000,
      },
    },
    actual = await wav(
      join(dir, "overload-independent.wav"),
      comp(independent),
      [asset],
    );
  let error = 0;
  for (let i = 0; i < actual.samples.length; i++)
    error = Math.max(
      error,
      Math.abs(actual.samples[i]! - reference.samples[i]!),
    );
  expect(error).toBeLessThanOrEqual(2 / 2 ** 23);
});

it("fails the same measured gates for duplicate sound, global mute, envelope restart, stem bypass and frame onset controls", async () => {
  const dir = await root(),
    a = await toneSource(dir, "negative-primary", 440),
    b = await toneSource(dir, "negative-secondary", 880),
    p: Clip = {
      ...clip("p", a.id),
      audioTiming: {
        version: 1,
        sampleRate: 48000,
        timelineStartSample: 0,
        sourceInSample: 0,
        sourceOutSample: 576000,
      },
      audioAutomation: {
        version: 1,
        role: "dialogue",
        points: [
          { time: 0, gain: 0.2 },
          { time: 12, gain: 0.8 },
        ],
      },
    },
    s: Clip = {
      ...clip("s", b.id),
      audioTiming: {
        version: 1,
        sampleRate: 48000,
        timelineStartSample: 0,
        sourceInSample: 0,
        sourceOutSample: 576000,
      },
    },
    coverage = [
      binding("replace-primary"),
      binding("replace-primary", "second", 8, 9),
    ],
    healthy = await wav(
      join(dir, "controls-healthy.wav"),
      comp(p, s),
      [a, b],
      coverage,
    ),
    primary = await wav(join(dir, "controls-primary.wav"), comp(p), [a]),
    secondary = await wav(join(dir, "controls-secondary.wav"), comp(s), [b]);
  const gate = (actual: number, expected: number) => {
    const db = 20 * Math.log10(Math.max(actual, 1e-15) / expected);
    if (Math.abs(db) > 0.5)
      throw new Error(`Included level ${db} dB exceeds ±0.5 dB`);
    return db;
  };
  const excluded = (actual: number, expected: number) => {
    const db = 20 * Math.log10(Math.max(actual, 1e-15) / expected);
    if (db > -45) throw new Error(`Excluded tone ${db} dB is above -45 dB`);
    return db;
  };
  gate(
    spectralAmplitude(healthy.samples, 880, 4.3),
    spectralAmplitude(secondary.samples, 880, 4.3) * 0.5,
  );
  gate(
    spectralAmplitude(healthy.samples, 440, 6.3),
    spectralAmplitude(primary.samples, 440, 6.3),
  );
  excluded(
    spectralAmplitude(healthy.samples, 440, 4.3),
    spectralAmplitude(primary.samples, 440, 4.3),
  );
  const duplicate = await wav(
    join(dir, "control-duplicate.wav"),
    comp(p, s, { ...s, id: "duplicate", transform: { volume: 0.5 } }),
    [a, b],
    coverage,
  );
  const duplicateDb =
    20 *
    Math.log10(
      spectralAmplitude(duplicate.samples, 880, 4.3) /
        (spectralAmplitude(secondary.samples, 880, 4.3) * 0.5),
    );
  expect(() =>
    gate(
      spectralAmplitude(duplicate.samples, 880, 4.3),
      spectralAmplitude(secondary.samples, 880, 4.3) * 0.5,
    ),
  ).toThrow(/Included level/);
  const muted = await wav(
    join(dir, "control-global-mute.wav"),
    comp({ ...p, transform: { volume: 0 } }, s),
    [a, b],
    coverage,
  );
  expect(() =>
    gate(
      spectralAmplitude(muted.samples, 440, 6.3),
      spectralAmplitude(primary.samples, 440, 6.3),
    ),
  ).toThrow(/Included level/);
  const restarted = await wav(
    join(dir, "control-restarted.wav"),
    comp(
      {
        ...p,
        audioAutomation: {
          version: 1,
          role: "dialogue",
          points: [
            { time: 4, gain: 0.2 },
            { time: 12, gain: 0.6 },
          ],
        },
      },
      s,
    ),
    [a, b],
    coverage,
  );
  const restartDb =
    20 *
    Math.log10(
      spectralAmplitude(restarted.samples, 440, 6.3) /
        spectralAmplitude(primary.samples, 440, 6.3),
    );
  expect(() =>
    gate(
      spectralAmplitude(restarted.samples, 440, 6.3),
      spectralAmplitude(primary.samples, 440, 6.3),
    ),
  ).toThrow(/Included level/);
  const bypassed = await wav(
    join(dir, "control-stem-bypass.wav"),
    comp(p),
    [a],
    [],
    "dialogue",
  );
  expect(() =>
    excluded(
      spectralAmplitude(bypassed.samples, 440, 4.3),
      spectralAmplitude(primary.samples, 440, 4.3),
    ),
  ).toThrow(/Excluded tone/);

  const pulse = await toneSource(dir, "control-pulse", 0, 1, 48000, 2, true);
  const canonical: Clip = {
    ...clip("pulse", pulse.id, 6, 1),
    audioTiming: {
      version: 1,
      sampleRate: 48000,
      timelineStartSample: 252001,
      sourceInSample: 0,
      sourceOutSample: 48000,
    },
  };
  const baseline = await wav(
    join(dir, "control-impulse-baseline.wav"),
    comp({
      ...canonical,
      audioTiming: { ...canonical.audioTiming!, timelineStartSample: 0 },
    }),
    [pulse],
  );
  const correct = await wav(
    join(dir, "control-onset-healthy.wav"),
    comp(canonical),
    [pulse],
  );
  const quantizedStart = Math.round((252001 / 48000) * 30) * 1600;
  const quantized = await wav(
    join(dir, "control-frame-quantized.wav"),
    comp({
      ...canonical,
      audioTiming: {
        ...canonical.audioTiming!,
        timelineStartSample: quantizedStart,
      },
    }),
    [pulse],
  );
  const expected = 252001 + firstAudibleSample(baseline.samples);
  const onsetGate = (actual: number) => {
    if (Math.abs(actual - expected) > 1)
      throw new Error(`Onset error ${actual - expected} samples exceeds1`);
  };
  onsetGate(firstAudibleSample(correct.samples));
  const onsetError = firstAudibleSample(quantized.samples) - expected;
  expect(() => onsetGate(firstAudibleSample(quantized.samples))).toThrow(
    /Onset error/,
  );
  await recordPolicyEvidence("negative-controls", {
    duplicateDb,
    restartDb,
    onsetError,
    globalMute: "included level gate rejected",
    stemBypass: "excluded ≥45dB gate rejected",
    gates: { includedDb: 0.5, excludedDb: -45, onsetSamples: 1 },
  });
});

it("keeps actual H264/AAC pulse edges within1024samples using one PCM limiter baseline", async () => {
  const dir = await root(),
    events = [24000, 48000, 76800];
  const positions = events.flatMap((first) =>
    Array.from({ length: 64 }, (_, n) => first + n),
  );
  const source = await toneSource(dir, "aac-events", 0, 2, 48000, 2, positions);
  const impulse = await toneSource(
    dir,
    "aac-common-impulse",
    0,
    1,
    48000,
    2,
    true,
  );
  const configured = (
    id: string,
    assetId: string,
    length: number,
    start = 0,
  ): Clip => ({
    ...clip(id, assetId, 6, length / 48000),
    audioTiming: {
      version: 1,
      sampleRate: 48000,
      timelineStartSample: start,
      sourceInSample: 0,
      sourceOutSample: length,
    },
  });
  const baseline = await wav(
    join(dir, "aac-common-baseline.wav"),
    comp(configured("baseline", impulse.id, 48000)),
    [impulse],
  );
  const delay = firstAudibleSample(baseline.samples),
    start = 252001;
  const composition = comp(configured("events", source.id, 96000, start));
  const path = join(dir, "aac-events-output.mp4");
  await renderer.render(composition, [source], path, settings);
  const decoded = await decodePolicyAudio(path),
    errors = [];
  for (const event of events) {
    const expected = event + start + delay;
    let peak = 0,
      edge = -1;
    for (let n = expected - 2048; n <= expected + 2048; n++) {
      const level = Math.abs(decoded.samples[n * 2]!);
      if (level > peak) {
        peak = level;
        edge = n;
      }
    }
    expect(peak).toBeGreaterThan(0.05);
    expect(Math.abs(edge - expected)).toBeLessThanOrEqual(1024);
    errors.push(edge - expected);
  }
  expect(await hashFile(fileURLToPath(source.uri))).toBe(source.contentHash);
  await recordPolicyEvidence("aac-event-edges", {
    delay,
    start,
    events,
    errors,
    encodedSha256: await hashFile(path),
    decodedPcmSha256: decoded.sha256,
    manifest: JSON.parse(await readFile(`${path}.manifest.json`, "utf8")),
  });
});

it("measures canonical master and role stems through the existing per-output limiter without normalizing them", async () => {
  const dir = await root(),
    a = await toneSource(dir, "meter-dialogue", 440, 2),
    b = await toneSource(dir, "meter-music", 880, 2);
  const configured = (
    id: string,
    assetId: string,
    role: "dialogue" | "music",
  ): Clip => ({
    ...clip(id, assetId, 0, 2),
    transform: { volume: 20 },
    audioTiming: {
      version: 1,
      sampleRate: 48000,
      timelineStartSample: 0,
      sourceInSample: 0,
      sourceOutSample: 96000,
    },
    audioAutomation: { version: 1, role },
  });
  const composition = comp(
    configured("p", a.id, "dialogue"),
    configured("m", b.id, "music"),
  );
  const outputs = [];
  for (const role of [undefined, "dialogue", "music"] as const) {
    const path = join(dir, `meter-output-${role ?? "master"}.wav`);
    const decoded = await wav(path, composition, [a, b], [], role),
      before = await hashFile(path);
    const measured = await measureAudioOutput(path);
    expect(await hashFile(path)).toBe(before);
    expect(measured.duration).toBe(12);
    expect(Number.isFinite(measured.integratedLufs)).toBe(true);
    expect(Number.isFinite(measured.truePeakDbtp)).toBe(true);
    expect(Number.isFinite(measured.samplePeakDbfs)).toBe(true);
    expect(measured.meterBins.length).toBeGreaterThan(0);
    outputs.push({ role: role ?? "master", decoded, measured });
  }
  let nonlinearDifference = 0;
  for (let n = 0; n < outputs[0]!.decoded.samples.length; n++)
    nonlinearDifference = Math.max(
      nonlinearDifference,
      Math.abs(
        outputs[1]!.decoded.samples[n]! +
          outputs[2]!.decoded.samples[n]! -
          outputs[0]!.decoded.samples[n]!,
      ),
    );
  expect(nonlinearDifference).toBeGreaterThan(0.1);
  await recordPolicyEvidence("master-stem-measurements", {
    nonlinearDifference,
    reports: outputs.map(({ role, measured }) => ({ role, measured })),
  });
});
