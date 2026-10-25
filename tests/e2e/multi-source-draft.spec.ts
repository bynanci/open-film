import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, test, type Page } from "@playwright/test";
import { createFilm, initialLocale, openFilm, uiText } from "./ui-helpers.js";

const api = "http://127.0.0.1:4310/api";
let root: string;
let firstProject: string;
let secondProject: string;
let uploadProject: string;
let sources: string[];

test.use({ viewport: { width: 1280, height: 800 }, actionTimeout: 15_000 });

test.beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "openfilm-source-draft-"));
  firstProject = join(root, "旅程.openfilm");
  secondProject = join(root, "第二部.openfilm");
  uploadProject = join(root, "上傳取消.openfilm");
  sources = await Promise.all(
    Array.from({ length: 5 }, async (_, index) => {
      const path = join(root, `合成片段-${index + 1}.mp4`);
      await writeFile(path, `synthetic source ${index + 1}`);
      return path;
    }),
  );
});

test.beforeEach(async ({ page, request }) => {
  await request.post(`${api}/project/close`, { data: {} });
  await initialLocale(page, "zh-TW");
});

test.afterAll(async () => {
  await fetch(`${api}/project/close`, { method: "POST" });
  await rm(root, { recursive: true, force: true });
});

function panel(page: Page) {
  return page.getByRole("region", {
    name: uiText("zh-TW", "app.import.label"),
    exact: true,
  });
}

async function openImport(page: Page) {
  if (await panel(page).isVisible()) return;
  await page
    .getByRole("button", {
      name: uiText("zh-TW", "app.library.add"),
      exact: true,
    })
    .click();
}

test("accumulates a private source draft across choices, modes, reload and project switches", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await createFilm(
    page,
    { title: "京都與日常", path: firstProject, contentLocale: "zh-TW" },
    "zh-TW",
  );
  const importPanel = panel(page);
  const fileInput = importPanel.getByLabel(
    uiText("zh-TW", "app.import.addFiles"),
    { exact: true },
  );

  await fileInput.setInputFiles(sources.slice(0, 3));
  await expect(importPanel.locator(".import-source-card")).toHaveCount(3);
  await fileInput.setInputFiles(sources.slice(3));
  await expect(importPanel.locator(".import-source-card")).toHaveCount(5);
  await fileInput.setInputFiles([]);
  await expect(importPanel.locator(".import-source-card")).toHaveCount(5);

  const firstDraft = await (await request.get(`${api}/import-draft`)).json();
  expect(firstDraft.draft.selections).toHaveLength(5);
  expect(
    firstDraft.draft.selections.every((source: { displayName: string }) =>
      source.displayName.startsWith("合成片段-"),
    ),
  ).toBe(true);
  expect(
    (await (await request.get(`${api}/jobs`)).json()).jobs.filter(
      (job: { type: string }) => job.type === "import",
    ),
  ).toHaveLength(0);

  await page
    .getByRole("combobox", {
      name: uiText("zh-TW", "app.workspaceMode.label"),
      exact: true,
    })
    .selectOption("expert");
  await expect(importPanel.locator("code")).toHaveCount(5);
  expect(
    (await (await request.get(`${api}/import-draft`)).json()).draft,
  ).toEqual(firstDraft.draft);

  await page.setViewportSize({ width: 640, height: 720 });
  await expect(
    importPanel.getByText("合成片段-1.mp4", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 2,
    ),
  ).toBe(true);

  await page.reload();
  await openImport(page);
  await expect(panel(page).locator(".import-source-card")).toHaveCount(5);
  await expect(
    panel(page).getByText(
      uiText("zh-TW", "app.import.access.needs-reselection"),
      { exact: true },
    ),
  ).toHaveCount(5);

  await page
    .getByRole("button", {
      name: uiText("zh-TW", "app.navigation.switchProject"),
      exact: true,
    })
    .click();
  await createFilm(
    page,
    { title: "第二部", path: secondProject, contentLocale: "zh-TW" },
    "zh-TW",
  );
  await expect(panel(page).locator(".import-source-card")).toHaveCount(0);
  const secondDraft = await (await request.get(`${api}/import-draft`)).json();
  expect(secondDraft.draft.projectId).not.toBe(firstDraft.draft.projectId);
  expect(secondDraft.draft.selections).toEqual([]);

  await page
    .getByRole("button", {
      name: uiText("zh-TW", "app.navigation.switchProject"),
      exact: true,
    })
    .click();
  await openFilm(page, firstProject, "zh-TW");
  await openImport(page);
  await expect(panel(page).locator(".import-source-card")).toHaveCount(5);
  expect(
    (await (await request.get(`${api}/import-draft`)).json()).draft,
  ).toEqual(firstDraft.draft);
});

