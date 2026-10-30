// SPDX-License-Identifier: Apache-2.0
import { afterEach, expect, it, vi } from "vitest";
import {
  mkdtemp,
  rm,
  readFile,
  writeFile,
  utimes,
  stat,
  truncate,
  rename,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { hashFile, inspectMedia, runProcess } from "@openfilm/media";
import { OpenFilmApplication } from "../src/index.js";
import { TimelineEditor } from "../src/editor.js";
import type { TimelineCommand } from "@openfilm/solver";
import * as filesystem from "node:fs/promises";
vi.mock("node:fs/promises", async (original) => ({
  ...(await original<typeof import("node:fs/promises")>()),
}));
const apps: OpenFilmApplication[] = [],
  roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const app of apps.splice(0)) {
    await app.primaryColorReview.dispose();
    app.close();
  }
  vi.useRealTimers();
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function fixture(videos = false) {
  const root = await mkdtemp(join(tmpdir(), "primary-review-"));
  roots.push(root);
  const app = await OpenFilmApplication.create(
    join(root, "film.openfilm"),
    "Color",
  );
  apps.push(app);
  const paths = [join(root, "target.bmp"), join(root, "reference.bmp")];
  for (const [i, path] of paths.entries()) {
    await runProcess("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "gradients=seed=1:s=96x64:c0=0x303030:c1=0xa0a0a0:x0=0:y0=0:x1=96:y1=64",
      ...(i ? ["-vf", "lutrgb=r=val+24:g=val+24:b=val+24"] : []),
      "-frames:v",
      "1",
      "-threads",
      "1",
      path,
    ]);
    const source = videos ? path.replace(/\.bmp$/u, ".mp4") : path;
    if (videos)
      await runProcess("ffmpeg", [
        "-v",
        "error",
        "-loop",
        "1",
        "-i",
        path,
        "-t",
        "2",
        "-r",
        "12",
        "-c:v",
        "libx264",
        "-threads",
        "1",
        "-pix_fmt",
        "yuv420p",
        source,
      ]);
    paths[i] = source;
    const asset = await inspectMedia({
      path: source,
      name: i ? "reference" : "target",
      uri: pathToFileURL(source).href,
    });
    app.catalog.upsertAsset({
      ...asset,
      id: i ? "reference" : "target",
      contentHash: await hashFile(source),
    });
  }
  app.project.stories.push({
    id: "s",
    title: "Color",
    beats: [{ id: "b", title: "Scene" }],
  });
  app.project.timelines.push({
    id: "f",
    storyId: "s",
    duration: 2,
    tracks: [
      {
        id: "v",
        type: "video",
        clips: ["target", "reference"].map((id, i) => ({
          id,
          assetId: id,
          beatId: "b",
          timelineStart: i,
          timelineDuration: 1,
        })),
      },
    ],
  });
  await app.save();
  const editor = new TimelineEditor(app),
    before = editor.get("f");
  return {
    root,
    app,
    editor,
    before,
    paths,
    input: {
      baseRevision: before.revision,
      targetClipId: "target",
      referenceClipId: "reference",
    },
  };
}
it("publishes actual before/after evidence and applies only through explicit reviewed history", async () => {
  const { app, editor, before, input, paths } = await fixture();
  const original = await hashFile(paths[0]!);
  const report = await app.runPrimaryColorReview("f", input);
  expect(report.canApply).toBe(true);
  expect(report.after).not.toBeNull();
  expect(report.samples.filter((s) => s.variant === "after")).toHaveLength(1);
  expect(editor.get("f").composition).toEqual(before.composition);
  const path = await app.primaryColorReview.media(report.id, "after", 0);
  expect(await hashFile(path)).toBe(
    report.samples.find((s) => s.variant === "after")!.sha256,
  );
  const commands = [
    {
      type: "primary-color" as const,
      scope: "clip" as const,
      clipId: "target",
      correction: report.suggestedCorrection!,
      primaryColorReviewId: report.id,
    },
  ];
  const suggested = report.suggestedCorrection!;
  await expect(
    app.primaryColorReview.validateAcceptance(
      report.id,
      "f",
      before.revision,
      "target",
      {
        contrast: suggested.contrast,
        exposureEv: suggested.exposureEv,
        temperature: suggested.temperature,
        version: 1,
      },
    ),
  ).resolves.toBeUndefined();
  const saved = await editor.edit("f", {
    baseRevision: before.revision,
    requestId: "accept-primary",
    commands,
  });
  expect(saved.composition.tracks[0]!.clips[0]!.primaryColor).toEqual(
    report.suggestedCorrection,
  );
  expect(
    (
      await editor.edit("f", {
        baseRevision: before.revision,
        requestId: "accept-primary",
        commands,
      })
    ).acknowledgedRevision,
  ).toBe(saved.revision);
  expect((await editor.undo("f", saved.revision)).composition).toEqual(
    before.composition,
  );
  expect(await hashFile(paths[0]!)).toBe(original);
});
it("rejects same-size source mutation and tampered evidence without touching the project", async () => {
  const { app, editor, before, input, paths } = await fixture();
  await utimes(paths[0]!, new Date(0), new Date(0));
  const report = await app.runPrimaryColorReview("f", input);
  const original = await stat(paths[0]!);
  const bytes = await readFile(paths[0]!);
  bytes[bytes.length - 3] = bytes[bytes.length - 3]! ^ 1;
  await writeFile(paths[0]!, bytes);
  await utimes(paths[0]!, original.atime, original.mtime);
  expect((await stat(paths[0]!)).mtimeMs).toBe(original.mtimeMs);
  expect((await stat(paths[0]!)).size).toBe(original.size);
  await expect(
    app.primaryColorReview.media(report.id, "before", 0),
  ).rejects.toThrow(/changed|stale/);
  await expect(
    editor.edit("f", {
      baseRevision: before.revision,
      commands: [
        {
          type: "primary-color",
          scope: "clip",
          clipId: "target",
          correction: report.suggestedCorrection!,
          primaryColorReviewId: report.id,
        },
      ],
    }),
  ).rejects.toThrow();
  expect(editor.get("f").composition).toEqual(before.composition);
});
it("rejects concurrent direct reviews and tampered generated images", async () => {
  const { app, input } = await fixture();
  const first = app.primaryColorReview.run("f", input);
  await expect(app.primaryColorReview.run("f", input)).rejects.toThrow(
    /already active/,
  );
  const report = await first;
  const path = await app.primaryColorReview.media(report.id, "before", 0);
  const bytes = await readFile(path);
  bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1;
  await writeFile(path, bytes);
  await expect(
    app.primaryColorReview.media(report.id, "before", 0),
  ).rejects.toThrow(/stale|changed/);
});
it("fences forged recipe, cancellation, discard and stale revisions", async () => {
  const { app, editor, before, input } = await fixture();
  const aborted = new AbortController();
  aborted.abort();
  await expect(
    app.runPrimaryColorReview("f", input, aborted.signal),
  ).rejects.toThrow();
  const report = await app.runPrimaryColorReview("f", input);
  await expect(
    app.primaryColorReview.validateAcceptance(
      report.id,
      "f",
      before.revision,
      "target",
      { ...report.suggestedCorrection!, exposureEv: -2 },
    ),
  ).rejects.toThrow();
  await app.primaryColorReview.discard(report.id);
  await expect(
    app.primaryColorReview.media(report.id, "before", 0),
  ).rejects.toThrow();
  const newer = await editor.edit("f", {
    baseRevision: before.revision,
    commands: [{ type: "lock", clipId: "target", locked: true }],
  });
  expect(newer.revision).not.toBe(before.revision);
  await expect(app.runPrimaryColorReview("f", input)).rejects.toThrow(
    /stale|changed/,
  );
});
it("expires proposals and refuses oversized or symlinked originals before sampling", async () => {
  const { app, input, paths } = await fixture();
  const report = await app.runPrimaryColorReview("f", input);
  const clock = vi
    .spyOn(Date, "now")
    .mockReturnValue(Date.parse(report.expiresAt) + 1);
  await expect(
    app.primaryColorReview.media(report.id, "before", 0),
  ).rejects.toThrow(/expired|stale/);
  clock.mockRestore();
  await truncate(paths[0]!, 512 * 1024 * 1024 + 1);
  await expect(app.runPrimaryColorReview("f", input)).rejects.toThrow(
    /storage bound/,
  );
  await rename(paths[0]!, paths[0] + ".backup");
  await symlink(paths[0] + ".backup", paths[0]!);
  await expect(app.runPrimaryColorReview("f", input)).rejects.toThrow(
    /regular local file/,
  );
});

