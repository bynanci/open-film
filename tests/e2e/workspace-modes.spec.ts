import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { OpenFilmApplication } from "@openfilm/application";
import { expect, test } from "@playwright/test";
import axe from "axe-core";
import { generateSampleMedia } from "../../fixtures/sample-media/generate.mjs";
import { navigate, openFilm, uiText } from "./ui-helpers.js";

const api = "http://127.0.0.1:4310/api";
let root: string;
let projectPath: string;
test.use({ viewport: { width: 1440, height: 900 }, actionTimeout: 15_000 });
test.beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "openfilm-workspace-modes-"));
  const media = join(root, "synthetic");
  await generateSampleMedia(media);
  projectPath = join(root, "modes.openfilm");
  const app = await OpenFilmApplication.create(projectPath, "Mode workflow", {
    filmSettings: { templateId: "blank", targetDuration: 12, maxDuration: 18 },
  });
  try {
    await app.importFiles([
      join(media, "01-photo.png"),
      join(media, "04-motion.mp4"),
    ]);
    const story = app.generateStory();
    app.compose(story.id);
    await app.save();
  } finally {
    app.close();
  }
});
test.beforeEach(async ({ page, request }) => {
  await request.post(`${api}/project/close`, { data: {} });
  await page.addInitScript(() => {
    localStorage.setItem("openfilm.uiLocale", "en-US");
    if (!localStorage.getItem("openfilm.preferences.v1"))
      localStorage.setItem(
        "openfilm.preferences.v1",
        JSON.stringify({ theme: "dark" }),
      );
  });
  await page.goto("/");
  await openFilm(page, projectPath);
});
test.afterEach(async ({ request }) => {
  await request.post(`${api}/project/close`, { data: {} });
});
test.afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

test("offers a guided default and remembers the expert workspace without changing the project", async ({
  page,
  request,
}) => {
  const mode = page.getByRole("combobox", {
    name: "Workspace mode",
    exact: true,
  });
  await expect(mode).toHaveValue("standard");
  await expect(page.locator(".workspace-sidebar-progress")).toBeVisible();
  const before = (await (await request.get(`${api}/project`)).json()).project;
  await mode.selectOption("expert");
  await expect(page.locator(".film-workspace")).toHaveAttribute(
    "data-workspace-mode",
    "expert",
  );
  await expect(page.locator(".workspace-sidebar-progress")).toBeHidden();
  await navigate(page, "edit", "en-US");
  await expect(page.locator(".editor-advanced-tools")).toHaveAttribute(
    "open",
    "",
  );
  const after = (await (await request.get(`${api}/project`)).json()).project;
  expect(after).toEqual(before);
  await page.reload();
  await expect(mode).toHaveValue("expert");
  await mode.selectOption("standard");
  await expect(page.locator(".editor-advanced-tools")).not.toHaveAttribute(
    "open",
  );
});

test("searches actions with the keyboard and restores focus without starting production", async ({
  page,
  request,
}) => {
  await page
    .getByRole("combobox", { name: "Workspace mode", exact: true })
    .selectOption("expert");
  const origin = page.getByRole("button", {
    name: "Quick actions",
    exact: true,
  });
  await origin.focus();
  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog", {
    name: "Quick actions",
    exact: true,
  });
  const search = dialog.getByRole("combobox", { name: "Search actions" });
  await expect(search).toBeFocused();
  await search.fill("No matching action at all");
  await expect(dialog.getByRole("status")).toContainText("No matching actions");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(origin).toBeFocused();
  const before = (await (await request.get(`${api}/project`)).json()).project;
  const jobs = (await (await request.get(`${api}/jobs`)).json()).jobs;
  await origin.click();
  await search.fill("ＥＤＩＴ");
  await expect(dialog.getByRole("option")).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(page.locator(".timeline-editor")).toBeVisible();
  await expect(page.locator("#workspace-main")).toBeFocused();
  await page.keyboard.press("Control+k");
  await search.fill("graph");
  await expect(dialog.getByRole("option")).toHaveCount(1);
  await expect(dialog.getByRole("option")).not.toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("story-graph-view")).toBeVisible();
  await page.keyboard.press("Control+k");
  await search.fill("pipeline");
  await page.keyboard.press("Enter");
  await expect(
    page.locator(".pipeline-workbench-container.is-drawer"),
  ).toBeVisible();
  expect((await (await request.get(`${api}/jobs`)).json()).jobs).toEqual(jobs);
  expect(
    (await (await request.get(`${api}/project`)).json()).project.timelines,
  ).toEqual(before.timelines);
});