test("keeps upload cancellation reachable and prevents closing while a browser upload is active", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await createFilm(
    page,
    { title: "上傳取消", path: uploadProject, contentLocale: "zh-TW" },
    "zh-TW",
  );
  const importPanel = panel(page);
  await importPanel
    .getByLabel(uiText("zh-TW", "app.import.addFiles"), { exact: true })
    .setInputFiles(sources[0]!);
  await expect(importPanel.locator(".import-source-card")).toHaveCount(1);

  let releaseUpload!: () => void;
  const heldUpload = new Promise<void>((resolve) => {
    releaseUpload = resolve;
  });
  let sawUpload!: () => void;
  const uploadStarted = new Promise<void>((resolve) => {
    sawUpload = resolve;
  });
  await page.route("**/api/import/upload?*", async (route) => {
    sawUpload();
    await heldUpload;
    try {
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ uploadId: "should-not-be-used" }),
      });
    } catch {
      // The expected client-side abort can close the intercepted request first.
    }
  });

  try {
    await importPanel
      .getByRole("button", {
        name: uiText("zh-TW", "app.import.startCompatible"),
        exact: true,
      })
      .click();
    await uploadStarted;

    const close = importPanel.getByRole("button", {
      name: uiText("zh-TW", "app.import.close"),
      exact: true,
    });
    await expect(close).toBeDisabled();
    const cancel = importPanel.getByRole("button", {
      name: uiText("zh-TW", "app.import.cancelUpload"),
      exact: true,
    });
    await expect(cancel).toBeVisible();
    await cancel.click();
    await expect(close).toBeEnabled();

    const jobs = (await (await request.get(`${api}/jobs`)).json()).jobs;
    expect(
      jobs.filter((job: { type: string }) => job.type === "import"),
    ).toHaveLength(0);
    expect(
      (await (await request.get(`${api}/import-draft`)).json()).draft
        .selections,
    ).toHaveLength(1);
  } finally {
    releaseUpload();
    await page.unroute("**/api/import/upload?*");
  }
});

test("persists an opaque browser handle record through real IndexedDB transactions and reload", async ({
  page,
}) => {
  await page.goto("/");
  const projectId = `indexeddb-regression-${Date.now()}`;
  const accessRef = await page.evaluate(async (owner) => {
    const modulePath = "/src/browserSourceAccess.ts";
    const { BrowserSourceAccessRegistry } = (await import(
      /* @vite-ignore */ modulePath
    )) as typeof import("../../apps/desktop/src/browserSourceAccess.js");
    const registry = new BrowserSourceAccessRegistry();
    return registry.rememberHandle(owner, {
      kind: "directory",
      name: "Synthetic private source",
    });
  }, projectId);
  expect(accessRef).toMatch(/^browser-handle:/u);

  await page.reload();
  const reopened = await page.evaluate(
    async ({ owner, key }) => {
      const modulePath = "/src/browserSourceAccess.ts";
      const { BrowserSourceAccessRegistry } = (await import(
        /* @vite-ignore */ modulePath
      )) as typeof import("../../apps/desktop/src/browserSourceAccess.js");
      const registry = new BrowserSourceAccessRegistry();
      const availability = await registry.availability(owner, {
        accessClass: "persistent-browser-handle",
        accessRef: key,
      });
      await registry.removeHandle(owner, key);
      return availability;
    },
    { owner: projectId, key: accessRef },
  );
  expect(reopened).toBe("needs-permission");

  await expect(
    page.evaluate(
      async ({ owner, key }) => {
        const modulePath = "/src/browserSourceAccess.ts";
        const { BrowserSourceAccessRegistry } = (await import(
          /* @vite-ignore */ modulePath
        )) as typeof import("../../apps/desktop/src/browserSourceAccess.js");
        return new BrowserSourceAccessRegistry().availability(owner, {
          accessClass: "persistent-browser-handle",
          accessRef: key,
        });
      },
      { owner: projectId, key: accessRef },
    ),
  ).resolves.toBe("needs-reselection");
});
