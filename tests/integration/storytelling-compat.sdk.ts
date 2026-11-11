// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL, fileURLToPath } from "node:url";
import { OpenFilmApplication } from "@openfilm/application";
import { exportTimeline } from "@openfilm/exporters";
import {
  compatibilityFixture,
  plannerRequest,
  reviewContext,
} from "../helpers/storytelling-compat-fixtures.js";
import type * as Capsule from "../../scripts/storytelling-compat.js";

const sdkRoot = process.env.STORYTELLING_COMPAT_SDK;
const binarySha256 = process.env.STORYTELLING_COMPAT_BINARY_SHA256;
const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
const hash = (bytes: string | Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
function snapshot() {
  const f = compatibilityFixture();
  return exportTimeline("json", f.composition, f.assets, f.settings).content;
}

describe("real pinned Storytelling CLI compatibility", () => {
  let capsule: typeof Capsule;
  let pin: Capsule.SdkPin;
  beforeAll(async () => {
    if (!sdkRoot || !binarySha256)
      throw new Error(
        "Set STORYTELLING_COMPAT_SDK and STORYTELLING_COMPAT_BINARY_SHA256 for the dedicated pinned SDK gate; see docs/validation/storytelling-compatibility-138.md",
      );
    const loaded = await import("../../scripts/storytelling-compat.js").catch(
      () => undefined,
    );
    expect(
      loaded?.inspectSdk,
      "compatibility runner must exist before invoking the real SDK",
    ).toBeTypeOf("function");
    capsule = loaded!;
    pin = capsule.inspectSdk(sdkRoot!, binarySha256!);
  });

  it("checks the checkout and binary identities before accepting a probe", () => {
    expect(() => capsule.inspectSdk(sdkRoot!, "0".repeat(64))).toThrow(
      "compat.binary_identity",
    );
    expect(() => capsule.inspectSdk(process.cwd(), binarySha256!)).toThrow(
      "compat.sdk_revision",
    );
    expect(pin.binarySha256).toBe(binarySha256);
  });

  it("preserves exporter snapshot, IDs, order, exact source ranges, clocks and explicit losses", () => {
    const input = snapshot();
    const originalHash = hash(input);
    const result = capsule.importProbe(pin, input);
    expect(result.exitCode).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.ok).toBe(true);
    expect(output.import.source_snapshot).toEqual(JSON.parse(input));
    expect(
      output.import.plan.shots.map((shot: { id: string }) => shot.id),
    ).toEqual(["occurrence-z", "occurrence-a", "occurrence-m"]);
    expect(
      output.import.plan.shots.map(
        (shot: { asset_id: string }) => shot.asset_id,
      ),
    ).toEqual(["capsule-video", "capsule-still", "capsule-video"]);
    expect(output.import.plan.shots[0].source_range).toEqual({
      start: { numerator: "5", denominator: "4" },
      end: { numerator: "5", denominator: "2" },
    });
    expect(output.import.clocks).toEqual({
      declared_frame_rate: "29.97002997002997",
      exact_frame_rate: {
        numerator: "2997002997002997",
        denominator: "100000000000000",
      },
      explicit_timebase: JSON.parse(input).settings.timebase,
    });
    expect(output.import.executable).toBe(false);
    expect(output.import.losses).toEqual([
      {
        code: "media.not_verified",
        path: "$.assets",
        disposition: "not-verified",
      },
      {
        code: "audio.not_mapped",
        path: "$.assets[0]",
        disposition: "blocks-host-handoff",
      },
      {
        code: "image.hold_window",
        path: "$.assets[1]",
        disposition: "intentional-delta",
      },
    ]);
    expect(hash(input)).toBe(originalHash);
  });

  it.each([
    [
      "audio track",
      (v: ReturnType<typeof compatibilityFixture>) => {
        v.composition.tracks.push({
          id: "audio-extra",
          type: "audio",
          clips: [],
        });
      },
    ],
    [
      "embedded audio",
      (v: ReturnType<typeof compatibilityFixture>) => {
        v.assets[0]!.metadata["openfilm.ffprobe"] = {
          streams: [{ codec_type: "audio" }],
        };
      },
    ],
    [
      "identity transform",
      (v: ReturnType<typeof compatibilityFixture>) => {
        v.composition.tracks[0]!.clips[0]!.transform = { scale: 1 };
      },
    ],
    [
      "effects",
      (v: ReturnType<typeof compatibilityFixture>) => {
        Object.assign(v.composition.tracks[0]!.clips[0]!, { effects: [] });
      },
    ],
    [
      "pins and user overrides",
      (v: ReturnType<typeof compatibilityFixture>) => {
        Object.assign(v.composition.tracks[0]!.clips[0]!, {
          userOverrides: { isUserPinned: true },
        });
      },
    ],
    [
      "animation",
      (v: ReturnType<typeof compatibilityFixture>) => {
        Object.assign(v.composition.tracks[0]!.clips[0]!, {
          animation: { version: 1, tracks: [] },
        });
      },
    ],
  ])("rejects %s without stripping the declaration", (_label, mutate) => {
    const fixture = compatibilityFixture();
    mutate(fixture);
    const input = exportTimeline(
      "json",
      fixture.composition,
      fixture.assets,
      fixture.settings,
    ).content;
    const before = hash(input);
    const result = capsule.importProbe(pin, input);
    expect(result.exitCode).toBe(1);
    const output = JSON.parse(result.stdout);
    expect(output.ok).toBe(false);
    expect(output.import).toBeUndefined();
    expect(output.error.code).toBe("import.unsupported_feature");
    expect(output.error.losses).toEqual([
      {
        code: "import.unsupported_feature",
        path: output.error.path,
        disposition: "unsupported",
      },
    ]);
    expect(hash(input)).toBe(before);
  });

  it("uses complete successful plan-story stdout for review and invalidates each changed input", () => {
    const input = {
      request: plannerRequest(),
      snapshot: snapshot(),
      context: reviewContext(),
    };
    const result = capsule.planReviewProbe(pin, input);
    const proposal = JSON.parse(result.proposal.stdout);
    expect(proposal.ok).toBe(true);
    expect(proposal.planning.plan.shots).toHaveLength(1);
    const bundle = JSON.parse(result.review.stdout);
    expect(bundle.ok).toBe(true);
    for (const flag of [
      "approval_granted",
      "executable",
      "source_verified",
      "host_verified",
    ])
      expect(bundle.review[flag]).toBe(false);
    expect(bundle.review.identity.profile_id).toBe(
      "storytelling.planner-otio-visual-ticks.v1",
    );
    const clip = bundle.otio.tracks.children[0].children[0];
    expect(clip.metadata.storytelling.occurrence_id).toBe(
      proposal.planning.plan.shots[0].id,
    );
    expect(clip.source_range.start_time).toMatchObject({ value: 5, rate: 4 });
    expect(clip.source_range.duration).toMatchObject({ value: 5, rate: 4 });
    expect(JSON.parse(result.freshness.stdout).freshness.current).toBe(true);
    const current = {
      bundle: result.review.stdout,
      proposal: result.proposal.stdout,
      snapshot: input.snapshot,
      context: input.context,
    };
    const changedInputs = [
      { ...current, proposal: current.proposal + " " },
      {
        ...current,
        snapshot: current.snapshot.replace(
          "Synthetic visual declaration",
          "Changed synthetic visual declaration",
        ),
      },
      {
        ...current,
        context: current.context.replace(
          "synthetic-revision-1",
          "synthetic-revision-2",
        ),
      },
    ];
    for (const changed of changedInputs) {
      const stale = capsule.checkReviewProbe(pin, changed);
      expect(stale.exitCode).toBe(1);
      expect(JSON.parse(stale.stdout).freshness?.current ?? false).toBe(false);
    }
    const invalid = capsule.checkReviewProbe(pin, {
      ...current,
      proposal: capsule.importProbe(pin, input.snapshot).stdout,
    });
    expect(invalid.exitCode).toBe(1);
    expect(JSON.parse(invalid.stdout).error.code).toBe(
      "story_review.invalid_proposal_json",
    );
  });

  it("runs the public probe command with full planner inputs and writes only stdout", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "openfilm-capsule-command-"),
    );
    directories.push(directory);
    const inputs = {
      "snapshot.json": snapshot(),
      "request.json": plannerRequest(),
      "context.json": reviewContext(),
    };
    for (const [name, bytes] of Object.entries(inputs))
      await writeFile(join(directory, name), bytes);
    const output = spawnSync(
      process.execPath,
      [
        "node_modules/tsx/dist/cli.mjs",
        "scripts/storytelling-compat-probe.ts",
        sdkRoot!,
        binarySha256!,
        join(directory, "snapshot.json"),
        join(directory, "request.json"),
        join(directory, "context.json"),
      ],
      { encoding: "utf8" },
    );
    expect(output.status, output.stderr).toBe(0);
    expect(output.stderr).toBe("");
    const report = JSON.parse(output.stdout);
    expect(report.binarySha256).toBe(binarySha256);
    expect(JSON.parse(report.import.stdout).import.source_snapshot).toEqual(
      JSON.parse(inputs["snapshot.json"]),
    );
    expect(
      JSON.parse(report.review.proposal.stdout).planning.plan.shots,
    ).toHaveLength(1);
    expect(JSON.parse(report.review.freshness.stdout).freshness.current).toBe(
      true,
    );
    for (const [name, bytes] of Object.entries(inputs))
      expect(await readFile(join(directory, name), "utf8")).toBe(bytes);
    expect((await readdir(directory)).sort()).toEqual(
      Object.keys(inputs).sort(),
    );
  });

  it("exports through the application and leaves saved project, Catalog, media and memory unchanged", async () => {
    const directory = await mkdtemp(join(tmpdir(), "openfilm-capsule-app-"));
    directories.push(directory);
    const app = await OpenFilmApplication.create(
      join(directory, "proof.openfilm"),
      "Read-only capsule proof",
    );
    try {
      const f = compatibilityFixture();
      for (const [index, asset] of f.assets.entries()) {
        asset.uri = pathToFileURL(
          join(directory, `synthetic-${index}.declaration`),
        ).href;
        const bytes = Buffer.from(
          `Independently authored synthetic source sentinel ${index}. No decoder or host claim.`,
        );
        await writeFile(fileURLToPath(asset.uri), bytes);
        asset.contentHash = hash(bytes);
        app.catalog.upsertAsset(asset);
      }
      const story = app.generateStory({
        title: "Synthetic proof",
        targetDuration: 3.75,
        maxDuration: 3.75,
      });
      f.composition.storyId = story.id;
      app.project.timelines = [f.composition];
      app.project.settings = f.settings;
      await app.save();
      const catalogFiles = (await readdir(app.directory))
        .filter((name) => name.startsWith("database.sqlite"))
        .sort();
      const catalogRevision = app.catalog.logicalRevision();
      const watched = [
        join(app.directory, "project.json"),
        ...catalogFiles.map((name) => join(app.directory, name)),
        ...f.assets.map((a) => fileURLToPath(a.uri)),
      ];
      const before = await Promise.all(
        watched.map(async (p) => hash(await readFile(p))),
      );
      const memory = JSON.stringify(app.project);
      const exported = await app.exportWithReport("json", f.composition.id);
      const input = await readFile(exported.path, "utf8");
      expect(JSON.parse(input).composition).toEqual(f.composition);
      const imported = capsule.importProbe(pin, input);
      expect(imported.exitCode).toBe(0);
      expect(JSON.parse(imported.stdout).import.source_snapshot).toEqual(
        JSON.parse(input),
      );
      expect(
        await Promise.all(watched.map(async (p) => hash(await readFile(p)))),
      ).toEqual(before);
      expect(JSON.stringify(app.project)).toBe(memory);
      expect(app.catalog.logicalRevision()).toBe(catalogRevision);
      expect(
        (await readdir(app.directory))
          .filter((name) => name.startsWith("database.sqlite"))
          .sort(),
      ).toEqual(catalogFiles);
      expect((await readdir(join(app.directory, "exports"))).sort()).toEqual([
        "timeline.json",
        "timeline.json.report.json",
      ]);
    } finally {
      app.close();
    }
  });
});
