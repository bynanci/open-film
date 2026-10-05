import { describe, expect, it } from "vitest";
import {
  validatePlugin,
  validatePluginManifest,
  type PluginManifest,
} from "../src/index.js";

const manifest: PluginManifest = {
  id: "openfilm.test",
  name: "Test",
  version: "0.1.0",
  apiVersion: "1",
  capabilities: ["story-template"],
};

describe("plugin API compatibility", () => {
  it("roundtrips a versioned manifest without aliasing capabilities", () => {
    const restored = validatePluginManifest(
      JSON.parse(JSON.stringify(manifest)),
    );
    expect(restored).toEqual(manifest);
    restored.capabilities.push("scorer");
    expect(manifest.capabilities).toEqual(["story-template"]);
  });

  it.each(["2", "1.0.0", 1, null])(
    "rejects unsupported API version %s",
    (apiVersion) => {
      expect(() => validatePluginManifest({ ...manifest, apiVersion })).toThrow(
        "API version",
      );
    },
  );

  it.each(["1", "01.0.0", "latest", "v0.1.0"])(
    "rejects malformed plugin version %s",
    (version) => {
      expect(() => validatePluginManifest({ ...manifest, version })).toThrow(
        "semantic version",
      );
    },
  );

  it("accepts semantic prerelease and build versions", () => {
    expect(
      validatePluginManifest({ ...manifest, version: "1.0.0-beta.1+local" })
        .version,
    ).toBe("1.0.0-beta.1+local");
  });

  it("rejects unknown, empty, and repeated capabilities", () => {
    expect(() =>
      validatePluginManifest({ ...manifest, capabilities: ["cloud-upload"] }),
    ).toThrow("Unsupported plugin capability");
    expect(() =>
      validatePluginManifest({ ...manifest, capabilities: [] }),
    ).toThrow("non-empty array");
    expect(() =>
      validatePluginManifest({
        ...manifest,
        capabilities: ["scorer", "scorer"],
      }),
    ).toThrow("unique");
  });

  it("checks executable ports against declared capabilities and duplicate IDs", () => {
    const scorer = { id: "score", score: () => ({ score: 0, factors: [] }) };
    expect(() => validatePlugin({ manifest, scorers: [scorer] })).toThrow(
      "without declaring scorer",
    );
    expect(() =>
      validatePlugin({
        manifest: { ...manifest, capabilities: ["scorer"] },
        scorers: [scorer, scorer],
      }),
    ).toThrow("Duplicate scorer port ID");
    expect(
      validatePlugin({
        manifest: { ...manifest, capabilities: ["scorer"] },
        scorers: [scorer],
      }).scorers,
    ).toEqual([scorer]);
  });

  it("rejects executable ports that omit their declared operation", () => {
    expect(() =>
      validatePlugin({
        manifest: { ...manifest, capabilities: ["scorer"] },
        scorers: [{ id: "broken" }] as never,
      }),
    ).toThrow("must implement score");
  });
});
