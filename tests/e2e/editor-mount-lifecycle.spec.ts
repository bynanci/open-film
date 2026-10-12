import { link, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { OpenFilmApplication } from "@openfilm/application";
import { runProcess } from "@openfilm/media";
import type { EditorState } from "../../apps/desktop/src/api.js";
import { initialLocale, navigate, openFilm } from "./ui-helpers.js";

const base = "http://127.0.0.1:4310/api";
const compositionId = "shared-cut-id";
let root: string;
let source: string;
let sourceHash: string;

test.use({ actionTimeout: 15_000, viewport: { width: 1280, height: 720 } });
test.beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "openfilm-editor-mount-"));
  source = join(root, "generated.png");
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
    source,
  ]);
  sourceHash = createHash("sha256")
    .update(await readFile(source))
    .digest("hex");
});
test.beforeEach(async ({ page, request }) => {
  expect((await request.post(`${base}/project/close`, { data: {} })).ok()).toBe(
    true,
  );
  await initialLocale(page);
});
test.afterEach(async ({ request }) => {
  expect((await request.post(`${base}/project/close`, { data: {} })).ok()).toBe(
    true,
  );
});
test.afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

async function prepareProject(name: string, withOtherComposition = false) {
  const path = join(root, `${name}.openfilm`);
  const app = await OpenFilmApplication.create(path, name);
  const id = app.project.id;
  try {
    for (let index = 0; index < 2; index++) {
      const assetSource = join(root, `${name}-${index}.png`);
      await link(source, assetSource);
      app.catalog.upsertAsset({
        id: `asset-${index}`,
        name: `${name}-${index}.png`,
        uri: pathToFileURL(assetSource).href,
        mediaType: "image",
        dimensions: { width: 96, height: 64 },
        contentHash: sourceHash,
        tags: [],
        state: {},
        metadata: {},
      });
    }
    app.project.stories.push({
      id: "shared-story-id",
      title: name,
      targetDuration: 8,
      maxDuration: 12,
      beats: [
        {
          id: "beat",
          title: "Our memories",
          targetDuration: 8,
          candidateAssetIds: ["asset-0", "asset-1"],
        },
      ],
    });
    app.project.timelines.push({
      id: compositionId,
      storyId: "shared-story-id",
      duration: 8,
      tracks: [
        {
          id: "visual",
          type: "video",
          clips: [0, 1].map((index) => ({
            id: `clip-${index}`,
            assetId: `asset-${index}`,
            beatId: "beat",
            timelineStart: index * 4,
            timelineDuration: 4,
          })),
        },
      ],
    });
    if (withOtherComposition) {
      const other = structuredClone(app.project.timelines[0]!);
      other.id = "other-cut";
      for (const track of other.tracks)
        for (const clip of track.clips) clip.id = `other-${clip.id}`;
      // The initial active composition remains the final entry.
      app.project.timelines.unshift(other);
    }
    await app.save();
  } finally {
    app.close();
  }
  return { id, path, storageKey: `openfilm:editor:${id}:${compositionId}` };
}
async function open(request: APIRequestContext, path: string) {
  expect(
    (await request.post(`${base}/project/open`, { data: { path } })).ok(),
  ).toBe(true);
}
async function readEditor(
  request: APIRequestContext,
  id = compositionId,
): Promise<EditorState> {
  const response = await request.get(`${base}/compositions/${id}/editor`);
  expect(response.ok()).toBe(true);
  return response.json();
}
async function libraryReady(page: Page) {
  await expect(
    page.getByRole("button", { name: "Switch project", exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".workspace-library")).toBeVisible();
  await expect(page.locator(".asset-card")).toHaveCount(2);
}
function editorRequests(page: Page) {
  const paths: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.endsWith(`/compositions/${compositionId}/editor`))
      paths.push(path);
  });
  return paths;
}

test("defers an untouched editor, then retains selection and history across workspace navigation", async ({
  page,
  request,
}) => {
  const project = await prepareProject("First visit");
  await open(request, project.path);
  const reads = editorRequests(page);
  await page.goto("/");
  await libraryReady(page);
  await expect(page.locator(".timeline-editor")).toHaveCount(0);
  expect(reads).toHaveLength(0);

  await navigate(page, "edit");
  await expect(page.locator(".editor-save-state")).toHaveText("Saved");
  expect(reads).toHaveLength(1);
  const second = page.locator("#clip-clip-1");
  await second.click();
  await expect(second).toHaveAttribute("aria-pressed", "true");
  await second.evaluate((element) =>
    element.setAttribute("data-instance-proof", "retained"),
  );
  await page
    .getByRole("button", {
      name: "Set photo duration to 5 seconds",
      exact: true,
    })
    .click();
  await expect(page.locator(".editor-save-state")).toHaveText("Saved");
  expect(
    (await readEditor(request)).composition.tracks[0]!.clips[1]!
      .timelineDuration,
  ).toBe(5);

  for (let round = 0; round < 3; round++) {
    await navigate(page, "library");
    await libraryReady(page);
    await expect(page.locator(".timeline-editor")).toHaveCount(1);
    await expect(page.locator(".editor-clip")).toHaveCount(2);
    await expect(second).toHaveAttribute("data-instance-proof", "retained");
    await navigate(page, "edit");
    await expect(page.locator(".editor-save-state")).toHaveText("Saved");
    await expect(second).toHaveAttribute("aria-pressed", "true");
    await expect(second).toHaveAttribute("data-instance-proof", "retained");
    // Returning keeps the existing one-snapshot refresh, without remounting
    // another editor or adding a second initialization request.
    expect(reads).toHaveLength(round + 2);
  }
  await page.getByRole("button", { name: "Undo edit", exact: true }).click();
  await expect(page.locator(".editor-save-state")).toHaveText("Saved");
  expect(
    (await readEditor(request)).composition.tracks[0]!.clips[1]!
      .timelineDuration,
  ).toBe(4);
});

