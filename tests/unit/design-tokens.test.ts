import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve("apps/desktop/src/tokens.css"), "utf8");
const declarations = (block: string): Record<string, string> =>
  Object.fromEntries(
    [...block.matchAll(/--of-([\w-]+):\s*(#[\da-f]{6});/giu)].map(
      ([, name, value]) => [name!, value!],
    ),
  );
const dark = declarations(css.match(/:root\s*\{([^}]+)\}/u)![1]!);
const light = {
  ...dark,
  ...declarations(css.match(/:root\[data-theme="light"\]\s*\{([^}]+)\}/u)![1]!),
};

function luminance(color: string): number {
  const linear = color
    .slice(1)
    .match(/../gu)!
    .map((channel) => {
      const value = parseInt(channel, 16) / 255;
      return value <= 0.04045
        ? value / 12.92
        : ((value + 0.055) / 1.055) ** 2.4;
    });
  return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722;
}
function contrast(first: string, second: string): number {
  const a = luminance(first),
    b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

describe.each([
  ["dark", dark],
  ["light", light],
] as const)("%s product colors", (_name, palette) => {
  it("keeps normal-size text at WCAG AA on every regular surface", () => {
    for (const text of ["text-primary", "text-secondary", "text-muted"])
      for (const surface of ["bg", "surface-1", "surface-2", "surface-3"])
        expect(
          contrast(palette[text]!, palette[surface]!),
          `${text} on ${surface}`,
        ).toBeGreaterThanOrEqual(4.5);
  });
  it("keeps actionable and semantic status text readable", () => {
    for (const name of ["success", "warning", "danger"])
      expect(
        contrast(palette[name]!, palette[`${name}-soft`]!),
        name,
      ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(palette["accent"]!, palette["accent-ink"]!),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(palette["accent-hover"]!, palette["accent-ink"]!),
    ).toBeGreaterThanOrEqual(4.5);
  });
  it("makes focus and control boundaries distinguishable from their surroundings", () => {
    for (const surface of ["bg", "surface-1", "surface-2"])
      expect(
        contrast(palette["focus"]!, palette[surface]!),
      ).toBeGreaterThanOrEqual(3);
    expect(
      contrast(palette["border-strong"]!, palette["surface-1"]!),
    ).toBeGreaterThanOrEqual(3);
  });
});
