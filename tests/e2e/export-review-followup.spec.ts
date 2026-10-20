// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createServer as createPortReservation } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, test, type APIRequestContext } from "@playwright/test";
import vue from "@vitejs/plugin-vue";
import { createServer, type ViteDevServer } from "vite";
import { OpenFilmApplication } from "@openfilm/application";
import { inspectMedia, runProcess } from "@openfilm/media";
import { startServer } from "../../apps/server/src/server.js";
import { navigate } from "./ui-helpers.js";

let root: string;
let runtime: Awaited<ReturnType<typeof startServer>>;
let frontend: ViteDevServer;
let origin: string;
let api: string;
const checkout = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

test.beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "openfilm-export-review-browser-"));
  runtime = await startServer({
    port: 0,
    userDataDirectory: join(root, "user-data"),
  });
  api = `http://127.0.0.1:${runtime.port}`;
  const reservation = createPortReservation();
  await new Promise<void>((accept) =>
    reservation.listen(0, "127.0.0.1", accept),
  );
  const reserved = reservation.address();
  if (!reserved || typeof reserved === "string")
    throw new Error("Missing ephemeral frontend port.");
  await new Promise<void>((accept, reject) =>
    reservation.close((error) => (error ? reject(error) : accept())),
  );
  frontend = await createServer({
    configFile: false,
    root: join(checkout, "apps/desktop"),
    plugins: [vue()],
    server: {
      host: "127.0.0.1",
      port: reserved.port,
      strictPort: true,
      // The fixture proxy represents the existing trusted development frontend;
      // production host/origin admission remains unchanged.
      proxy: {
        "/api": {
          target: api,
          changeOrigin: true,
          headers: { Origin: "http://127.0.0.1:1420" },
        },
      },
    },
  });
  await frontend.listen();
  const address = frontend.httpServer!.address();
  if (!address || typeof address === "string")
    throw new Error("Missing isolated browser port.");
  origin = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  await frontend?.close();
  await runtime?.close();
  if (root) await rm(root, { recursive: true, force: true });
});

async function openFilm(
  request: APIRequestContext,
  name: string,
  frameRate: number,
) {
  const source = join(root, `${name}.png`);
  await runProcess("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=s=160x90",
    "-frames:v",
    "1",
    "-threads",
    "1",
    "-y",
    source,
  ]);
  const asset = await inspectMedia({
    path: source,
    name: `${name}.png`,
    uri: pathToFileURL(source).href,
  });
  const path = join(root, `${name}.openfilm`);
  const app = await OpenFilmApplication.create(path, name);
  const duration = frameRate < 1 ? 2 : 0.25;
  try {
    app.project.settings = { width: 160, height: 90, frameRate };
    app.catalog.upsertAsset(asset);
    app.project.stories.push({
      id: "story",
      title: "Synthetic browser story",
      beats: [],
    });
    app.project.timelines.push({
      id: "film",
      storyId: "story",
      duration,
      tracks: [
        {
          id: "picture",
          type: "video",
          clips: [
            {
              id: "photo",
              assetId: asset.id,
              timelineStart: 0,
              timelineDuration: duration,
            },
          ],
        },
      ],
    });
    await app.save();
  } finally {
    app.close();
  }

  // Capture only the application opened by this isolated server fixture. This
  // lets the browser receive real polling updates after a valid canvas edit.
  let active: OpenFilmApplication | undefined;
  const open = OpenFilmApplication.open;
  OpenFilmApplication.open = async (...args: Parameters<typeof open>) => {
    const result = await open.apply(OpenFilmApplication, args);
    active = result;
    return result;
  };
  try {
    const opened = await request.post(`${api}/api/project/open`, {
      data: { path },
    });
    expect(opened.ok(), await opened.text()).toBe(true);
  } finally {
    OpenFilmApplication.open = open;
  }
  if (!active) throw new Error("Isolated application was not opened.");
  return active;
}

