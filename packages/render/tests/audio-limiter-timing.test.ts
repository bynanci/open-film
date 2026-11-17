// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import {
  createExportProfile,
  resolveProjectTimebase,
  type Composition,
} from "@openfilm/core";
import { hashFile } from "@openfilm/media";
import { FFmpegRenderer } from "../src/index.js";
import {
  decodePolicyAudio,
  recordPolicyEvidence,
  toneSource,
} from "../../../tests/fixtures/audio-policy.js";

it.each([false, true])(
  "keeps absolute first, sync and final sample positions through the output limiter (dialogue stem: %s)",
  async (stem) => {
    const root = await mkdtemp(join(tmpdir(), "openfilm-limiter-timing-"));
    try {
      const positions = [0, 67200, 191999];
      const source = await toneSource(
        root,
        "absolute-pulses",
        0,
        4,
        48000,
        2,
        positions,
      );
      const timebase = resolveProjectTimebase({
        width: 160,
        height: 90,
        frameRate: 30,
      });
      const composition: Composition = {
        id: "absolute-audio-timing",
        storyId: "synthetic",
        duration: 4,
        tracks: [
          {
            id: "dialogue",
            type: "audio",
            clips: [
              {
                id: "pulses",
                assetId: source.id,
                sourceIn: 0,
                sourceOut: 4,
                timelineStart: 0,
                timelineDuration: 4,
                audioTiming: {
                  version: 1,
                  sampleRate: 48000,
                  sourceInSample: 0,
                  sourceOutSample: 192000,
                  timelineStartSample: 0,
                },
              },
            ],
          },
        ],
      };
      const output = join(root, "absolute-pulses-rendered.wav");
      await new FFmpegRenderer().render(
        composition,
        [source],
        output,
        { width: 160, height: 90, frameRate: 30, timebase },
        {
          audioOnly: true,
          exportProfile: createExportProfile({
            ratio: "16:9",
            width: 160,
            height: 90,
            frameRate: 30,
            format: "wav",
          }),
          ...(stem ? { audioRole: "dialogue" as const } : {}),
        },
      );
      const decoded = await decodePolicyAudio(output);
      expect(decoded.samples.length).toBe(192000 * 2);
      const actual = [0, 1].map((channel) => {
        const audible: number[] = [];
        for (let index = 0; index < 192000; index++)
          if (Math.abs(decoded.samples[index * 2 + channel]!) > 1e-6)
            audible.push(index);
        return audible;
      });
      // Compare to independent source positions, never a rendered-delay baseline.
      expect(actual).toEqual([positions, positions]);
      expect(await hashFile(fileURLToPath(source.uri))).toBe(
        source.contentHash,
      );
      await recordPolicyEvidence(
        `limiter-absolute-${stem ? "dialogue-stem" : "full-mix"}`,
        {
          sourceSha256: source.contentHash,
          outputSha256: await hashFile(output),
          decodedPcmSha256: decoded.sha256,
          outputSamples: 192000,
          expectedPositions: positions,
          observedPositions: actual,
          perceptualReview: "not assessed; synthetic impulse timing only",
        },
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
