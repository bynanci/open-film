import { readFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";

// Load the production cascade in the same order as main.ts. This small browser
// fixture isolates focus styling from project data, decoding, and job lifecycle.
const styles = await Promise.all(
  [
    "tokens.css",
    "style.css",
    "editor.css",
    "relink.css",
    "source.css",
    "export-report.css",
    "product.css",
  ].map((name) =>
    readFile(
      new URL(`../../apps/desktop/src/${name}`, import.meta.url),
      "utf8",
    ),
  ),
);

const states = ["", "selected", "locked", "selected locked"];

for (const theme of ["dark", "light"] as const) {
  for (const [width, height] of [
    [1280, 720],
    [1440, 900],
    [1920, 1080],
  ] as const) {
    test(`keyboard focus outranks selection and lock without moving clips: ${theme} ${width}×${height}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      await page.setContent(`
        <html data-theme="${theme}"><head><style>${styles.join("\n")}</style></head>
        <body><div class="timeline-editor timeline-editor-contained">
          <div class="editor-clip-lane" role="group" aria-label="Story clips">
            ${states
              .map(
                (state, index) => `
                  <button class="editor-clip ${state}" aria-pressed="${state.includes("selected")}">
                    <span class="editor-clip-meta"><strong>Memory ${index + 1}</strong></span>
                  </button>`,
              )
              .join("")}
          </div>
        </div></body></html>`);

      for (let index = 0; index < states.length; index++) {
        const clip = page.locator(".editor-clip").nth(index);
        const before = await clip.evaluate((element) => {
          const style = getComputedStyle(element);
          return {
            borderStyle: style.borderStyle,
            borderColor: style.borderColor,
          };
        });
        const bounds = await clip.boundingBox();

        await page.keyboard.press("Tab");
        await expect(clip).toBeFocused();
        const focused = await clip.evaluate((element) => {
          const style = getComputedStyle(element);
          return {
            visible: element.matches(":focus-visible"),
            outlineStyle: style.outlineStyle,
            outlineWidth: parseFloat(style.outlineWidth),
            outlineOffset: parseFloat(style.outlineOffset),
            borderStyle: style.borderStyle,
            borderColor: style.borderColor,
          };
        });
        expect(focused.visible).toBe(true);
        expect(focused.outlineStyle).toBe("solid");
        expect(focused.outlineWidth).toBeGreaterThanOrEqual(2);
        expect(focused.outlineOffset).toBeGreaterThanOrEqual(3);
        expect(focused.borderStyle).toBe(before.borderStyle);
        expect(focused.borderColor).toBe(before.borderColor);
        expect(await clip.boundingBox()).toEqual(bounds);
      }
    });
  }
}
