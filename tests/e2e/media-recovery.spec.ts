import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type APIRequestContext } from "@playwright/test";
import type { Job, MediaAsset } from "@openfilm/core";
import { runProcess } from "@openfilm/media";
import { initialLocale, uiText } from "./ui-helpers.js";

const base = "http://127.0.0.1:4310/api";
async function completed(request: APIRequestContext, id: string) {
  await expect
    .poll(
      async () => {
        const response = await request.get(`${base}/jobs`);
        const { jobs } = (await response.json()) as { jobs: Job[] };
        return jobs.find((job) => job.id === id)?.status;
      },
      { timeout: 20_000 },
    )
    .toBe("completed");
}

test("repairs a managed photo thumbnail in the existing Library card without changing its identity", async ({
  page,
  request,
}) => {
  const root = await mkdtemp(join(tmpdir(), "openfilm-thumbnail-recovery-"));
  const project = join(root, "Recovered film.openfilm");
  const name = "回憶  思い出 # &.png";
  const original = join(root, name);
  // One small generated public-domain image; no video render is needed here.
  await runProcess("ffmpeg", [
    "-v",
    "error",
    "-nostdin",
    "-f",
    "lavfi",
    "-i",
    "color=teal:s=96x64",
    "-frames:v",
    "1",
    "-threads",
    "1",
    "-y",
    original,
  ]);
  const originalBytes = await readFile(original);
  try {
    expect(
      (await request.post(`${base}/project/close`, { data: {} })).ok(),
    ).toBe(true);
    const created = await request.post(`${base}/project/create`, {
      data: { title: "Recovered memory", path: project },
    });
    expect(created.ok()).toBe(true);
    const uploaded = await request.post(
      `${base}/import/upload?${new URLSearchParams({ name })}`,
      {
        headers: { "Content-Type": "application/octet-stream" },
        data: originalBytes,
      },
    );
    expect(uploaded.status()).toBe(201);
    const receipt = await uploaded.json();
    const imported = await request.post(`${base}/import`, {
      data: { uploads: [receipt.uploadId] },
    });
    expect(imported.status()).toBe(202);
    await completed(request, (await imported.json()).jobId);
    const before = (await (await request.get(`${base}/assets`)).json())
      .assets[0] as MediaAsset;
    expect(before.name).toBe(name);
    expect(before.thumbnailUri).toBeTruthy();
    expect(before.metadata["openfilm.managedSource"]).toBeTruthy();
    const thumbnail = join(project, before.thumbnailUri!);
    await rm(thumbnail);

    await initialLocale(page);
    await page.goto("/");
    const card = page.locator(".asset-card").filter({
      has: page.getByRole("button", {
        name: uiText("en-US", "media.card.inspect", { name }),
        exact: true,
      }),
    });
    await expect(card).toBeVisible();
    await expect(card.locator(".thumbnail-empty")).toBeVisible();
    await expect(card.locator("img")).toHaveCount(0);
    const originalCard = await card.elementHandle();
    expect(originalCard).not.toBeNull();
    const documentMarker = await page.evaluate(() => {
      const marker = crypto.randomUUID();
      document.documentElement.dataset.recoveryDocument = marker;
      return marker;
    });

    // Reimport the catalog-owned original. The project and Library stay open.
    const rebuilt = await request.post(`${base}/import`, {
      data: { files: [fileURLToPath(before.uri)] },
    });
    expect(rebuilt.status()).toBe(202);
    await completed(request, (await rebuilt.json()).jobId);
    // Import completion polling refreshes the catalog object with identical URIs.
    await expect
      .poll(
        async () =>
          card
            .locator("img")
            .evaluateAll((images) =>
              images.some(
                (image) =>
                  (image as HTMLImageElement).complete &&
                  (image as HTMLImageElement).naturalWidth > 0,
              ),
            ),
        { timeout: 15_000 },
      )
      .toBe(true);
    await expect(card.locator(".thumbnail-empty")).toHaveCount(0);
    expect(
      await page.evaluate(
        (element) => element === document.querySelector(".asset-card"),
        originalCard,
      ),
    ).toBe(true);
    expect(
      await page.locator("html").getAttribute("data-recovery-document"),
    ).toBe(documentMarker);
    const after = (await (await request.get(`${base}/assets`)).json())
      .assets[0] as MediaAsset;
    expect(after.id).toBe(before.id);
    expect(after.uri).toBe(before.uri);
    expect(after.thumbnailUri).toBe(before.thumbnailUri);
    expect(after.contentHash).toBe(before.contentHash);
    expect(await readFile(original)).toEqual(originalBytes);
    expect(await readFile(fileURLToPath(after.uri))).toEqual(originalBytes);
    expect((await readFile(thumbnail)).length).toBeGreaterThan(0);
  } finally {
    await request.post(`${base}/project/close`, { data: {} });
    await rm(root, { recursive: true, force: true });
  }
});
