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
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { hashFile, inspectMedia, runProcess } from "@openfilm/media";
import { OpenFilmApplication } from "../src/index.js";
import { TimelineEditor } from "../src/editor.js";
const apps: OpenFilmApplication[] = [],
  roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const app of apps.splice(0)) {
    await app.primaryColorReview.dispose();
    app.close();
  }
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function fixture() {
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
    const asset = await inspectMedia({
      path,
      name: i ? "reference" : "target",
      uri: pathToFileURL(path).href,
    });
    app.catalog.upsertAsset({
      ...asset,
      id: i ? "reference" : "target",
      contentHash: await hashFile(path),
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
  const report = await app.runPrimaryColorReview("f", input);
  const original = await stat(paths[0]!);
  const bytes = await readFile(paths[0]!);
  bytes[bytes.length - 3] = bytes[bytes.length - 3]! ^ 1;
  await writeFile(paths[0]!, bytes);
  await utimes(paths[0]!, original.atime, original.mtime);
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