for (const { saved, delivery } of [
  { saved: 120, delivery: 60 },
  { saved: 0.5, delivery: 1 },
]) {
  test(`valid ${saved} fps projects retain export controls and deliver at ${delivery} fps`, async ({
    page,
    request,
  }) => {
    const app = await openFilm(request, `rate-${saved}`, saved);
    const before = structuredClone({
      settings: app.project.settings,
      timelines: app.project.timelines,
    });
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.addInitScript(() =>
      localStorage.setItem("openfilm.uiLocale", "en-US"),
    );
    await page.goto(origin);
    await navigate(page, "export", "en-US");
    const profiled = page.getByTestId("export-profile-mp4");
    await expect(profiled).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId("export-frame")).toContainText(`${saved}`);
    await expect(page.getByTestId("export-profile-size")).toContainText(
      `${delivery} fps`,
    );
    for (const [testId, endpoint] of [
      ["preview-export-frame", "/api/export/frame-preview"],
      ["export-still", "/api/export/still"],
      ["export-audio-mix", "/api/export/audio"],
      ["export-audio-stems", "/api/export/audio"],
    ] as const) {
      const response = page.waitForResponse(
        (entry) =>
          entry.url().endsWith(endpoint) && entry.request().method() === "POST",
      );
      await page.getByTestId(testId).click();
      const received = await response;
      expect(received.ok(), await received.text()).toBe(true);
      expect(received.request().postDataJSON().profile.frameRate).toBe(
        delivery,
      );
    }
    const rendered = page.waitForResponse(
      (entry) =>
        entry.url().endsWith("/api/export") &&
        entry.request().method() === "POST",
    );
    await profiled.click();
    const result = await rendered;
    expect(result.ok(), await result.text()).toBe(true);
    expect(result.request().postDataJSON().exportProfile.frameRate).toBe(
      delivery,
    );
    const output = await result.json();
    const receipt = JSON.parse(
      await readFile(`${output.path}.manifest.json`, "utf8"),
    );
    expect(receipt.exportProfile.frameRate).toBe(delivery);
    expect(receipt.settings.frameRate).toBe(saved);
    const probe = JSON.parse(
      (
        await runProcess("ffprobe", [
          "-v",
          "error",
          "-count_frames",
          "-show_entries",
          "stream=codec_type,r_frame_rate,nb_read_frames",
          "-of",
          "json",
          output.path,
        ])
      ).stdout.toString("utf8"),
    );
    expect(
      probe.streams.find(
        (stream: { codec_type: string }) => stream.codec_type === "video",
      ),
    ).toMatchObject({
      r_frame_rate: `${delivery}/1`,
      nb_read_frames: String(
        Math.floor(before.timelines[0]!.duration * delivery),
      ),
    });
    expect({
      settings: app.project.settings,
      timelines: app.project.timelines,
    }).toEqual(before);
    expect(pageErrors).toEqual([]);
  });
}

test("equivalent project polling preserves the reviewed crop and confirmation", async ({
  page,
  request,
}) => {
  const app = await openFilm(request, "equivalent-poll", 12);
  await page.addInitScript(() =>
    localStorage.setItem("openfilm.uiLocale", "en-US"),
  );
  await page.goto(origin);
  await navigate(page, "export", "en-US");
  await page.getByTestId("export-framing").selectOption("crop");
  await page.getByTestId("preview-export-frame").click();
  const image = page.getByTestId("export-preview-image");
  await expect(image).toBeVisible();
  const reviewedUrl = await image.getAttribute("src");
  await page.getByTestId("confirm-export-crop").check();
  const snapshot = structuredClone(app.project);
  const polled = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/project") &&
      response.request().method() === "GET",
  );
  app.catalog.saveJob({
    id: "equivalent-refresh",
    type: "import",
    status: "completed",
    progress: 1,
    createdAt: new Date().toISOString(),
  });
  await polled;
  await expect(image).toHaveAttribute("src", reviewedUrl!);
  await expect(page.getByTestId("confirm-export-crop")).toBeChecked();
  await expect(page.getByTestId("export-profile-mp4")).toBeEnabled();
  expect(app.project).toEqual(snapshot);
});

for (const dimension of ["width", "height"] as const) {
  test(`a polled saved ${dimension} edit clears the crop image and approval`, async ({
    page,
    request,
  }) => {
    const app = await openFilm(request, `canvas-${dimension}`, 12);
    await page.addInitScript(() =>
      localStorage.setItem("openfilm.uiLocale", "en-US"),
    );
    await page.goto(origin);
    await navigate(page, "export", "en-US");
    await page.getByTestId("export-framing").selectOption("crop");
    await page.getByTestId("preview-export-frame").click();
    const image = page.getByTestId("export-preview-image");
    await expect(image).toBeVisible();
    await page.getByTestId("confirm-export-crop").check();
    await expect(page.getByTestId("export-profile-mp4")).toBeEnabled();
    app.project.settings[dimension] += 2;
    await app.save();
    // A fixture completion event requests the normal project polling refresh;
    // Composition, project ID and frame rate remain identical.
    app.catalog.saveJob({
      id: `canvas-refresh-${dimension}`,
      type: "import",
      status: "completed",
      progress: 1,
      createdAt: new Date().toISOString(),
    });
    await expect(page.getByTestId("export-frame")).toContainText(
      `${app.project.settings.width} × ${app.project.settings.height}`,
    );
    await expect(image).toHaveCount(0, { timeout: 5000 });
    await expect(page.getByTestId("confirm-export-crop")).not.toBeChecked();
    await expect(page.getByTestId("confirm-export-crop")).toBeDisabled();
    await expect(page.getByTestId("export-profile-mp4")).toBeDisabled();
    await expect(page.getByTestId("export-still")).toBeDisabled();
  });
}