it("retains accepted correction through Named Versions and reopen while private review IDs expire", async () => {
  const { app, editor, input } = await fixture();
  const report = await app.runPrimaryColorReview("f", input);
  const accepted = await editor.edit("f", {
    baseRevision: input.baseRevision,
    commands: [
      {
        type: "primary-color",
        scope: "clip",
        clipId: "target",
        correction: report.suggestedCorrection!,
        primaryColorReviewId: report.id,
      },
    ],
  });
  const version = await app.versions.create({
    name: "Measured color",
    baseRevision: app.versions.currentRevision(),
    requestId: "23000000-0000-4000-8000-000000000001",
  });
  await editor.edit("f", {
    baseRevision: accepted.revision,
    commands: [
      {
        type: "primary-color",
        scope: "clip",
        clipId: "target",
        correction: null,
      },
    ],
  });
  await app.versions.restore(version.id, {
    baseRevision: app.versions.currentRevision(),
    requestId: "23000000-0000-4000-8000-000000000002",
    confirmed: true,
  });
  expect(editor.get("f").composition.tracks[0]!.clips[0]!.primaryColor).toEqual(
    report.suggestedCorrection,
  );
  const directory = app.directory;
  await app.primaryColorReview.dispose();
  app.close();
  apps.splice(apps.indexOf(app), 1);
  const reopened = await OpenFilmApplication.open(directory);
  apps.push(reopened);
  expect(
    new TimelineEditor(reopened).get("f").composition.tracks[0]!.clips[0]!
      .primaryColor,
  ).toEqual(report.suggestedCorrection);
  await expect(
    reopened.primaryColorReview.validateAcceptance(
      report.id,
      "f",
      input.baseRevision,
      "target",
      report.suggestedCorrection!,
    ),
  ).rejects.toThrow(/stale|expired/);
});

