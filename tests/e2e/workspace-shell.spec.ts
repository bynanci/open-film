import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { OpenFilmApplication } from "@openfilm/application";
import { expect, test } from "@playwright/test";
import { navigate, openFilm, uiText } from "./ui-helpers.js";

const api = "http://127.0.0.1:4310/api";
let root: string;
let firstProject: string;
let secondProject: string;

test.use({ viewport: { width: 1440, height: 900 }, actionTimeout: 15_000 });

test.beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "openfilm-workspace-shell-"));
  firstProject = join(root, "first.openfilm");
  secondProject = join(root, "second.openfilm");
  for (const [path, title] of [
    [firstProject, "First story"],
    [secondProject, "Second story"],
  ]) {
    const app = await OpenFilmApplication.create(path!, title!);
    try {
      await app.save();
    } finally {
      app.close();
    }
  }
});

test.beforeEach(async ({ page, request }) => {
  await request.post(`${api}/project/close`, { data: {} });
  await page.addInitScript(() => {
    localStorage.setItem("openfilm.uiLocale", "en-US");
    localStorage.setItem(
      "openfilm.preferences.v1",
      JSON.stringify({ theme: "dark" }),
    );
  });
});

test.afterEach(async ({ request }) => {
  await request.post(`${api}/project/close`, { data: {} });
});

test.afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

test("shows fixed workspace navigation and adapts it at supported desktop widths", async ({
  page,
}) => {
  await page.goto("/");
  await openFilm(page, firstProject);

  const workspaceLabel = uiText("en-US", "app.navigation.label");
  const sidebar = page.getByRole("complementary", { name: workspaceLabel });
  const navigation = sidebar.getByRole("navigation", {
    name: workspaceLabel,
  });
  await expect(sidebar).toBeVisible();
  await expect(navigation.getByRole("button")).toHaveCount(5);
  await expect(
    navigation.getByRole("button", { name: "Library" }),
  ).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("button", { name: "Switch Project" })).toHaveCSS(
    "min-height",
    "36px",
  );
  const workspaceContent = page.locator(
    ".film-workspace.workspace-layout > .workspace-content",
  );
  await expect(workspaceContent).toHaveCSS("width", "1177px");
  expect(
    await page
      .locator(".pipeline-status-bar")
      .evaluate((element) => element.getBoundingClientRect().width),
  ).toBeGreaterThan(1440 * 0.9);

  await page.screenshot({
    path: test.info().outputPath("workspace-library-1440.png"),
    fullPage: true,
  });
  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
    { width: 1024, height: 768 },
  ]) {
    await page.setViewportSize(viewport);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 2,
      ),
      `${viewport.width}x${viewport.height} should not overflow`,
    ).toBe(true);
    await expect(
      navigation.getByRole("button", { name: "Story" }),
    ).toBeVisible();
    const workspaceWidth = await workspaceContent.evaluate(
      (element) => element.getBoundingClientRect().width,
    );
    expect(workspaceWidth).toBeGreaterThan(viewport.width * 0.7);
    if (viewport.width === 1024)
      await page.screenshot({
        path: test.info().outputPath("workspace-library-1024.png"),
        fullPage: true,
      });
  }
});

test("restores each project's last workspace without leaking it to another project", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await openFilm(page, firstProject);
  await navigate(page, "story");
  await expect(page.locator(".workspace-story")).toBeVisible();

  await page.getByRole("button", { name: "Switch Project" }).click();
  await openFilm(page, secondProject);
  await expect(page.locator(".workspace-library")).toBeVisible();
  await navigate(page, "edit");
  await expect(page.locator(".workspace-edit")).toBeVisible();

  await page.getByRole("button", { name: "Switch Project" }).click();
  await openFilm(page, firstProject);
  await expect(page.locator(".workspace-story")).toBeVisible();
  expect(
    await page.evaluate(() => {
      const value = JSON.parse(
        localStorage.getItem("openfilm.preferences.v1") ?? "{}",
      ) as { lastWorkspaceByProject?: Record<string, string> };
      return Object.values(value.lastWorkspaceByProject ?? {});
    }),
  ).toContain("story");

  await page.getByRole("button", { name: "Switch Project" }).click();
  await openFilm(page, secondProject);
  await expect(page.locator(".workspace-edit")).toBeVisible();
  const opened = await (await request.get(`${api}/project`)).json();
  expect(opened.project.title).toBe("Second story");
});
