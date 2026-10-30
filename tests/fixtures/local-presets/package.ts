// SPDX-License-Identifier: Apache-2.0
/** Original, synthetic recipes by OpenFilm contributors; no third-party assets. */
export function presetPackage() {
  return {
    format: "openfilm-presets",
    schemaVersion: 1,
    id: "test.studio",
    name: "Local 記憶",
    version: "1.0.0",
    license: {
      spdxId: "CC0-1.0",
      copyright: "2026 OpenFilm contributors",
      notice:
        "Original synthetic test recipes, dedicated to the public domain.",
    },
    provenance: {
      author: "OpenFilm contributors",
      origin: "original",
      source: "Synthetic numeric and authored text fixtures",
    },
    entries: [
      {
        kind: "film-look",
        id: "warm",
        name: "Warm 記憶",
        recipe: {
          version: 1,
          domain: "encoded-sdr-rgb",
          defaultStrength: 0.8,
          matrix: [
            1.05, 0.01, 0, 0.02, 0, 0, 1, 0, 0.01, 0, 0, 0, 0.95, 0.01, 0, 0, 0,
            0, 1, 0,
          ],
        },
      },
      {
        kind: "title",
        id: "quiet",
        name: "Quiet title",
        recipe: {
          version: 1,
          role: "film-title",
          fontSize: 24,
          background: "none",
          position: "center",
        },
      },
      {
        kind: "story",
        id: "three",
        name: "Three scenes",
        recipe: {
          version: 1,
          defaultLocale: "en-US",
          defaults: { targetDuration: 6, maxDuration: 12 },
          beats: ["begin", "middle", "end"].map((key, i) => ({
            key,
            weight: i === 1 ? 2 : 1,
            text: {
              "en-US": {
                title: key,
                intent: "Authored scene",
                visualDirection: "Hold the selected view",
              },
              "zh-TW": {
                title: `${key} 記憶`,
                intent: "作者指定場景",
                visualDirection: "保留選定畫面",
              },
            },
          })),
        },
      },
    ],
  };
}