const contextSiblings: {
  name: string;
  video?: boolean;
  command: TimelineCommand;
}[] = [
  {
    name: "target replacement",
    command: { type: "replace", clipId: "target", assetId: "reference" },
  },
  {
    name: "reference replacement",
    command: { type: "replace", clipId: "reference", assetId: "target" },
  },
  {
    name: "target trim",
    video: true,
    command: { type: "trim", clipId: "target", sourceIn: 0, sourceOut: 0.75 },
  },
  {
    name: "reference trim",
    video: true,
    command: {
      type: "trim",
      clipId: "reference",
      sourceIn: 0.25,
      sourceOut: 1,
    },
  },
  {
    name: "reference correction",
    command: {
      type: "primary-color",
      scope: "clip",
      clipId: "reference",
      correction: {
        version: 1,
        temperature: 0.3,
        exposureEv: 0.2,
        contrast: 1,
      },
    },
  },
];
it.each(
  contextSiblings.flatMap((sibling) =>
    [false, true].map((first) => ({ ...sibling, first })),
  ),
)(
  "rejects reviewed Apply with $name (reviewed first: $first) atomically",
  async ({ name, video, command, first }) => {
    const { app, editor, paths, before } = await fixture(video);
    const prior = await editor.edit("f", {
      baseRevision: before.revision,
      commands: [
        {
          type: "presentation",
          clipId: "reference",
          title: "Prior manual edit",
        },
      ],
    });
    const report = await app.runPrimaryColorReview("f", {
      baseRevision: prior.revision,
      targetClipId: "target",
      referenceClipId: "reference",
    });
    expect(report.canApply).toBe(true);
    const apply: TimelineCommand = {
      type: "primary-color",
      scope: "clip",
      clipId: "target",
      correction: report.suggestedCorrection!,
      primaryColorReviewId: report.id,
    };
    const captured = editor.get("f"),
      project = structuredClone(app.project),
      manifest = await readFile(join(app.directory, "project.json")),
      hashes = await Promise.all(paths.map((path) => hashFile(path)));
    await expect(
      editor.edit("f", {
        baseRevision: captured.revision,
        requestId: `${name}-${first}`,
        commands: first ? [apply, command] : [command, apply],
      }),
    ).rejects.toThrow(/single|one command/iu);
    expect(editor.get("f")).toEqual(captured);
    expect(app.project).toEqual(project);
    expect(await readFile(join(app.directory, "project.json"))).toEqual(
      manifest,
    );
    expect(await Promise.all(paths.map((path) => hashFile(path)))).toEqual(
      hashes,
    );
    const undone = await editor.undo("f", captured.revision);
    expect(undone.composition).toEqual(before.composition);
    expect((await editor.redo("f", undone.revision)).composition).toEqual(
      prior.composition,
    );
  },
);

