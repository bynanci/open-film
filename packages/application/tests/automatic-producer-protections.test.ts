// SPDX-License-Identifier: Apache-2.0
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { hashFile, localPath } from "@openfilm/media";
import { createMotionFixture } from "../../../tests/fixtures/motion-generation.js";

it.each([
  "clip-pin",
  "clip-lock",
  "source-lock",
  "required",
  "asset-order",
] as const)(
  "rejects protected motion targets before publication (%s)",
  async (protection) => {
    const root = await mkdtemp(join(tmpdir(), "motion-protected-producer-"));
    const { app, editor, image } = await createMotionFixture(root);
    try {
      if (protection === "clip-pin" || protection === "clip-lock") {
        await editor.edit("film", {
          baseRevision: editor.get("film").revision,
          commands: [
            protection === "clip-pin"
              ? {
                  type: "user-pin.set",
                  target: { kind: "clip", clipId: "photo" },
                  pinned: true,
                }
              : { type: "lock", clipId: "photo", locked: true },
          ],
        });
      } else if (protection === "source-lock") {
        const source = app.catalog.getAsset(image.id)!;
        source.state.locked = true;
        app.catalog.upsertAsset(source);
      } else {
        app.project.stories[0]!.beats[0]!.constraints = [
          {
            type: protection === "required" ? "must-include" : "asset-order",
            assetIds: [image.id],
          },
        ];
        await app.save();
      }
      const before = editor.get("film");
      const project = structuredClone(app.project);
      const source = app.catalog.getAsset(image.id);
      const disk = await readFile(join(app.directory, "project.json"));
      const sourceHash = await hashFile(localPath(image.uri));
      const save = vi.spyOn(app, "save");
      const importSources = vi.spyOn(app, "importManagedSources");
      await expect(
        app.motionGeneration.preview({
          requestId: randomUUID(),
          projectId: app.project.id,
          compositionId: "film",
          clipId: "photo",
          baseRevision: before.revision,
          providerId: "local-motion-fixture",
          prompt: "Synthetic environment",
          negativeConstraints: "Preserve original detail",
          consent: true,
          containsPeople: false,
        }),
      ).rejects.toMatchObject({ status: 409 });
      expect(save).not.toHaveBeenCalled();
      expect(importSources).not.toHaveBeenCalled();
      expect(editor.get("film")).toEqual(before);
      expect(app.project).toEqual(project);
      expect(app.catalog.getAsset(image.id)).toEqual(source);
      expect(await readFile(join(app.directory, "project.json"))).toEqual(disk);
      expect(await hashFile(localPath(image.uri))).toBe(sourceHash);
    } finally {
      vi.restoreAllMocks();
      await app.motionGeneration.dispose();
      app.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);
