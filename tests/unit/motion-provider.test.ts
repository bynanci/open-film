import { expect, it } from "vitest";
import { ProviderRegistry } from "@openfilm/analysis";
import {
  RemoteProviderConsentError,
  type MotionGenerationProvider,
} from "@openfilm/plugin-sdk";
it("registers motion and checks image/text consent on every invocation", async () => {
  const provider: MotionGenerationProvider = {
    id: "motion",
    name: "Fixture",
    kind: "motion-generation",
    execution: "remote",
    endpoint: "https://fixture.invalid/motion",
    dataKinds: ["images", "text"],
    generateMotion: async () => ({
      bytes: new Uint8Array([1]),
      model: "fixture",
      mock: true,
    }),
  };
  const registry = new ProviderRegistry();
  registry.register(provider);
  const input = {
    image: new Uint8Array([1]),
    width: 160,
    height: 90,
    frameRate: 12,
    duration: 4,
    variant: 0,
    prompt: "Synthetic",
    negativeConstraints: "No face changes",
  };
  await expect(registry.generateMotion("motion", input)).rejects.toBeInstanceOf(
    RemoteProviderConsentError,
  );
  registry.grantConsent({
    providerId: "motion",
    dataKinds: ["images", "text"],
    grantedAt: new Date().toISOString(),
  });
  expect((await registry.generateMotion("motion", input)).model).toBe(
    "fixture",
  );
  registry.revokeConsent("motion");
  await expect(registry.generateMotion("motion", input)).rejects.toBeInstanceOf(
    RemoteProviderConsentError,
  );
});