it("keeps singleton reviewed replay after discard and permits later independent replacement", async () => {
  const { app, editor, input, paths } = await fixture();
  const report = await app.runPrimaryColorReview("f", input);
  expect(report.canApply).toBe(true);
  const request = {
    baseRevision: input.baseRevision,
    requestId: "singleton-retry",
    commands: [
      {
        type: "primary-color" as const,
        scope: "clip" as const,
        clipId: "target",
        correction: report.suggestedCorrection!,
        primaryColorReviewId: report.id,
      },
    ],
  };
  const accepted = await editor.edit("f", request);
  await app.primaryColorReview.discard(report.id);
  expect((await editor.edit("f", request)).acknowledgedRevision).toBe(
    accepted.revision,
  );
  const replaced = await editor.edit("f", {
    baseRevision: accepted.revision,
    commands: [{ type: "replace", clipId: "target", assetId: "reference" }],
  });
  expect(replaced.composition.tracks[0]!.clips[0]!.assetId).toBe("reference");
  expect(replaced.composition.tracks[0]!.clips[0]!.primaryColor).toEqual(
    report.suggestedCorrection,
  );
  const restored = await editor.undo("f", replaced.revision);
  expect(restored.composition).toEqual(accepted.composition);
  const before = await editor.undo("f", restored.revision);
  const replay = await editor.edit("f", request);
  expect(replay.composition).toEqual(before.composition);
  expect(replay.acknowledgedRevision).toBe(accepted.revision);
  expect(replay.canRedo).toBe(true);
  for (const path of paths) expect(await readFile(path)).not.toHaveLength(0);
});

it("keeps ordinary manual primary commands batchable in one Undo step", async () => {
  const { editor, before } = await fixture();
  const saved = await editor.edit("f", {
    baseRevision: before.revision,
    commands: [
      {
        type: "primary-color",
        scope: "film",
        correction: {
          version: 1,
          temperature: 0.2,
          exposureEv: 0.1,
          contrast: 1,
        },
      },
      {
        type: "primary-color",
        scope: "clip",
        clipId: "reference",
        correction: {
          version: 1,
          temperature: -0.2,
          exposureEv: 0,
          contrast: 1,
        },
      },
    ],
  });
  expect(saved.composition.defaultPrimaryColor?.temperature).toBe(0.2);
  expect(saved.composition.tracks[0]!.clips[1]!.primaryColor?.temperature).toBe(
    -0.2,
  );
  expect((await editor.undo("f", saved.revision)).composition).toEqual(
    before.composition,
  );
});

