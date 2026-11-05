// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { silenceAuditionFixture } from "../fixtures/silence-audition.js";

it.each(["freshness", "verification"] as const)(
  "cancels during %s source verification before renderer entry",
  async (stage) => {
    const root = await mkdtemp(join(tmpdir(), "openfilm-audition-cancel-"));
    const f = await silenceAuditionFixture(root, 48000);
    try {
      const created = await f.app.silenceJobs.create({
        projectId: f.app.project.id,
        requestId: "analysis",
        assetId: "voice",
        compositionId: "timeline",
      });
      await f.app.silenceJobs.run(created.job.id);
      const { review } = await f.app.silenceJobs.getReview(created.job.id);
      const before = await readFile(join(f.app.directory, "project.json"));
      const controller = new AbortController();
      let entered!: () => void;
      const ready = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const wait = (signal?: AbortSignal): Promise<never> => {
        expect(signal).toBe(controller.signal);
        entered();
        return new Promise((_, reject) => {
          signal!.addEventListener("abort", () => reject(signal!.reason), {
            once: true,
          });
        });
      };
      if (stage === "freshness")
        vi.spyOn(f.app.intelligence, "sourceIdentity").mockImplementationOnce(
          (_id, options) => wait(options?.signal),
        );
      else
        vi.spyOn(
          f.app.silence,
          "verifyReviewedProposal",
        ).mockImplementationOnce(
          (_id, _proposal, _composition, _revision, signal) => wait(signal),
        );
      const render = vi.spyOn(f.app.recordAudioPreview, "prepare");
      const task = f.app.silenceJobs.audition(
        created.job.id,
        { ...review, requestId: "cancel-source" },
        controller.signal,
      );
      const rejected = expect(task).rejects.toMatchObject({
        name: "AbortError",
      });
      await ready;
      controller.abort();
      await rejected;
      expect(render).not.toHaveBeenCalled();
      expect(await readFile(join(f.app.directory, "project.json"))).toEqual(
        before,
      );
    } finally {
      vi.restoreAllMocks();
      f.app.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);