test("a project switch does not transfer an activated editor to another project with the same composition ID", async ({
  page,
  request,
}) => {
  const first = await prepareProject("First project");
  const second = await prepareProject("Second project");
  await open(request, first.path);
  const reads = editorRequests(page);
  await page.goto("/");
  await libraryReady(page);
  await navigate(page, "edit");
  await expect(page.locator(".editor-save-state")).toHaveText("Saved");
  const readsBeforeSwitch = reads.length;
  await page
    .getByRole("button", { name: "Switch project", exact: true })
    .click();
  // Another project's recovery bytes must not activate this project's editor,
  // even when imported projects happen to share composition and clip IDs.
  await page.evaluate(
    (key) => localStorage.setItem(key, "{unrelated recovery draft"),
    first.storageKey,
  );
  await openFilm(page, second.path);
  await libraryReady(page);
  await expect(page.locator(".timeline-editor")).toHaveCount(0);
  expect(reads).toHaveLength(readsBeforeSwitch);
  await navigate(page, "edit");
  await expect(page.locator(".editor-save-state")).toHaveText("Saved");
  await expect(page.locator("#clip-clip-0")).toContainText(
    "Second project-0.png",
  );
  expect(reads).toHaveLength(readsBeforeSwitch + 1);
});

test("eagerly recovers a pending local draft before allowing a Story navigation to flush it", async ({
  page,
  request,
}) => {
  const project = await prepareProject("Recovery first");
  await open(request, project.path);
  const state = await readEditor(request);
  await page.addInitScript(
    ({ key, value }) => localStorage.setItem(key, value),
    {
      key: project.storageKey,
      value: JSON.stringify({
        state,
        pending: [{ type: "duration", clipId: "clip-0", duration: 5 }],
        batch: null,
      }),
    },
  );
  await page.route(`**/api/compositions/${compositionId}/edit`, (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: "Save unavailable",
        code: "operation.failed",
      }),
    }),
  );
  await page.goto("/");
  await libraryReady(page);
  await expect(page.locator(".timeline-editor")).toHaveCount(1);
  await expect(page.locator(".editor-save-state")).toHaveText("Save failed");
  await navigate(page, "story");
  await expect(page.locator(".workspace-library")).toBeVisible();
  await expect(page.locator(".feedback.error")).toBeVisible();
  expect(
    (await readEditor(request)).composition.tracks[0]!.clips[0]!
      .timelineDuration,
  ).toBe(4);
  expect(
    await page.evaluate((key) => localStorage.getItem(key), project.storageKey),
  ).not.toBeNull();
  await page.unroute(`**/api/compositions/${compositionId}/edit`);
  await navigate(page, "story");
  await expect(page.locator(".workspace-story")).toBeVisible();
  expect(
    (await readEditor(request)).composition.tracks[0]!.clips[0]!
      .timelineDuration,
  ).toBe(5);
  expect(
    await page.evaluate((key) => localStorage.getItem(key), project.storageKey),
  ).toBeNull();
});

