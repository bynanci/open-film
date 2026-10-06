import { describe, expect, it, vi } from "vitest";
import type { MediaAsset } from "@openfilm/core";
import type {
  LanguageProvider,
  RemoteProviderConsent,
  TranscriptionProvider,
  VisionProvider,
} from "@openfilm/plugin-sdk";
import { dataKindsForAsset, ProviderRegistry } from "../src/index.js";

function vision(execution: "local" | "remote" = "remote"): VisionProvider {
  return {
    id: "test.vision",
    name: "Test vision",
    kind: "vision",
    execution,
    endpoint: "https://example.invalid/analyze",
    dataKinds: ["images", "metadata"],
    analyze: vi.fn(async () => ({
      labels: [{ label: "outdoor", confidence: 0.9 }],
    })),
  };
}

const asset: MediaAsset = {
  id: "a",
  uri: "file:///private.jpg",
  mediaType: "image",
  name: "Private",
  tags: [],
  state: {},
  metadata: {},
};
const consent: RemoteProviderConsent = {
  providerId: "test.vision",
  dataKinds: ["images", "metadata"],
  grantedAt: "2026-10-05T12:00:00Z",
};

describe("explicit remote provider opt-in", () => {
  it("does not expose glossary prompt hints to a remote audio provider without text disclosure and consent", async () => {
    const registry = new ProviderRegistry();
    const transcribe = vi.fn(async () => ({ text: "", segments: [] }));
    const provider: TranscriptionProvider = {
      id: "remote.audio",
      name: "Audio",
      kind: "transcription",
      execution: "remote",
      endpoint: "https://audio.example.invalid",
      dataKinds: ["audio", "metadata"],
      transcribe,
    };
    const spoken = { ...asset, mediaType: "audio" as const };
    const grant = {
      providerId: provider.id,
      dataKinds: ["audio", "metadata"] as const,
      grantedAt: new Date().toISOString(),
    };
    registry.register(provider);
    registry.grantConsent({ ...grant, dataKinds: [...grant.dataKinds] });
    await expect(
      registry.transcribe(provider.id, spoken, {
        promptHints: ["private project name"],
      }),
    ).rejects.toThrow("has not disclosed");
    expect(transcribe).not.toHaveBeenCalled();
    await registry.transcribe(provider.id, spoken, { promptHints: [] });
    expect(transcribe).toHaveBeenCalledOnce();
    registry.unregister(provider.id);
    provider.dataKinds = ["audio", "metadata", "text"];
    registry.register(provider);
    await expect(
      registry.transcribe(provider.id, spoken, {
        promptHints: ["private project name"],
      }),
    ).rejects.toThrow("Explicit opt-in");
    expect(transcribe).toHaveBeenCalledOnce();
    registry.grantConsent({
      ...grant,
      dataKinds: ["audio", "metadata", "text"],
    });
    await registry.transcribe(provider.id, spoken, {
      promptHints: ["private project name"],
    });
    expect(transcribe).toHaveBeenCalledTimes(2);
  });

  it("requires transcript disclosure and consent before language review can send transcript text", async () => {
    const registry = new ProviderRegistry();
    const generate = vi.fn(async () => "reviewed");
    const provider: LanguageProvider = {
      id: "review.remote",
      name: "Remote review",
      kind: "language",
      execution: "remote",
      endpoint: "https://review.example.invalid",
      dataKinds: ["text"],
      generate,
    };
    registry.register(provider);
    registry.grantConsent({
      providerId: provider.id,
      dataKinds: ["text"],
      grantedAt: new Date().toISOString(),
    });
    await expect(
      registry.generate(provider.id, "private transcript", undefined, [
        "text",
        "transcripts",
      ]),
    ).rejects.toThrow("has not disclosed");
    expect(generate).not.toHaveBeenCalled();
    registry.unregister(provider.id);
    provider.dataKinds = ["text", "transcripts"];
    registry.register(provider);
    await expect(
      registry.generate(provider.id, "private transcript", undefined, [
        "text",
        "transcripts",
      ]),
    ).rejects.toThrow("Explicit opt-in");
    expect(generate).not.toHaveBeenCalled();
    registry.grantConsent({
      providerId: provider.id,
      dataKinds: ["text", "transcripts"],
      grantedAt: new Date().toISOString(),
    });
    await expect(
      registry.generate(provider.id, "private transcript", undefined, [
        "text",
        "transcripts",
      ]),
    ).resolves.toBe("reviewed");
    expect(generate).toHaveBeenCalledOnce();
    registry.revokeConsent(provider.id);
    await expect(
      registry.generate(provider.id, "private transcript", undefined, [
        "text",
        "transcripts",
      ]),
    ).rejects.toThrow("Explicit opt-in");
    expect(generate).toHaveBeenCalledOnce();
  });

  it("keeps ordinary generation's text disclosure required even with an empty additional-data list", async () => {
    const registry = new ProviderRegistry();
    const generate = vi.fn(async () => "unused");
    const provider: LanguageProvider = {
      id: "review.local",
      name: "Local",
      kind: "language",
      execution: "remote",
      endpoint: "https://review.example.invalid",
      dataKinds: ["transcripts"],
      generate,
    };
    registry.register(provider);
    registry.grantConsent({
      providerId: provider.id,
      dataKinds: ["transcripts"],
      grantedAt: new Date().toISOString(),
    });
    await expect(
      registry.generate(provider.id, "private text", undefined, []),
    ).rejects.toThrow("has not disclosed");
    expect(generate).not.toHaveBeenCalled();
  });

  it("does not call a registered remote provider until consent is granted", async () => {
    const registry = new ProviderRegistry();
    const provider = vision();
    registry.register(provider);
    expect(registry.list()[0]!.enabled).toBe(false);
    await expect(registry.analyzeVision(provider.id, asset)).rejects.toThrow(
      "Explicit opt-in",
    );
    expect(provider.analyze).not.toHaveBeenCalled();
    registry.grantConsent(consent);
    await expect(registry.analyzeVision(provider.id, asset)).resolves.toEqual({
      labels: [{ label: "outdoor", confidence: 0.9 }],
    });
    expect(provider.analyze).toHaveBeenCalledOnce();
    registry.revokeConsent(provider.id);
    await expect(registry.analyzeVision(provider.id, asset)).rejects.toThrow(
      "Explicit opt-in",
    );
    expect(provider.analyze).toHaveBeenCalledOnce();
  });

  it("runs local providers without cloud consent", async () => {
    const registry = new ProviderRegistry();
    const provider = vision("local");
    registry.register(provider);
    await registry.analyzeVision(provider.id, asset);
    expect(provider.analyze).toHaveBeenCalledOnce();
    expect(registry.list()[0]!.enabled).toBe(true);
  });

  it("reports mutated local providers as disabled before any provider invocation", async () => {
    const registry = new ProviderRegistry();
    const provider = vision("local");
    registry.register(provider);
    expect(registry.list()[0]!.enabled).toBe(true);
    provider.execution = "remote";
    expect(registry.list()[0]!.enabled).toBe(false);
    expect(provider.analyze).not.toHaveBeenCalled();
    await expect(registry.analyzeVision(provider.id, asset)).rejects.toThrow(
      "changed its destination",
    );
    expect(provider.analyze).not.toHaveBeenCalled();
  });

  it("revokes consent and reports disabled readiness when a consented remote destination changes", async () => {
    const registry = new ProviderRegistry();
    const provider = vision();
    registry.register(provider);
    registry.grantConsent(consent);
    expect(registry.list()[0]!.enabled).toBe(true);
    expect(registry.getConsent(provider.id)).toEqual(consent);
    provider.endpoint = "https://changed.example.invalid/analyze";
    expect(registry.list()[0]!.enabled).toBe(false);
    expect(registry.getConsent(provider.id)).toBeUndefined();
    expect(provider.analyze).not.toHaveBeenCalled();
    await expect(registry.analyzeVision(provider.id, asset)).rejects.toThrow(
      "changed its destination",
    );
    expect(provider.analyze).not.toHaveBeenCalled();
  });

  it("requires consent to identify the provider and cover every declared data kind", () => {
    const registry = new ProviderRegistry();
    registry.register(vision());
    expect(() =>
      registry.grantConsent({ ...consent, providerId: "unknown" }),
    ).toThrow("Unknown provider");
    expect(() =>
      registry.grantConsent({ ...consent, dataKinds: ["images"] }),
    ).toThrow("metadata");
    expect(() =>
      registry.grantConsent({ ...consent, grantedAt: "not-a-date" }),
    ).toThrow("timestamp");
    expect(() => registry.grantConsent({ ...consent, dataKinds: [] })).toThrow(
      "explicitly list",
    );
  });

  it("blocks undisclosed GPS, face, and transcript payloads before provider invocation", async () => {
    const registry = new ProviderRegistry();
    const provider = vision();
    registry.register(provider);
    registry.grantConsent(consent);
    const sensitive = {
      ...asset,
      gps: { latitude: 0, longitude: 0 },
      metadata: {
        "openfilm.vision.faces": [],
        "openfilm.audio.transcript": "private",
      },
    };
    expect(dataKindsForAsset(sensitive)).toEqual([
      "metadata",
      "images",
      "gps",
      "faces",
      "transcripts",
    ]);
    await expect(
      registry.analyzeVision(provider.id, sensitive),
    ).rejects.toThrow("has not disclosed");
    expect(provider.analyze).not.toHaveBeenCalled();
  });

  it("cannot extend consent by mutating the original grant or returned copies", async () => {
    const registry = new ProviderRegistry();
    const provider = vision();
    registry.register(provider);
    const original = { ...consent, dataKinds: [...consent.dataKinds] };
    registry.grantConsent(original);
    original.dataKinds.length = 0;
    registry.getConsent(provider.id)!.dataKinds.length = 0;
    registry.list()[0]!.dataKinds.length = 0;
    await expect(
      registry.analyzeVision(provider.id, asset),
    ).resolves.toBeDefined();
  });

  it("requires a fresh grant when a provider is replaced and rejects destination mutation", async () => {
    const registry = new ProviderRegistry();
    const provider = vision();
    registry.register(provider);
    registry.grantConsent(consent);
    provider.endpoint = "https://different.invalid/analyze";
    await expect(registry.analyzeVision(provider.id, asset)).rejects.toThrow(
      "changed its destination",
    );
    expect(provider.analyze).not.toHaveBeenCalled();
    registry.unregister(provider.id);
    registry.register(vision());
    await expect(registry.analyzeVision(provider.id, asset)).rejects.toThrow(
      "Explicit opt-in",
    );
  });

  it("validates remote destinations and rejects mismatched provider kinds", async () => {
    const registry = new ProviderRegistry();
    expect(() =>
      registry.register({ ...vision(), endpoint: undefined }),
    ).toThrow("disclose");
    expect(() =>
      registry.register({
        ...vision(),
        endpoint: "https://user:password@example.invalid",
      }),
    ).toThrow("embedded credentials");
    const language: LanguageProvider = {
      id: "local.text",
      name: "Local text",
      execution: "local",
      dataKinds: ["text"],
      kind: "language",
      generate: vi.fn(async (prompt) => prompt),
    };
    registry.register(language);
    await expect(registry.generate(language.id, "A title")).resolves.toBe(
      "A title",
    );
    await expect(registry.analyzeVision(language.id, asset)).rejects.toThrow(
      "supports language",
    );
    expect(language.generate).toHaveBeenCalledOnce();
  });
});
