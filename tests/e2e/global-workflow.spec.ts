import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import type {
  Composition,
  MediaAsset,
  OpenFilmProject,
  ProjectContentLocale,
} from "@openfilm/core";
import { getProposalContent } from "@openfilm/template-proposal";
import { generateProposalMedia } from "../../fixtures/proposal-film/generate.mjs";
import {
  chooseImportFolder,
  createFilm,
  navigate,
  openAdvancedExports,
  openFilm,
  uiText,
} from "./ui-helpers.js";

const base = "http://127.0.0.1:4310/api";
let root: string;
let fixture: Awaited<ReturnType<typeof generateProposalMedia>>;
test.use({
  locale: "en-US",
  viewport: { width: 1440, height: 900 },
  actionTimeout: 15_000,
});
test.beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "openfilm-global-browser-"));
  fixture = await generateProposalMedia(join(root, "回憶 & Memories #1"), {
    includeRaw: false,
  });
});
test.beforeEach(async ({ page, request }) => {
  expect((await request.post(`${base}/project/close`, { data: {} })).ok()).toBe(
    true,
  );
  // A starting preference only: subsequent switches and restarts must use the
  // value written by the actual language control.
  await page.addInitScript(() => {
    if (localStorage.getItem("openfilm.uiLocale") === null)
      localStorage.setItem("openfilm.uiLocale", "en-US");
  });
});
test.afterEach(async ({ request }) => {
  expect((await request.post(`${base}/project/close`, { data: {} })).ok()).toBe(
    true,
  );
});
test.afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

async function project(request: APIRequestContext): Promise<OpenFilmProject> {
  const response = await request.get(`${base}/project`);
  expect(response.ok()).toBe(true);
  return (await response.json()).project;
}
async function assets(request: APIRequestContext): Promise<MediaAsset[]> {
  const response = await request.get(`${base}/assets?limit=200`);
  expect(response.ok()).toBe(true);
  return (await response.json()).assets;
}
async function saved(page: Page, locale: ProjectContentLocale) {
  await expect(
    page
      .getByRole("region", {
        name: uiText(locale, "editor.timeline"),
        exact: true,
      })
      .getByRole("status")
      .filter({
        hasText: new RegExp(`^${uiText(locale, "editor.save.saved")}$`),
      }),
  ).toBeVisible();
}
async function language(
  page: Page,
  from: ProjectContentLocale,
  to: ProjectContentLocale,
) {
  const witness = `${Date.now()}-${Math.random()}`;
  await page.evaluate(
    (value) => Reflect.set(window, "openfilmLocaleWitness", value),
    witness,
  );
  await page
    .locator(".ui-language")
    .getByLabel(uiText(from, "app.settings.language"))
    .selectOption(to);
  await expect(page.locator("html")).toHaveAttribute("lang", to);
  expect(
    await page.evaluate(() => Reflect.get(window, "openfilmLocaleWitness")),
  ).toBe(witness);
}
async function snapshot(page: Page, name: string) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(1440);
  await page.screenshot({ path: test.info().outputPath(name), fullPage: true });
}