test("shows editor-loading actions as unavailable without reporting a false save failure", async ({
  page,
}) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    "**/api/compositions/*/editor",
    async (route) => {
      await held;
      await route.continue();
    },
    { times: 1 },
  );
  const loading = page.waitForRequest((request) =>
    /\/api\/compositions\/[^/]+\/editor$/.test(new URL(request.url()).pathname),
  );
  await navigate(page, "edit", "en-US");
  await loading;
  await page
    .getByRole("button", { name: "Quick actions", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Quick actions",
    exact: true,
  });
  await dialog.getByRole("combobox", { name: "Search actions" }).fill("graph");
  await expect(dialog.getByRole("option")).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  release();
  await expect(dialog.getByRole("option")).not.toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("story-graph-view")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("keeps manual text and shortcuts scoped while switching modes from Settings", async ({
  page,
}) => {
  await navigate(page, "story", "en-US");
  const title = page.getByRole("textbox", { name: "Beat title", exact: true });
  await title.fill("My draft survives mode changes");
  await page.keyboard.press("Control+k");
  await expect(page.locator(".workspace-commands")).toHaveCount(0);
  await expect(title).toHaveValue("My draft survives mode changes");
  await page.locator(".settings-toggle").click();
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  await settings.getByRole("button", { name: /^Expert mode/ }).click();
  await page.keyboard.press("Control+k");
  await expect(page.locator(".workspace-commands")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(title).toHaveValue("My draft survives mode changes");
  await page.locator("#workspace-main").focus();
  await page.evaluate(() =>
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "k",
        ctrlKey: true,
        isComposing: true,
        bubbles: true,
      }),
    ),
  );
  await expect(page.locator(".workspace-commands")).toHaveCount(0);
  await page
    .getByRole("combobox", { name: "Workspace mode", exact: true })
    .selectOption("standard");
  await expect(title).toHaveValue("My draft survives mode changes");
  await expect(
    page.getByRole("button", {
      name: uiText("en-US", "app.story.saveBeat"),
      exact: true,
    }),
  ).toBeEnabled();
});

test("quick navigation preserves an invalid draft and waits for a successful save", async ({
  page,
}) => {
  await navigate(page, "story", "en-US");
  const title = page.getByRole("textbox", { name: "Beat title", exact: true });
  await title.fill("");
  await page
    .getByRole("button", { name: "Quick actions", exact: true })
    .click();
  const search = page.getByRole("combobox", { name: "Search actions" });
  await search.fill("edit");
  await page.keyboard.press("Enter");
  await expect(title).toBeVisible();
  await expect(title).toHaveValue("");
  await expect(page.getByRole("alert")).toContainText(
    uiText("en-US", "app.feedback.beatInvalid"),
  );
  await title.fill("A saved story before navigation");
  await page
    .getByRole("button", { name: "Quick actions", exact: true })
    .click();
  await search.fill("storyboard");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("perspective-tab-storyboard")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator(".storyboard-view")).toContainText(
    "A saved story before navigation",
  );
});