function cachedReports(app: OpenFilmApplication) {
  return (
    app.primaryColorReview as unknown as {
      reports: Map<string, { expiryTimer?: { hasRef(): boolean } }>;
    }
  ).reports;
}
it("removes expired private evidence and lookup automatically without another review", async () => {
  const { app, editor, input } = await fixture();
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  const report = await app.runPrimaryColorReview("f", input);
  const path = await app.primaryColorReview.media(report.id, "before", 0),
    root = dirname(path);
  const saved = editor.get("f"),
    manifest = await readFile(join(app.directory, "project.json"));
  await vi.advanceTimersByTimeAsync(Date.parse(report.expiresAt) - Date.now());
  await vi.waitFor(async () =>
    expect(stat(root)).rejects.toMatchObject({ code: "ENOENT" }),
  );
  expect(cachedReports(app).has(report.id)).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
  expect(editor.get("f")).toEqual(saved);
  expect(await readFile(join(app.directory, "project.json"))).toEqual(manifest);
  await expect(
    app.primaryColorReview.media(report.id, "before", 0),
  ).rejects.toThrow(/stale|expired/iu);
});
it("owns unreferenced expiry timers and clears every timer on discard and disposal", async () => {
  const { app, input } = await fixture();
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  const first = await app.runPrimaryColorReview("f", input),
    second = await app.runPrimaryColorReview("f", input);
  const firstRoot = dirname(
      await app.primaryColorReview.media(first.id, "before", 0),
    ),
    secondRoot = dirname(
      await app.primaryColorReview.media(second.id, "before", 0),
    );
  expect(vi.getTimerCount()).toBe(2);
  expect(cachedReports(app).get(first.id)?.expiryTimer?.hasRef()).toBe(false);
  expect(cachedReports(app).get(second.id)?.expiryTimer?.hasRef()).toBe(false);
  await app.primaryColorReview.discard(first.id);
  expect(vi.getTimerCount()).toBe(1);
  await expect(stat(firstRoot)).rejects.toMatchObject({ code: "ENOENT" });
  await app.primaryColorReview.dispose();
  expect(vi.getTimerCount()).toBe(0);
  expect(cachedReports(app).size).toBe(0);
  await expect(stat(secondRoot)).rejects.toMatchObject({ code: "ENOENT" });
});
it("expired media access discards evidence even before a delayed expiry timer runs", async () => {
  const { app, input } = await fixture();
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  const report = await app.runPrimaryColorReview("f", input),
    root = dirname(await app.primaryColorReview.media(report.id, "before", 0));
  const deadline = report.expiresAt;
  vi.setSystemTime(Date.parse(deadline) + 1);
  await expect(
    app.primaryColorReview.media(report.id, "before", 0),
  ).rejects.toThrow(/expired|stale/iu);
  await expect(stat(root)).rejects.toMatchObject({ code: "ENOENT" });
  expect(cachedReports(app).has(report.id)).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
  expect(report.expiresAt).toBe(deadline);
});

