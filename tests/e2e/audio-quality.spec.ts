import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, test } from "@playwright/test";
import { createAudioQualityFixture } from "../fixtures/audio-quality.js";
import { initialLocale, navigate } from "./ui-helpers.js";
const api = "http://127.0.0.1:4310/api";
test("reviews decoded MP4 audio, auditions B and accepts through normal saved history", async ({
  page,
  request,
}) => {
  await request.post(`${api}/project/close`, { data: {} });
  const root = await mkdtemp(join(tmpdir(), "openfilm-audio-browser-"));
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
    await page.getByRole("button", { name: "Sound", exact: true }).click();
    await page.locator(".editor-soundtrack-list button").first().click();
    await page
      .getByRole("button", { name: "Audio quality", exact: true })
      .click();
    await page.getByTestId("audio-quality-measure").click();
    await expect(page.getByTestId("audio-quality-accept")).toBeEnabled({
      timeout: 30000,
    });
    const panel = page.locator(".audio-quality-panel");
    await expect(panel).toContainText("Integrated LUFS");
    await panel.getByRole("button", { name: "B · Suggested mix" }).click();
    await expect(panel.locator("audio")).toHaveAttribute("src", /candidate/u);
    await page.getByTestId("audio-quality-accept").click();
    await expect(page.getByTestId("editor-save-state")).toContainText("Saved");
    const state = await (
      await request.get(`${api}/compositions/film/editor`)
    ).json();
    expect(state.composition.tracks[1].clips[0].transform.volume).toBeLessThan(
      0.8,
    );
    expect(
      state.composition.tracks[1].clips[0].audioAutomation.ducking,
    ).toHaveLength(1);
    await page.getByRole("button", { name: "Undo edit", exact: true }).click();
    await expect
      .poll(async () => {
        const result = await (
          await request.get(`${api}/compositions/film/editor`)
        ).json();
        return result.composition.tracks[1].clips[0].transform.volume;
      })
      .toBe(0.8);
  } finally {
    await request.post(`${api}/project/close`, { data: {} });
    await rm(root, { recursive: true, force: true });
  }
});
