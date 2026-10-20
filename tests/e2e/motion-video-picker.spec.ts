import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";
import { hashFile, localPath, runProcess } from "@openfilm/media";
import { createMotionFixture } from "../fixtures/motion-generation.js";
import { initialLocale, navigate } from "./ui-helpers.js";

test("pages and searches the full motion video Library, keeps choices and adopts an explicitly reviewed late-page source", async ({
  page,
  request,
}) => {
  await request.post("/api/project/close", { data: {} });
  const root = await mkdtemp(join(tmpdir(), "motion-picker-browser-"));
  const { app, image } = await createMotionFixture(root);
  const folder = join(root, "external");
  await mkdir(folder);
  const base = join(folder, "base.mp4");
  await runProcess("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=s=160x90:r=12:d=4",
    "-an",
    "-threads",
    "1",
    "-c:v",
    "libx264",
    base,
  ]);
  await app.importFolder(folder);
  const template = app.catalog.listAssets({ mediaType: "video", limit: 1 })[0]!;
  template.name = "Video 001";
  app.catalog.upsertAsset(template);
  // One probed synthetic MP4 supplies byte-identical regular files, avoiding 205 decodes.
  for (let number = 2; number <= 205; number++) {
    const path = join(folder, `video-${number}.mp4`);
    await copyFile(base, path);
    const asset = structuredClone(template);
    asset.id = `z-motion-${String(number).padStart(4, "0")}`;
    asset.name = `Video ${String(number).padStart(3, "0")}`;
    asset.uri = pathToFileURL(path).href;
    delete asset.metadata["openfilm.reference"];
    app.catalog.upsertAsset(asset);
  }
  const originalHash = await hashFile(localPath(image.uri));
  await app.motionGeneration.dispose();
  app.close();
  try {
    expect(
      (
        await request.post("/api/project/open", {
          data: { path: join(root, "film.openfilm") },
        })
      ).ok(),
    ).toBe(true);
    await initialLocale(page);
    await page.goto("/");
    await navigate(page, "edit");
    await page.locator("#clip-photo").first().click();
    const panel = page.getByTestId("motion-panel");
    await panel
      .getByRole("combobox", { name: "Candidate source", exact: true })
      .selectOption("local-motion-import");
    await panel
      .getByRole("button", { name: "Load Library videos", exact: true })
      .click();
    await panel.getByLabel("Video 001", { exact: true }).check();
    await panel
      .getByRole("button", { name: "Next videos", exact: true })
      .click();
    await expect(panel.getByLabel("Video 101", { exact: true })).toBeVisible();
    await panel
      .getByRole("button", { name: "Next videos", exact: true })
      .click();
    await panel.getByLabel("Video 205", { exact: true }).check();
    await expect(
      panel.getByRole("button", { name: "Next videos", exact: true }),
    ).toBeDisabled();
    await expect(panel).toContainText("Selected videos: 2 of 3");
    await panel
      .getByRole("button", { name: "Remove Video 001", exact: true })
      .click();
    await expect(panel).toContainText("Selected videos: 1 of 3");
    await panel
      .getByLabel("Search Library videos", { exact: true })
      .fill("Video 205");
    await panel
      .getByRole("button", { name: "Load Library videos", exact: true })
      .click();
    await expect(panel.getByLabel("Video 205", { exact: true })).toBeChecked();
    await expect(
      panel.getByRole("button", { name: "Previous videos", exact: true }),
    ).toBeDisabled();
    await expect(panel).toContainText("Library videos 1–1 of 1");
    await panel
      .getByLabel("Intent (stored as hash)", { exact: true })
      .fill("Synthetic external motion");
    await panel
      .getByLabel("Constraints (stored as hash)", { exact: true })
      .fill("Preserve original detail");
    await panel
      .getByLabel(
        "I approve this local candidate job; original media stays unchanged.",
      )
      .check();
    const response = page.waitForResponse(
      (value) =>
        value.request().method() === "POST" &&
        value.url().endsWith("/compositions/film/motion-generation"),
    );
    await panel
      .getByRole("button", { name: "Preview candidates", exact: true })
      .click();
    const receipts = await (await response).json();
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({
      inputAssetId: "z-motion-0205",
      origin: "external-import",
    });
    await expect(panel.locator("video")).toHaveCount(1);
    await panel
      .getByLabel(
        "I manually checked identity, details, edges and color. This does not guarantee fidelity.",
      )
      .check();
    await panel
      .getByRole("button", { name: "Accept after review", exact: true })
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
    expect(await hashFile(localPath(image.uri))).toBe(originalHash);
  } finally {
    try {
      await fetch(
        new URL("/api/project/close", test.info().project.use.baseURL),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
          signal: AbortSignal.timeout(5000),
        },
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});
