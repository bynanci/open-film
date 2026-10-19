import { expect, it, vi } from "vitest";
import { ProviderRegistry } from "@openfilm/analysis";
import {
  localAudioMock,
  openAiTtsProvider,
} from "../src/audio-generation-provider.js";
it("requires registry text consent and keeps BYOK and upstream failures private", async () => {
  const mock = await localAudioMock.generateAudio("測試旁白");
  const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
    expect(init?.redirect).toBe("error");
    expect(JSON.parse(init!.body as string)).toEqual({
      model: "gpt-4o-mini-tts",
      voice: "alloy",
      input: "合成旁白",
      response_format: "wav",
    });
    expect(new Headers(init?.headers).get("Authorization")).toBe(
      "Bearer secret-test-key",
    );
    return new Response(Buffer.from(mock.bytes), {
      headers: { "content-type": "audio/wav" },
    });
  });
  const registry = new ProviderRegistry();
  registry.register(
    openAiTtsProvider("secret-test-key", fetcher as typeof fetch),
  );
  await expect(
    registry.generateAudio("openai-tts", "合成旁白"),
  ).rejects.toMatchObject({ name: "RemoteProviderConsentError" });
  expect(fetcher).not.toHaveBeenCalled();
  registry.grantConsent({
    providerId: "openai-tts",
    dataKinds: ["text"],
    grantedAt: new Date().toISOString(),
  });
  const audio = await registry.generateAudio("openai-tts", "合成旁白");
  expect(audio.bytes).toEqual(mock.bytes);
  expect(audio.mock).toBe(false);
  registry.revokeConsent("openai-tts");
  await expect(
    registry.generateAudio("openai-tts", "合成旁白"),
  ).rejects.toMatchObject({ name: "RemoteProviderConsentError" });
  const failing = openAiTtsProvider("secret-test-key", (async () => {
    throw new Error("secret-test-key private provider body");
  }) as typeof fetch);
  await expect(failing.generateAudio("text")).rejects.toThrow(
    "TTS provider failed or timed out",
  );
});

it("bounds remote audio bytes and redacts upstream error bodies", async () => {
  const oversized = openAiTtsProvider(
    "secret-test-key",
    (async () =>
      new Response(Buffer.alloc(8 * 1024 * 1024 + 1))) as typeof fetch,
  );
  await expect(oversized.generateAudio("synthetic")).rejects.toThrow(
    "TTS provider failed or timed out",
  );
  const failed = openAiTtsProvider(
    "secret-test-key",
    (async () =>
      new Response("secret-test-key private body", {
        status: 401,
      })) as typeof fetch,
  );
  await expect(failed.generateAudio("synthetic")).rejects.toThrow(
    "TTS provider failed or timed out",
  );
});
