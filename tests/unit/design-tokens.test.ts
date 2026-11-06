import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve("design/tokens.css"), "utf8");
const productCss = readFileSync(
  resolve("apps/desktop/src/product.css"),
  "utf8",
);
const declarations = (block: string): Record<string, string> =>
  Object.fromEntries(
    [...block.matchAll(/--of-([\w-]+):\s*(#[\da-f]{6});/giu)].map(
      ([, name, value]) => [name!, value!],
    ),
  );
const light = declarations(css.match(/:root\s*\{([^}]+)\}/u)![1]!);
const dark = declarations(
  css.match(/:root\[data-theme="dark"\][^{]*\{([^}]+)\}/u)![1]!,
);
const systemDark = declarations(
  css.match(/:root\[data-theme="system"\]\s*\{([^}]+)\}/u)![1]!,
);

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
  ["system dark", systemDark],
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
  it("separates decorative hairlines from usable input boundaries", () => {
    expect(
      palette["border-control"],
      "Controls need their own visible boundary role",
    ).toBeDefined();
    for (const surface of ["bg", "surface-1", "surface-2"])
      expect(
        contrast(palette["border-control"]!, palette[surface]!),
        `control boundary on ${surface}`,
      ).toBeGreaterThanOrEqual(3);
    expect(
      contrast(palette["accent"]!, palette["accent-soft"]!),
      "selected labels",
    ).toBeGreaterThanOrEqual(4.5);
  });
});

describe("Garden Stone defaults", () => {
  it("uses warm stone as the first-run palette and a local Mincho-capable stack", () => {
    expect(light.bg).toBe("#f2efe8");
    expect(light.accent).toBe("#3d6348");
    expect(css).toMatch(/Hiragino Mincho ProN/u);
    expect(css).toMatch(/Noto Serif CJK TC/u);
    expect(css).toMatch(/Yu Mincho/u);
  });
  it("keeps system light on the base palette and defines a dark system override", () => {
    expect(css).toMatch(/color-scheme:\s*light/u);
    expect(css).toMatch(/prefers-color-scheme:\s*dark/u);
    expect(systemDark.bg).toBe(dark.bg);
    expect(systemDark.accent).toBe(dark.accent);
  });
  it("centralizes an editorial golden-ratio grid and readable type scale", () => {
    expect(css).toMatch(/--of-golden-major:\s*1\.618fr/u);
    expect(css).toMatch(/--of-golden-minor:\s*1fr/u);
    expect(css).toMatch(/--of-font-caption:\s*0\.8125rem/u);
    expect(productCss).toContain("var(--of-golden-major)");
    expect(productCss).toContain("var(--of-golden-minor)");
    expect(productCss).toContain(".story-room");
    expect(productCss).toContain(".output-workspace-export");
  });
});