it("keeps failed expiry cleanup retired, visible and retryable while disposing every owned timer", async () => {
  const { app, editor, input } = await fixture();
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  const first = await app.runPrimaryColorReview("f", input);
  await vi.advanceTimersByTimeAsync(60_000);
  const second = await app.runPrimaryColorReview("f", input);
  const firstRoot = dirname(
      await app.primaryColorReview.media(first.id, "before", 0),
    ),
    secondRoot = dirname(
      await app.primaryColorReview.media(second.id, "before", 0),
    );
  const before = editor.get("f"),
    manifest = await readFile(join(app.directory, "project.json"));
  const realRemove = filesystem.rm;
  const failure = Object.assign(new Error("Blocked expiry deletion"), {
    code: "EBUSY",
  });
  const remove = vi
    .spyOn(filesystem, "rm")
    .mockImplementation(async (...args) => {
      if (String(args[0]) === firstRoot) throw failure;
      return realRemove(...args);
    });
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  await vi.advanceTimersByTimeAsync(Date.parse(first.expiresAt) - Date.now());
  await vi.waitFor(() =>
    expect(logged).toHaveBeenCalledWith(
      "Primary color review expiry cleanup failed.",
      failure,
    ),
  );
  expect(cachedReports(app).has(first.id)).toBe(true); // Retain its owned bytes in the bounded inventory until deletion succeeds.
  expect(vi.getTimerCount()).toBe(1);
  await expect(
    app.primaryColorReview.media(first.id, "before", 0),
  ).rejects.toThrow("Blocked expiry deletion");
  vi.setSystemTime(Date.parse(first.createdAt));
  await expect(
    app.primaryColorReview.media(first.id, "before", 0),
  ).rejects.toThrow("Blocked expiry deletion");
  await expect(
    app.primaryColorReview.validateAcceptance(
      first.id,
      "f",
      input.baseRevision,
      "target",
      first.suggestedCorrection!,
    ),
  ).rejects.toThrow("Blocked expiry deletion");
  await expect(app.runPrimaryColorReview("f", input)).rejects.toThrow(
    "Blocked expiry deletion",
  );
  await expect(app.primaryColorReview.dispose()).rejects.toThrow(
    /cleanup failed/iu,
  );
  expect(vi.getTimerCount()).toBe(0);
  await expect(stat(secondRoot)).rejects.toMatchObject({ code: "ENOENT" });
  expect(cachedReports(app).has(first.id)).toBe(true);
  expect(editor.get("f")).toEqual(before);
  expect(await readFile(join(app.directory, "project.json"))).toEqual(manifest);
  expect(remove).toHaveBeenCalledWith(firstRoot, {
    recursive: true,
    force: true,
    maxRetries: 2,
    retryDelay: 100,
  });
  remove.mockRestore();
  await app.primaryColorReview.dispose();
  expect(cachedReports(app).size).toBe(0);
  await expect(stat(firstRoot)).rejects.toMatchObject({ code: "ENOENT" });
});

it("keeps a pinned Auto Match target ineligible until explicit release while manual correction remains direct", async () => {
  const { app, editor, input, paths } = await fixture();
  const originalHashes = await Promise.all(paths.map((path) => hashFile(path)));
  const pinned = await editor.edit("f", {
    baseRevision: input.baseRevision,
    commands: [
      {
        type: "user-pin.set",
        target: { kind: "clip", clipId: "target" },
        pinned: true,
      },
    ],
  });
  const report = await app.runPrimaryColorReview("f", {
    ...input,
    baseRevision: pinned.revision,
  });
  expect(report.suggestedCorrection).not.toBeNull();
  expect(report.canApply).toBe(false);
  expect(editor.get("f")).toEqual(pinned);
  await expect(
    editor.edit("f", {
      baseRevision: pinned.revision,
      commands: [
        {
          type: "primary-color",
          scope: "clip",
          clipId: "target",
          correction: report.suggestedCorrection!,
          primaryColorReviewId: report.id,
        },
      ],
    }),
  ).rejects.toThrow(/stale|expired|pin/iu);
  const manual = await editor.edit("f", {
    baseRevision: pinned.revision,
    commands: [
      {
        type: "primary-color",
        scope: "clip",
        clipId: "target",
        correction: { version: 1, temperature: 0, exposureEv: 0, contrast: 1 },
      },
    ],
  });
  expect(
    manual.composition.tracks[0]!.clips[0]!.userOverrides?.isUserPinned,
  ).toBe(true);
  const released = await editor.edit("f", {
    baseRevision: manual.revision,
    commands: [
      {
        type: "user-pin.set",
        target: { kind: "clip", clipId: "target" },
        pinned: false,
      },
    ],
  });
  const fresh = await app.runPrimaryColorReview("f", {
    ...input,
    baseRevision: released.revision,
  });
  expect(fresh.canApply).toBe(true);
  const accepted = await editor.edit("f", {
    baseRevision: released.revision,
    commands: [
      {
        type: "primary-color",
        scope: "clip",
        clipId: "target",
        correction: fresh.suggestedCorrection!,
        primaryColorReviewId: fresh.id,
      },
    ],
  });
  expect(accepted.composition.tracks[0]!.clips[0]!.userOverrides).toEqual(
    released.composition.tracks[0]!.clips[0]!.userOverrides,
  );
  expect(await Promise.all(paths.map((path) => hashFile(path)))).toEqual(
    originalHashes,
  );
});