test("disables unavailable quick actions during autosave and enables them after acknowledgement", async ({
  page,
}) => {
  await navigate(page, "story", "en-US");
  await page.getByTestId("perspective-tab-graph").click();
  await page.locator(".graph-node.node-beat").first().click();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    "**/api/stories/*",
    async (route) => {
      await held;
      await route.continue();
    },
    { times: 1 },
  );
  const saving = page.waitForRequest(
    (request) =>
      request.method() === "PATCH" &&
      /\/api\/stories\/[^/]+$/.test(new URL(request.url()).pathname),
  );
  await page
    .locator(".inspector-palette")
    .getByLabel("Beat Title", { exact: true })
    .fill("Save before fast navigation");
  await saving;
  await page
    .getByRole("button", { name: "Quick actions", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Quick actions",
    exact: true,
  });
  await dialog.getByRole("combobox", { name: "Search actions" }).fill("edit");
  await expect(dialog.getByRole("option")).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  const search = dialog.getByRole("combobox", { name: "Search actions" });
  await search.fill("");
  await page.keyboard.press("ArrowUp");
  const selectedSettings = await dialog
    .getByRole("option")
    .filter({ hasText: "Settings" })
    .getAttribute("id");
  await expect(search).toHaveAttribute(
    "aria-activedescendant",
    selectedSettings!,
  );
  release();
  await expect(
    dialog.getByRole("option").filter({ hasText: "Open workspace" }).first(),
  ).not.toHaveAttribute("aria-disabled", "true");
  await expect(search).toHaveAttribute(
    "aria-activedescendant",
    selectedSettings!,
  );
  await search.fill("edit");
  await page.keyboard.press("Enter");
  await expect(page.locator(".timeline-editor")).toBeVisible();
});