test("blocks Export and project switching while an eager recovery read is pending", async ({
  page,
  request,
}) => {
  const project = await prepareProject("Delayed recovery");
  await open(request, project.path);
  const state = await readEditor(request);
  await page.addInitScript(
    ({ key, value }) => localStorage.setItem(key, value),
    {
      key: project.storageKey,
      value: JSON.stringify({
        state,
        pending: [{ type: "duration", clipId: "clip-0", duration: 5 }],
        batch: null,
      }),
    },
  );
  let releaseRead!: () => void;
  const readGate = new Promise<void>((resolve) => {
    releaseRead = resolve;
  });
  let signalRead!: () => void;
  const readStarted = new Promise<void>((resolve) => {
    signalRead = resolve;
  });
  await page.route(
    `**/api/compositions/${compositionId}/editor`,
    async (route) => {
      signalRead();
      await readGate;
      await route.continue();
    },
    { times: 1 },
  );
  const writes: string[] = [];
  page.on("request", (entry) => {
    if (entry.method() === "POST") writes.push(new URL(entry.url()).pathname);
  });
  try {
    await page.goto("/");
    await readStarted;
    await libraryReady(page);
    await expect(page.locator(".editor-save-state")).toHaveText("Opening cut…");
    await navigate(page, "export");
    await expect(page.locator(".workspace-library")).toBeVisible();
    await page
      .getByRole("button", { name: "Switch project", exact: true })
      .click();
    await expect(page.locator(".workspace-library")).toBeVisible();
    expect(writes).toEqual([]);
    expect(
      await page.evaluate(
        (key) => localStorage.getItem(key),
        project.storageKey,
      ),
    ).not.toBeNull();
  } finally {
    releaseRead();
  }
  await expect(page.locator(".editor-save-state")).toHaveText("Save failed");
  await navigate(page, "export");
  await expect(page.locator(".workspace-export")).toBeVisible();
  expect(
    (await readEditor(request)).composition.tracks[0]!.clips[0]!
      .timelineDuration,
  ).toBe(5);
  expect(writes).toEqual([`/api/compositions/${compositionId}/edit`]);
});

test("switching compositions in Edit activates the new editor and preserves its recovery flush gate", async ({
  page,
  request,
}) => {
  const project = await prepareProject("Two compositions", true);
  await open(request, project.path);
  const otherState = await readEditor(request, "other-cut");
  const otherStorageKey = `openfilm:editor:${project.id}:other-cut`;
  await page.addInitScript(
    ({ key, value }) => localStorage.setItem(key, value),
    {
      key: otherStorageKey,
      value: JSON.stringify({
        state: otherState,
        pending: [{ type: "duration", clipId: "other-clip-0", duration: 6 }],
        batch: null,
      }),
    },
  );
  await page.route("**/api/compositions/other-cut/edit", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: "Save unavailable",
        code: "operation.failed",
      }),
    }),
  );
  await page.goto("/");
  await libraryReady(page);
  await expect(page.locator(".timeline-editor")).toHaveCount(0);
  await navigate(page, "edit");
  await expect(page.locator(".editor-save-state")).toHaveText("Saved");
  const selector = page.getByLabel("Active composition", { exact: true });
  await selector.selectOption("other-cut");
  await expect(page.locator("#clip-other-clip-0")).toBeVisible();
  await expect(page.locator(".editor-save-state")).toHaveText("Save failed");
  await selector.selectOption(compositionId);
  await expect(selector).toHaveValue("other-cut");
  await expect(page.locator("#clip-other-clip-0")).toBeVisible();
  expect(
    (await readEditor(request)).composition.tracks[0]!.clips[0]!
      .timelineDuration,
  ).toBe(4);
  expect(
    (await readEditor(request, "other-cut")).composition.tracks[0]!.clips[0]!
      .timelineDuration,
  ).toBe(4);
  expect(
    await page.evaluate((key) => localStorage.getItem(key), otherStorageKey),
  ).not.toBeNull();
  await page.unroute("**/api/compositions/other-cut/edit");
  await selector.selectOption(compositionId);
  await expect(page.locator("#clip-clip-0")).toBeVisible();
  await expect(page.locator(".editor-save-state")).toHaveText("Saved");
  expect(
    (await readEditor(request, "other-cut")).composition.tracks[0]!.clips[0]!
      .timelineDuration,
  ).toBe(6);
  expect(
    await page.evaluate((key) => localStorage.getItem(key), otherStorageKey),
  ).toBeNull();
  await selector.selectOption("other-cut");
  await expect(page.locator("#clip-other-clip-0")).toBeVisible();
  await expect(page.locator(".editor-save-state")).toHaveText("Saved");
  await expect(page.getByLabel("Photo duration", { exact: true })).toHaveValue(
    "6",
  );
});

for (const storage of ["malformed", "empty", "unavailable"] as const) {
  test(`keeps existing eager recovery when draft storage is ${storage}`, async ({
    page,
    request,
  }) => {
    const project = await prepareProject(`Storage ${storage}`);
    await open(request, project.path);
    await page.addInitScript(
      ({ key, mode }) => {
        if (mode === "unavailable") {
          const getItem = Storage.prototype.getItem;
          Storage.prototype.getItem = function (name) {
            if (name.startsWith("openfilm:editor:"))
              throw new DOMException("Blocked", "SecurityError");
            return getItem.call(this, name);
          };
        } else localStorage.setItem(key, mode === "empty" ? "" : "{bad JSON");
      },
      { key: project.storageKey, mode: storage },
    );
    const reads = editorRequests(page);
    await page.goto("/");
    await libraryReady(page);
    await expect(page.locator(".editor-save-state")).toHaveText("Saved");
    await expect(page.locator(".timeline-editor")).toHaveCount(1);
    expect(reads).toHaveLength(1);
  });
}