test("completes a Traditional Chinese film and preserves authored text across runtime and film-language changes", async ({
  page,
  request,
  browser,
}) => {
  const locale = "zh-TW";
  const text = (key: string, params?: Record<string, string | number>) =>
    uiText(locale, key, params);
  const path = join(root, "我們的影片 #1 & 2.openfilm");
  const missingKeys: string[] = [];
  page.on("console", (message) => {
    if (/Missing translation|Not found.*key/.test(message.text()))
      missingKeys.push(message.text());
  });
  await page.goto("/");
  await language(page, "en-US", locale);
  await expect(
    page.getByRole("heading", { name: "值得說出的故事。", exact: true }),
  ).toBeVisible();
  await snapshot(page, "zh-TW-welcome.png");
  await page
    .getByRole("button", { name: text("app.welcome.create"), exact: true })
    .click();
  const creation = page.locator(".create-film-form");
  const create = creation.getByRole("button", {
    name: text("app.create.submit"),
    exact: true,
  });
  await create.click();
  await expect(creation.getByRole("alert")).toHaveText("請為影片取個名字。");
  await creation
    .getByLabel(text("app.create.name"), { exact: true })
    .fill("台北到東京，屬於我們的故事");
  await creation
    .getByLabel(text("app.create.target"), { exact: true })
    .fill("0");
  await create.click();
  await expect(creation.getByRole("alert")).toHaveText(
    "目標長度須大於零，最長時間不得短於目標長度。",
  );
  expect(await project(request)).toBeNull();
  await createFilm(
    page,
    {
      title: "台北到東京，屬於我們的故事",
      path,
      templateId: "proposal-film",
      contentLocale: locale,
      targetDuration: 18,
      maxDuration: 30,
    },
    locale,
  );
  expect(await project(request)).toMatchObject({
    projectContentLocale: locale,
    filmSettings: {
      templateId: "proposal-film",
      targetDuration: 18,
      maxDuration: 30,
    },
    stories: [],
  });
  await chooseImportFolder(page, fixture.mediaDirectory, locale);
  await expect(
    page.getByText(text("app.activity.import.complete"), { exact: true }),
  ).toBeVisible({ timeout: 60_000 });
  expect(await assets(request)).toHaveLength(10);
  await page
    .getByRole("button", {
      name: text("media.card.favorite", { name: "06-pixel-portrait.jpg" }),
      exact: true,
    })
    .click();
  await page
    .getByRole("button", {
      name: text("media.card.reject", { name: "03-exact-copy.jpg" }),
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: text("app.library.findMoments"), exact: true })
    .click();
  await page
    .getByRole("button", { name: text("app.library.duplicates"), exact: true })
    .click();
  await expect(
    page
      .getByRole("button", {
        name: new RegExp(text("app.library.duplicateTitle")),
      })
      .first(),
  ).toBeVisible();
  await snapshot(page, "zh-TW-library.png");
  await navigate(page, "story", locale);
  await page
    .getByRole("button", { name: text("app.story.createFirst"), exact: true })
    .click();
  await expect(page.getByLabel(text("app.story.structure"))).toHaveValue(
    "proposal-film",
  );
  await expect(
    page.getByLabel(text("app.create.target"), { exact: true }),
  ).toHaveValue("18");
  await page
    .getByLabel(text("app.story.title"), { exact: true })
    .fill("我們的求婚故事 / Our proposal");
  await page
    .getByRole("button", { name: text("app.story.plan"), exact: true })
    .click();
  await expect(page.locator(".beat-list button")).toHaveCount(9);
  expect((await project(request)).stories[0]!.beats[0]!.title).toBe("序幕");
  const authoredTitle = "初次見面，與那些沒說出口的話 / Our first hello";
  const authoredIntent = "保留這段自己的文字：台北 → 東京 #1 & 2";
  await page
    .getByLabel(text("app.story.beatTitle"), { exact: true })
    .fill(authoredTitle);
  await page
    .getByLabel(text("app.story.beatIntent"), { exact: true })
    .fill(authoredIntent);
  const beforeSwitch = await readFile(join(path, "project.json"), "utf8");
  await language(page, locale, "en-US");
  await expect(page.getByLabel("Beat title", { exact: true })).toHaveValue(
    authoredTitle,
  );
  await language(page, "en-US", "ja-JP");
  await expect(
    page.getByLabel(uiText("ja-JP", "app.story.beatIntent"), { exact: true }),
  ).toHaveValue(authoredIntent);
  await language(page, "ja-JP", locale);
  expect(await readFile(join(path, "project.json"), "utf8")).toBe(beforeSwitch);
  await page
    .getByRole("button", { name: text("app.story.saveBeat"), exact: true })
    .click();
  await expect(
    page.getByText(text("app.feedback.beatSaved"), { exact: true }),
  ).toBeVisible();
  await page.locator(".beat-list button").nth(1).click();
  await page.getByLabel(text("app.story.beatIntent"), { exact: true }).fill("");
  await page
    .getByRole("button", { name: text("app.story.saveBeat"), exact: true })
    .click();
  await expect
    .poll(
      async () => (await project(request)).stories[0]!.beats[1]!.intentSource,
    )
    .toBe("user");
  expect((await project(request)).stories[0]!.beats[1]!.intent).toBeUndefined();
  await page.locator(".beat-list button").first().click();
  await snapshot(page, "zh-TW-story.png");
  await page
    .getByRole("button", { name: text("app.story.compose"), exact: true })
    .click();
  await saved(page, locale);
  const media = await assets(request);
  let current = await project(request);
  let composition = current.timelines.at(-1)!;
  const photo = composition.tracks
    .flatMap((track) => track.clips)
    .find(
      (clip) =>
        media.find((asset) => asset.id === clip.assetId)?.mediaType === "image",
    )!;
  await page.locator(`[id="clip-${photo.id}"]`).click();
  await page
    .getByRole("button", {
      name: text("editor.clip.photoPreset", { seconds: 3 }),
      exact: true,
    })
    .click();
  await saved(page, locale);
  await page
    .getByRole("button", { name: text("editor.clip.lock"), exact: true })
    .click();
  await saved(page, locale);
  current = await project(request);
  composition = current.timelines.at(-1)!;
  expect(
    composition.tracks
      .flatMap((track) => track.clips)
      .find((clip) => clip.id === photo.id),
  ).toMatchObject({ timelineDuration: 3, locked: true });
  await snapshot(page, "zh-TW-edit.png");
  await page
    .getByRole("button", { name: text("app.composition.render"), exact: true })
    .click();
  const preview = page.getByLabel(text("app.composition.preview"), {
    exact: true,
  });
  await expect(preview).toBeVisible({ timeout: 60_000 });
  await expect
    .poll(() =>
      preview.evaluate((video) => (video as HTMLVideoElement).duration),
    )
    .toBeGreaterThan(0);
  await preview.evaluate((video) => (video as HTMLVideoElement).play());
  await expect
    .poll(() =>
      preview.evaluate((video) => (video as HTMLVideoElement).currentTime),
    )
    .toBeGreaterThan(0);
  await preview.evaluate((video) => (video as HTMLVideoElement).pause());
  await navigate(page, "export", locale);
  await page
    .getByRole("button", { name: text("app.export.saveMp4"), exact: true })
    .click();
  await expect(
    page.getByRole("link", {
      name: text("app.export.downloadMp4"),
      exact: true,
    }),
  ).toBeVisible({ timeout: 60_000 });
  const download = page.waitForEvent("download");
  await page
    .getByRole("link", { name: text("app.export.downloadMp4"), exact: true })
    .click();
  const mp4 = await download;
  await mp4.saveAs(test.info().outputPath("zh-TW-film.mp4"));
  expect(
    (await readFile(test.info().outputPath("zh-TW-film.mp4"))).length,
  ).toBeGreaterThan(1000);
  await openAdvancedExports(page, locale);
  await page
    .getByRole("button", {
      name: new RegExp(text("app.export.formats.json.title")),
    })
    .click();
  await expect(page.locator(".export-result code")).toContainText(".json");
  const jsonPath = (await page.locator(".export-result code").textContent())!;
  expect(JSON.parse(await readFile(jsonPath, "utf8")).composition).toEqual(
    composition,
  );
  await snapshot(page, "zh-TW-export.png");

  // Film content has its own explicit control; authored text remains unchanged.
  await page.locator(".settings-toggle").click();
  const settings = page.getByRole("dialog", {
    name: text("app.settings.title"),
    exact: true,
  });
  await settings
    .getByLabel(text("app.settings.currentFilmLanguage"))
    .selectOption("ja-JP");
  await expect
    .poll(async () => (await project(request)).projectContentLocale)
    .toBe("ja-JP");
  await expect(
    settings.getByLabel(text("app.settings.currentFilmLanguage")),
  ).toBeEnabled();
  await settings
    .getByRole("button", { name: text("app.settings.close"), exact: true })
    .click();
  current = await project(request);
  expect(current.stories[0]!.beats[0]).toMatchObject({
    title: authoredTitle,
    intent: authoredIntent,
    titleSource: "user",
    intentSource: "user",
  });
  expect(current.stories[0]!.beats[1]!.title).toBe(
    getProposalContent("ja-JP").beats["proposal.beginning"].title,
  );
  expect(current.stories[0]!.beats[1]!.intent).toBeUndefined();
  expect(current.stories[0]!.beats[1]!.intentSource).toBe("user");
  expect(current.timelines.at(-1)).toEqual(composition);
  await language(page, locale, "ja-JP");
  const storage = await page.context().storageState();
  const restarted = await browser.newContext({
    storageState: storage,
    locale: "en-US",
    viewport: { width: 1440, height: 900 },
  });
  try {
    const reopened = await restarted.newPage();
    await reopened.goto("http://127.0.0.1:1420/");
    await expect(reopened.locator("html")).toHaveAttribute("lang", "ja-JP");
    await expect(
      reopened.getByRole("heading", { name: current.title, exact: true }),
    ).toBeVisible();
    await reopened
      .getByRole("button", {
        name: uiText("ja-JP", "app.navigation.switchProject"),
        exact: true,
      })
      .click();
    await openFilm(reopened, path, "ja-JP");
    await navigate(reopened, "edit", "ja-JP");
    await saved(reopened, "ja-JP");
    expect((await project(request)).stories).toEqual(current.stories);
    expect((await project(request)).timelines.at(-1)).toEqual(composition);
  } finally {
    await restarted.close();
  }
  expect(missingKeys).toEqual([]);
  for (const file of fixture.files)
    expect(
      createHash("sha256")
        .update(await readFile(file.path))
        .digest("hex"),
      file.id,
    ).toBe(file.sha256);
});