test("closes with the native keyboard button without executing the selected action", async ({
  page,
}) => {
  const origin = page.getByRole("button", {
    name: "Quick actions",
    exact: true,
  });
  await origin.click();
  const dialog = page.getByRole("dialog", {
    name: "Quick actions",
    exact: true,
  });
  await dialog.getByRole("combobox", { name: "Search actions" }).fill("export");
  await dialog
    .getByRole("button", { name: "Close quick actions", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0);
  await expect(origin).toBeFocused();
  await expect(
    page.locator(".main-nav button[aria-current='page']"),
  ).toHaveAttribute("aria-label", "Library");
});

test("native Space activation opens general tools and quick actions while Edit is active", async ({
  page,
}) => {
  await navigate(page, "edit", "en-US");
  const tools = page.locator(".editor-advanced-tools");
  await tools.locator("summary").focus();
  await page.keyboard.press("Space");
  await expect(tools).toHaveAttribute("open", "");
  await page.keyboard.press("Space");
  await expect(tools).not.toHaveAttribute("open");
  const trigger = page.getByRole("button", {
    name: "Quick actions",
    exact: true,
  });
  await trigger.focus();
  await page.keyboard.press("Space");
  await expect(
    page.getByRole("dialog", { name: "Quick actions", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
});

test("retains selection and Undo history across both workspace modes", async ({
  page,
  request,
}) => {
  await navigate(page, "edit", "en-US");
  const clips = page.locator(".editor-clip");
  const count = await clips.count();
  expect(count).toBeGreaterThan(1);
  const before = (await (await request.get(`${api}/project`)).json()).project;
  await clips.first().click();
  await page.keyboard.press("Delete");
  await expect(clips).toHaveCount(count - 1);
  const undo = page.getByRole("button", {
    name: uiText("en-US", "editor.undoLabel"),
    exact: true,
  });
  await expect(undo).toBeEnabled();
  await clips.first().click();
  const selected = await page
    .locator(".editor-clip.selected")
    .getAttribute("id");
  const mode = page.getByRole("combobox", {
    name: "Workspace mode",
    exact: true,
  });
  await mode.selectOption("expert");
  await expect(page.locator(".editor-clip.selected")).toHaveAttribute(
    "id",
    selected!,
  );
  await mode.selectOption("standard");
  await expect(page.locator(".editor-clip.selected")).toHaveAttribute(
    "id",
    selected!,
  );
  await undo.click();
  await expect(clips).toHaveCount(count);
  await expect
    .poll(
      async () =>
        (await (await request.get(`${api}/project`)).json()).project
          .timelines[0].tracks,
    )
    .toEqual(before.timelines[0].tracks);
  const video = page
    .locator(".editor-clip")
    .filter({ hasText: "04-motion.mp4" });
  await video.click();
  const nextFrame = page.getByRole("button", {
    name: uiText("en-US", "editor.monitor.nextFrame"),
    exact: true,
  });
  await expect(nextFrame).toBeEnabled();
  await nextFrame.click();
  const clock = page
    .locator(".editor-monitor-transport time")
    .filter({ visible: true });
  await expect(clock).not.toHaveText("00:00:00:00");
  const time = await clock.textContent();
  await mode.selectOption("expert");
  await expect(clock).toHaveText(time!);
  await page
    .getByRole("button", {
      name: uiText("en-US", "editor.clip.lock"),
      exact: true,
    })
    .click();
  await expect(video).toHaveClass(/locked/);
  await mode.selectOption("standard");
  await expect(clock).toHaveText(time!);
  await video.focus();
  await page.keyboard.press("Delete");
  await expect(clips).toHaveCount(count);
  await expect(video).toHaveClass(/locked/);
  await page
    .getByRole("button", {
      name: uiText("en-US", "editor.clip.unlock"),
      exact: true,
    })
    .click();
  await expect(video).not.toHaveClass(/locked/);
});

test("keeps both mode layouts and command dialog accessible at narrow and wide sizes", async ({
  page,
}, info) => {
  for (const mode of ["standard", "expert"]) {
    await page
      .getByRole("combobox", { name: "Workspace mode", exact: true })
      .selectOption(mode);
    for (const theme of ["dark", "light"]) {
      await page.evaluate((theme) => {
        document.documentElement.dataset.theme = theme;
      }, theme);
      for (const width of [640, 768, 900, 1100, 1280, 1600, 1920]) {
        await page.setViewportSize({ width, height: width < 900 ? 600 : 900 });
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 2,
          ),
        ).toBe(true);
      }
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.screenshot({
        path: info.outputPath(`${mode}-${theme}-library.png`),
        fullPage: true,
        animations: "disabled",
      });
      await page
        .getByRole("button", { name: "Quick actions", exact: true })
        .click();
      await page.addScriptTag({ content: axe.source });
      const violations = await page.evaluate(async () =>
        (
          await (window as unknown as { axe: typeof axe }).axe.run(
            ".workspace-commands",
            {
              runOnly: {
                type: "tag",
                values: ["wcag2a", "wcag2aa", "wcag21aa"],
              },
            },
          )
        ).violations.map((rule) => ({
          id: rule.id,
          targets: rule.nodes.map((node) => node.target),
        })),
      );
      expect(violations).toEqual([]);
      await page.screenshot({
        path: info.outputPath(`${mode}-${theme}-commands.png`),
        animations: "disabled",
      });
      await page.keyboard.press("Escape");
    }
  }
});

test("keeps expert tools readable with Traditional Chinese and expanded labels", async ({
  page,
}, info) => {
  await page
    .getByRole("combobox", { name: "Workspace mode", exact: true })
    .selectOption("expert");
  for (const locale of ["zh-TW", "en-XA"] as const) {
    for (const workspace of ["story", "edit"] as const) {
      await page.locator(".ui-language select").selectOption("en-US");
      await navigate(page, workspace, "en-US");
      await page.locator(".ui-language select").selectOption(locale);
      for (const width of [640, 780, 1100, 1280, 1920]) {
        await page.setViewportSize({ width, height: width < 900 ? 600 : 900 });
        const issues = await page.evaluate(() => {
          const result: string[] = [];
          if (document.documentElement.scrollWidth > innerWidth + 2)
            result.push("page overflow");
          for (const element of Array.from(
            document.querySelectorAll<HTMLElement>(
              ".workspace-topbar button, .workspace-topbar select, .editor-toolbar button, .editor-toolbar summary, .editor-inspector-tabs button",
            ),
          )) {
            if (!element.getClientRects().length) continue;
            const rect = element.getBoundingClientRect();
            if (rect.left < -2 || rect.right > innerWidth + 2)
              result.push(`outside ${element.className}`);
            if (
              element.matches("button,summary") &&
              element.scrollWidth > element.clientWidth + 3
            )
              result.push(`clipped ${element.textContent}`);
            if (
              element.matches(".editor-inspector-tabs button") &&
              rect.height > 64
            )
              result.push(`vertical inspector label ${element.textContent}`);
          }
          return result;
        });
        expect(issues, `${locale} expert ${workspace} ${width}`).toEqual([]);
      }
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.screenshot({
        path: info.outputPath(`expert-${locale}-${workspace}.png`),
        fullPage: true,
        animations: "disabled",
      });
    }
  }
});
