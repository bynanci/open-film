// SPDX-License-Identifier: Apache-2.0
import type { MotionGenerationProvider } from "@openfilm/plugin-sdk";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { checkAbort, runProcess } from "@openfilm/media";
/** Camera-only workflow fixture. This is never represented as an AI model. */
export const localMotionFixture: MotionGenerationProvider = {
  id: "local-motion-fixture",
  name: "Local camera fixture (not AI)",
  kind: "motion-generation",
  execution: "local",
  dataKinds: ["images", "text"],
  async generateMotion(input, options) {
    checkAbort(options?.signal);
    if (!input.image) throw new Error("Fixture image required");
    const root = await mkdtemp(join(tmpdir(), "openfilm-motion-fixture-"));
    try {
      const source = join(root, "image"),
        output = join(root, "candidate.mp4");
      await writeFile(source, input.image, { mode: 0o600 });
      const png = Buffer.from(input.image.subarray(0, 8)).equals(
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      );
      const frames = Math.round(input.duration * input.frameRate);
      await runProcess(
        "ffmpeg",
        [
          "-v",
          "error",
          "-nostdin",
          "-protocol_whitelist",
          "file",
          "-f",
          png ? "png_pipe" : "jpeg_pipe",
          "-i",
          source,
          "-vf",
          `scale=${input.width}:${input.height}:force_original_aspect_ratio=increase,crop=${input.width}:${input.height},zoompan=z='1+${0.025 * (input.variant + 1)}*on/${Math.max(1, frames - 1)}':x='(iw-iw/zoom)*${input.variant / 2}':y='(ih-ih/zoom)/2':d=${frames}:s=${input.width}x${input.height}:fps=${input.frameRate}`,
          "-frames:v",
          String(frames),
          "-an",
          "-c:v",
          "libx264",
          "-pix_fmt",
          "yuv420p",
          "-threads",
          "1",
          "-movflags",
          "+faststart",
          output,
        ],
        { signal: options?.signal, timeoutMs: 60000 },
      );
      checkAbort(options?.signal);
      return {
        bytes: new Uint8Array(await readFile(output)),
        model: "camera-fixture-v1",
        mock: true,
      };
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
};
export const localMotionImport: MotionGenerationProvider = {
  id: "local-motion-import",
  name: "Import external video (local only)",
  kind: "motion-generation",
  execution: "local",
  dataKinds: ["video", "text"],
  async generateMotion(input, options) {
    checkAbort(options?.signal);
    if (!input.video) throw new Error("Explicit local video required");
    return { bytes: input.video, model: "external-file-v1", mock: false };
  },
};