for (const locale of ["en-US", "ja-JP"] as const) {
  test(`${locale} smoke: localized recovery, real file import, story, edit, settings and export`, async ({
    page,
    request,
  }) => {
    const text = (key: string, params?: Record<string, string | number>) =>
      uiText(locale, key, params);
    await page.goto("/");
    if (locale !== "en-US") await language(page, "en-US", locale);
    await expect(
      page.getByRole("heading", {
        name:
          locale === "en-US"
            ? "A story worth telling."
            : "伝えたいストーリーを。",
        exact: true,
      }),
    ).toBeVisible();
    await snapshot(page, `${locale}-welcome.png`);
    await page
      .getByRole("button", { name: text("app.welcome.open"), exact: true })
      .click();
    await page
      .getByLabel(text("app.create.existingFolder"))
      .fill(join(root, "missing 回憶 # &.openfilm"));
    await page
      .locator(".open-project-form")
      .getByRole("button", { name: text("app.welcome.open"), exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText(
      text("errors.project.unavailable"),
    );
    await page
      .getByRole("button", {
        name: text("app.actions.dismissError"),
        exact: true,
      })
      .click();
    await page
      .getByRole("button", { name: text("app.actions.back"), exact: true })
      .click();
    const path = join(root, `${locale}-smoke.openfilm`);
    if (locale === "en-US") {
      await page.locator(".settings-toggle").click();
      const settings = page.getByRole("dialog", {
        name: text("app.settings.title"),
        exact: true,
      });
      await settings.getByLabel(text("app.settings.storage")).fill(root);
      await settings
        .getByRole("button", { name: text("app.settings.close"), exact: true })
        .click();
      await page
        .getByRole("button", { name: "Create Film", exact: true })
        .click();
      await page.getByLabel("Film language").selectOption("ja-JP");
      await language(page, "en-US", "zh-TW");
      await expect(
        page.getByLabel(uiText("zh-TW", "app.create.filmLanguage")),
      ).toHaveValue("ja-JP");
      await language(page, "zh-TW", "en-US");
    }
    const creation = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        new URL(request.url()).pathname === "/api/project/create",
    );
    await createFilm(
      page,
      {
        title: `${locale} memories / 思い出`,
        ...(locale === "en-US" ? {} : { path }),
        contentLocale: locale,
        targetDuration: 4,
        maxDuration: 8,
      },
      locale,
    );
    const creationBody = (await creation).postDataJSON();
    if (locale === "en-US") {
      expect(creationBody).not.toHaveProperty("path");
      expect(creationBody.root).toBe(root);
      const opened = await (await request.get(`${base}/project`)).json();
      expect(dirname(opened.path)).toBe(root);
      expect(opened.path).toMatch(/\.openfilm$/);
      expect(
        await readFile(join(opened.path, "project.json"), "utf8"),
      ).toContain("en-US memories / 思い出");
    }
    const panel = page.getByRole("region", {
      name: text("app.import.label"),
      exact: true,
    });
    await panel
      .getByLabel(text("app.import.addFiles"), { exact: true })
      .setInputFiles(fixture.byId.landscape!);
    await expect(
      page.getByText(text("app.activity.import.complete"), { exact: true }),
    ).toBeVisible({ timeout: 60_000 });
    expect(await assets(request)).toHaveLength(1);
    await snapshot(page, `${locale}-library.png`);
    await navigate(page, "story", locale);
    await page
      .getByRole("button", { name: text("app.story.createFirst"), exact: true })
      .click();
    await page
      .getByLabel(text("app.story.title"), { exact: true })
      .fill("My words / 私の言葉");
    await page
      .getByRole("button", { name: text("app.story.plan"), exact: true })
      .click();
    await expect(page.locator(".beat-list button")).toHaveCount(1);
    await page
      .getByLabel(text("app.story.beatTitle"), { exact: true })
      .fill("My first scene / はじめてのシーン");
    await expect(
      page.getByLabel(text("app.story.beatIntent"), { exact: true }),
    ).toHaveValue("");
    const saveButton = page.getByRole("button", {
      name: text("app.story.saveBeat"),
      exact: true,
    });
    if (locale === "en-US") {
      let releaseSave!: () => void;
      const saveGate = new Promise<void>((resolve) => {
        releaseSave = resolve;
      });
      let signalStarted!: () => void;
      const saveStarted = new Promise<void>((resolve) => {
        signalStarted = resolve;
      });
      await page.route(
        "**/api/stories/*",
        async (route) => {
          expect(route.request().method()).toBe("PATCH");
          expect(route.request().postDataJSON().beats[0].title).toBe(
            "My first scene / はじめてのシーン",
          );
          signalStarted();
          await saveGate;
          await route.continue();
        },
        { times: 1 },
      );
      try {
        await saveButton.click();
        await saveStarted;
        await page
          .getByLabel(text("app.story.beatTitle"), { exact: true })
          .fill("Newer words / 後から書いた言葉");
      } finally {
        releaseSave();
      }
      await expect(saveButton).toBeEnabled();
      await expect(
        page.getByRole("status").filter({ hasText: text("app.story.dirty") }),
      ).toBeVisible();
      expect((await project(request)).stories[0]!.beats[0]!.title).toBe(
        "My first scene / はじめてのシーン",
      );
      await navigate(page, "library", locale);
      await expect
        .poll(async () => (await project(request)).stories[0]!.beats[0]!.title)
        .toBe("Newer words / 後から書いた言葉");
      await navigate(page, "story", locale);
      await expect(
        page.getByLabel(text("app.story.beatTitle"), { exact: true }),
      ).toHaveValue("Newer words / 後から書いた言葉");
    } else {
      await saveButton.click();
    }
    await expect
      .poll(
        async () => (await project(request)).stories[0]!.beats[0]!.titleSource,
      )
      .toBe("user");
    expect((await project(request)).stories[0]!.beats[0]).toMatchObject({
      title:
        locale === "en-US"
          ? "Newer words / 後から書いた言葉"
          : "My first scene / はじめてのシーン",
    });
    expect(
      (await project(request)).stories[0]!.beats[0]!.intent,
    ).toBeUndefined();
    await snapshot(page, `${locale}-story.png`);
    await page
      .getByRole("button", { name: text("app.story.compose"), exact: true })
      .click();
    await saved(page, locale);
    await expect(
      page.getByLabel(text("editor.clip.photoDurationLabel"), { exact: true }),
    ).toHaveValue("4");
    await snapshot(page, `${locale}-edit.png`);
    await page.locator(".settings-toggle").click();
    const settings = page.getByRole("dialog", {
      name: text("app.settings.title"),
      exact: true,
    });
    await settings.getByLabel(text("app.settings.theme")).selectOption("light");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await settings.getByLabel(text("app.settings.theme")).selectOption("dark");
    await settings
      .getByRole("button", { name: text("app.settings.close"), exact: true })
      .click();
    await navigate(page, "export", locale);
    await page
      .getByRole("button", { name: new RegExp(text("app.export.edit")) })
      .click();
    await expect(
      page.getByText(text("app.export.compatibility.manual"), { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", {
        name: text("app.export.saveEditable"),
        exact: true,
      })
      .click();
    await expect(page.locator(".export-result code")).toContainText(".otio");
    await expect(
      page.getByRole("region", {
        name: text("media.report.region"),
        exact: true,
      }),
    ).toContainText(text("media.report.unverified"));
    await snapshot(page, `${locale}-export.png`);
    const current = await project(request);
    expect(current.projectContentLocale).toBe(locale);
    expect(current.stories[0]!.title).toBe("My words / 私の言葉");
    expect((current.timelines[0] as Composition).duration).toBe(4);
  });
}
