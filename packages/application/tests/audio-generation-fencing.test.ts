import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { OpenFilmApplication, TimelineEditor } from "../src/index.js";
import type {
  AudioGenerationProvider,
  AudioGenerationResult,
} from "@openfilm/plugin-sdk";
import { localAudioMock } from "../src/audio-generation-provider.js";
import { createAudioQualityFixture } from "../../../tests/fixtures/audio-quality.js";
it("cancels an ignoring provider, consumes late results, rejects stale generation and allows retry", async () => {
  const root = await mkdtemp(join(tmpdir(), "openfilm-generation-fence-"));
  const initial = await createAudioQualityFixture(root);
  initial.app.close();
  let finish!: (value: AudioGenerationResult) => void;
  const provider: AudioGenerationProvider = {
    id: "held",
    name: "held remote protocol fixture",
    kind: "audio-generation",
    execution: "remote",
    endpoint: "https://example.invalid/tts",
    dataKinds: ["text"],
    generateAudio: (text) => {
      expect(text).toBe("虛構旁白");
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  };
  const app = await OpenFilmApplication.open(join(root, "film.openfilm"), {
    audioGenerationProvider: provider,
  });
  try {
    const editor = new TimelineEditor(app);
    const revision = editor.get("film").revision;
    const input = {
      compositionId: "film",
      baseRevision: revision,
      providerId: "held",
      text: "虛構旁白",
      consent: true,
      acknowledgeUnknownCost: true,
    };
    await expect(
      app.runAudioGeneration({ ...input, acknowledgeUnknownCost: false }),
    ).rejects.toMatchObject({ status: 400 });
    expect(finish).toBeUndefined();
    const controller = new AbortController();
    const pending = app.runAudioGeneration(input, controller.signal);
    await expect.poll(() => typeof finish).toBe("function");
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    const tone = await localAudioMock.generateAudio("mock");
    finish(tone);
    await new Promise((resolve) => setImmediate(resolve));
    expect(app.catalog.countAssets()).toBe(2);
    const retry = await app.runAudioGeneration({
      ...input,
      providerId: "local-audio-mock",
    });
    expect(retry.mock).toBe(true);
    finish = undefined as unknown as typeof finish;
    const stale = app.runAudioGeneration(input);
    await expect.poll(() => typeof finish).toBe("function");
    await editor.edit("film", {
      baseRevision: revision,
      commands: [{ type: "volume", clipId: "sound", volume: 0.7 }],
    });
    finish(tone);
    await expect(stale).rejects.toMatchObject({ status: 409 });
    expect(app.catalog.countAssets()).toBe(2);
    finish = undefined as unknown as typeof finish;
    const malformed = app.runAudioGeneration({
      ...input,
      baseRevision: editor.get("film").revision,
    });
    await expect.poll(() => typeof finish).toBe("function");
    finish({ bytes: new Uint8Array(44), model: "invalid", mock: false });
    await expect(malformed).rejects.toMatchObject({ status: 400 });
    expect(app.catalog.countAssets()).toBe(2);
  } finally {
    app.close();
    await rm(root, { recursive: true, force: true });
  }
}, 30000);
