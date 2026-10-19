import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, test } from "@playwright/test";
import { createAudioQualityFixture } from "../fixtures/audio-quality.js";
import { initialLocale, navigate } from "./ui-helpers.js";
const api = "http://127.0.0.1:4310/api";
for (const transport of ["normal", "held", "lost"] as const) {
  test(`reviews local generated audio with ${transport} import acknowledgment and preserves history`, async ({
    page,
    request,
  }) => {
    await request.post(`${api}/project/close`, { data: {} });
    const root = await mkdtemp(join(tmpdir(), "openfilm-generation-browser-"));
    const { app } = await createAudioQualityFixture(root);
    app.close();
    try {
      expect(
        (
          await request.post(`${api}/project/open`, {
            data: { path: join(root, "film.openfilm") },
          })
        ).ok(),
      ).toBe(true);
      await initialLocale(page);
      await page.goto("/");
      await navigate(page, "edit");
      await page
        .getByRole("button", { name: "Generate audio", exact: true })
        .click();
      const panel = page.locator(".audio-generation-panel");
      await expect(panel).toContainText("not speech");
      await panel
        .getByLabel("Text to speak", { exact: true })
        .fill("這是虛構的旁白測試。");
      await expect(
        panel.getByRole("button", { name: "Generate preview", exact: true }),
      ).toBeDisabled();
      await panel
        .getByLabel("I consent to processing only this entered text")
        .check();
      await panel
        .getByRole("button", { name: "Generate preview", exact: true })
        .click();
      await expect(panel.locator("audio")).toHaveAttribute(
        "src",
        /audio-generation/,
      );
      await expect(
        panel.getByRole("button", { name: "Import Timeline", exact: true }),
      ).toBeDisabled();
      await panel
        .getByRole("button", { name: "Accept audio", exact: true })
        .click();
      await expect(
        panel.getByRole("button", { name: "Import Timeline", exact: true }),
      ).toBeEnabled();
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let committed = false;
      let lost = false;
      await page.route("**/api/**", (route) => route.continue());
      if (transport !== "normal")
        await page.route("**/api/audio-generation/*/import", async (route) => {
          const response = await route.fetch();
          expect(response.ok()).toBe(true);
          committed = true;
          if (transport === "held") await gate;
          if (transport === "lost" && !lost) {
            lost = true;
            await route.abort("failed");
          } else await route.fulfill({ response });
        });
      try {
        await panel
          .getByRole("button", { name: "Import Timeline", exact: true })
          .click();
        if (transport === "held") {
          await expect.poll(() => committed).toBe(true);
          await expect(
            page.getByRole("button", { name: "Undo edit", exact: true }),
          ).toBeDisabled();
          await navigate(page, "library");
          await expect(panel).toBeVisible();
          await expect(
            panel.getByRole("button", { name: "Import Timeline", exact: true }),
          ).toBeDisabled();
        }
      } finally {
        release();
      }
      if (transport === "lost") {
        await expect(panel.getByRole("alert")).toBeVisible();
        await panel
          .getByRole("button", { name: "Import Timeline", exact: true })
          .click();
      }
      await expect(page.getByTestId("editor-save-state")).toContainText(
        "Saved",
      );
      await expect
        .poll(async () => {
          const state = await (
            await request.get(`${api}/compositions/film/editor`)
          ).json();
          return state.composition.tracks.length;
        })
        .toBe(3);
      await page
        .getByRole("button", { name: "Undo edit", exact: true })
        .click();
      await expect
        .poll(async () => {
          const state = await (
            await request.get(`${api}/compositions/film/editor`)
          ).json();
          return state.composition.tracks.length;
        })
        .toBe(2);
      await page.unrouteAll({ behavior: "wait" });
    } finally {
      await request.post(`${api}/project/close`, { data: {} });
      await rm(root, { recursive: true, force: true });
    }
  });
}
