import { expect, type Page } from "@playwright/test";
import enUS from "../../apps/desktop/src/i18n/locales/en-US.js";
import zhTW from "../../apps/desktop/src/i18n/locales/zh-TW.js";
import jaJP from "../../apps/desktop/src/i18n/locales/ja-JP.js";
import type { ProjectContentLocale } from "@openfilm/core";

const messages = { "en-US": enUS, "zh-TW": zhTW, "ja-JP": jaJP };

/** Locate translated controls by their semantic catalog key, never a source-string lookup. */
export function uiText(
  locale: ProjectContentLocale,
  key: string,
  params: Record<string, string | number> = {},
): string {
  let value: unknown = messages[locale];
  for (const part of key.split("."))
    value =
      value !== null && typeof value === "object"
        ? (value as Record<string, unknown>)[part]
        : undefined;
  if (typeof value !== "string")
    throw new Error(`Missing test message ${locale}:${key}`);
  return value.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : match,
  );
}

export async function initialLocale(
  page: Page,
  locale: ProjectContentLocale = "en-US",
) {
  await page.addInitScript((value) => {
    localStorage.setItem("openfilm.uiLocale", value);
  }, locale);
}

export async function navigate(
  page: Page,
  workspace: "library" | "story" | "edit" | "export" | "versions",
  locale: ProjectContentLocale = "en-US",
) {
  await page
    .getByRole("navigation", {
      name: uiText(locale, "app.navigation.label"),
      exact: true,
    })
    .getByRole("button", {
      name: uiText(locale, `app.navigation.${workspace}`),
      exact: true,
    })
    .click();
}

export async function createFilm(
  page: Page,
  value: {
    title: string;
    path?: string;
    templateId?: string;
    contentLocale?: ProjectContentLocale;
    targetDuration?: number;
    maxDuration?: number;
  },
  locale: ProjectContentLocale = "en-US",
) {
  const form = page.locator(".create-film-form");
  if (!(await form.isVisible()))
    await page
      .getByRole("button", {
        name: uiText(locale, "app.welcome.create"),
        exact: true,
      })
      .click();
  await form
    .getByLabel(uiText(locale, "app.create.name"), { exact: true })
    .fill(value.title);
  if (value.templateId)
    await form
      .getByLabel(uiText(locale, "app.create.storyType"))
      .selectOption(value.templateId);
  if (value.contentLocale)
    await form
      .getByLabel(uiText(locale, "app.create.filmLanguage"))
      .selectOption(value.contentLocale);
  if (value.targetDuration !== undefined)
    await form
      .getByLabel(uiText(locale, "app.create.target"), { exact: true })
      .fill(String(value.targetDuration));
  if (value.maxDuration !== undefined)
    await form
      .getByLabel(uiText(locale, "app.create.maximum"), { exact: true })
      .fill(String(value.maxDuration));
  if (value.path !== undefined) {
    await form
      .getByText(uiText(locale, "app.create.advanced"), { exact: true })
      .click();
    await form.getByLabel(uiText(locale, "app.create.folder")).fill(value.path);
  }
  await form
    .getByRole("button", {
      name: uiText(locale, "app.create.submit"),
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", {
      name: uiText(locale, "app.navigation.switchProject"),
      exact: true,
    }),
  ).toBeEnabled();
}

export async function openFilm(
  page: Page,
  path: string,
  locale: ProjectContentLocale = "en-US",
) {
  await page
    .getByRole("button", {
      name: uiText(locale, "app.welcome.open"),
      exact: true,
    })
    .click();
  const form = page.locator(".open-project-form");
  await form.getByLabel(uiText(locale, "app.create.existingFolder")).fill(path);
  await form
    .getByRole("button", {
      name: uiText(locale, "app.welcome.open"),
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", {
      name: uiText(locale, "app.navigation.switchProject"),
      exact: true,
    }),
  ).toBeEnabled();
}

export async function chooseImportFolder(
  page: Page,
  path: string,
  locale: ProjectContentLocale = "en-US",
) {
  const panel = page.getByRole("region", {
    name: uiText(locale, "app.import.label"),
    exact: true,
  });
  // This helper exercises the legacy single-folder importer. Clear any prior
  // saved source draft so repeated calls keep their historical one-root scope;
  // the dedicated multi-source tests intentionally retain and combine sources.
  // Summary counters exist while the draft request is still pending. Wait for
  // the mutually exclusive loaded state before inspecting source cards.
  await expect(
    panel.locator(".import-empty, .import-source-section"),
  ).toBeVisible();
  const cards = panel.locator(".import-source-card");
  while ((await cards.count()) > 0) {
    const before = await cards.count();
    await cards.first().locator(":scope > button.icon-button").click();
    await expect(cards).toHaveCount(before - 1);
  }
  const moreOptions = panel.locator("details.import-more-options");
  if ((await moreOptions.count()) && !(await moreOptions.getAttribute("open")))
    await moreOptions.locator("summary").click();
  await panel
    .getByRole("button", {
      name: uiText(locale, "app.import.addPath"),
      exact: true,
    })
    .click();
  await panel
    .getByLabel(uiText(locale, "app.import.folder"), { exact: true })
    .fill(path);
  await panel
    .getByRole("button", {
      name: uiText(locale, "app.import.addPathSubmit"),
      exact: true,
    })
    .click();
  await panel
    .getByRole("button", {
      name: uiText(locale, "app.import.startCompatible"),
      exact: true,
    })
    .click();
}

export async function openAdvancedExports(
  page: Page,
  locale: ProjectContentLocale = "en-US",
) {
  const advanced = page.locator(".export-advanced");
  if ((await advanced.getAttribute("open")) === null)
    await advanced
      .getByText(uiText(locale, "app.export.advanced"), { exact: true })
      .click();
}

export async function openAdvancedTools(page: Page) {
  const tools = page.locator(".editor-advanced-tools");
  if ((await tools.getAttribute("open")) === null)
    await tools.locator("summary").click();
  await expect(tools).toHaveAttribute("open", "");
}
