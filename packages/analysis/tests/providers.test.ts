import { describe, expect, it, vi } from "vitest";
import type { MediaAsset } from "@openfilm/core";
import type {
  LanguageProvider,
  RemoteProviderConsent,
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
