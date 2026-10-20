import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, test } from "@playwright/test";
import { createMotionFixture } from "../fixtures/motion-generation.js";
import { initialLocale, navigate } from "./ui-helpers.js";
const api = "http://127.0.0.1:4310/api";
test("reviews motion locally, explicitly replaces, reopens and restores", async ({
  page,
  request,
}) => {
  await request.post(`${api}/project/close`, { data: {} });
  const root = await mkdtemp(join(tmpdir(), "motion-browser-"));
  const { app } = await createMotionFixture(root);
  await app.motionGeneration.dispose();
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
    await page.locator("#clip-photo").first().click();
    const panel = page.getByTestId("motion-panel");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("Remote generation is disabled");
    await panel
      .getByLabel("Intent (stored as hash)", { exact: true })
      .fill("Synthetic cloud camera motion");
    await panel
      .getByLabel("Constraints (stored as hash)", { exact: true })
      .fill("Preserve details");
    const generate = panel.getByRole("button", {
      name: "Preview candidates",
      exact: true,
    });
    await expect(generate).toBeDisabled();
    await panel
      .getByLabel(
        "I approve this local candidate job; original media stays unchanged.",
      )
      .check();
    await generate.click();
    await expect(panel.locator("video")).toHaveCount(2);
    await panel
      .getByLabel(
        "I approve this local candidate job; original media stays unchanged.",
      )
      .uncheck();
    await expect(panel.locator("video")).toHaveCount(0);
    await expect(
      panel.getByRole("button", { name: "Accept after review", exact: true }),
    ).toHaveCount(0);
    await panel
      .getByLabel(
        "I approve this local candidate job; original media stays unchanged.",
      )
      .check();
    await generate.click();
    await expect(panel.locator("video")).toHaveCount(2);
    await expect(
      panel
        .getByRole("button", { name: "Accept after review", exact: true })
        .first(),
    ).toBeDisabled();
    await panel
      .getByLabel(
        "I manually checked identity, details, edges and color. This does not guarantee fidelity.",
      )
      .check();
    await panel
      .getByRole("button", { name: "Accept after review", exact: true })
      .first()
      .click();
    await panel
      .getByRole("button", { name: "Replace selected photo clip", exact: true })
      .click();
    await expect(
      panel.getByRole("button", {
        name: "Restore original photo / M8A",
        exact: true,
      }),
    ).toBeVisible();
    await page.reload();
    await navigate(page, "edit");
    await page.locator("#clip-photo").first().click();
    await panel
      .getByRole("button", {
        name: "Restore original photo / M8A",
        exact: true,
      })
      .click();
    await expect
      .poll(async () => {
        const state = await (
          await request.get(`${api}/compositions/film/editor`)
        ).json();
        return state.assets.find(
          (a: { id: string; mediaType: string }) =>
            a.id === state.composition.tracks[0].clips[0].assetId,
        )?.mediaType;
      })
      .toBe("image");
    await expect(
      page.getByRole("button", { name: "Undo edit", exact: true }),
    ).toBeEnabled();
  } finally {
    await request.post(`${api}/project/close`, { data: {} });
    await rm(root, { recursive: true, force: true });
  }
});
