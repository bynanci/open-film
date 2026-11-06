import { expect, test } from "@playwright/test";
import { uiText } from "./ui-helpers.js";

test.use({ viewport: { width: 1280, height: 720 } });

test("uses a golden-ratio welcome split without decorative panel frames", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    localStorage.setItem("openfilm.uiLocale", "en-US");
  });
  await page.goto("/");

  const select = await page
    .locator(".ui-language select")
    .evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        appearance: style.appearance,
        arrow: style.backgroundImage,
        height: element.getBoundingClientRect().height,
        corner: Math.max(
          ...[
            style.borderTopLeftRadius,
            style.borderTopRightRadius,
            style.borderBottomLeftRadius,
            style.borderBottomRightRadius,
          ].map((value) => Number.parseFloat(value)),
        ),
      };
    });
  expect(select.appearance).toBe("none");
  expect(select.arrow).toContain("linear-gradient");
  expect(select.corner).toBeLessThan(select.height / 2);

  const split = await page.locator(".project-launcher").evaluate((element) => {
    const sizes = getComputedStyle(element)
      .gridTemplateColumns.split(" ")
      .map((value) => Number.parseFloat(value));
    const intro = element.querySelector(".launcher-intro")!;
    const recent = element.querySelector(".launcher-home")!;
    return {
      ratio: sizes[0]! / sizes[1]!,
      introBorder: getComputedStyle(intro).borderTopWidth,
      recentBorder: getComputedStyle(recent).borderTopWidth,
    };
  });
  expect(split.ratio).toBeGreaterThan(1.55);
  expect(split.ratio).toBeLessThan(1.68);
  expect(split.introBorder).toBe("0px");
  expect(split.recentBorder).toBe("0px");
});

test("starts in Garden Stone light and switches themes without reloading", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("openfilm.uiLocale", "en-US");
  });
  await page.goto("/");

  const root = page.locator("html");
  await expect(root).toHaveAttribute("data-theme", "light");
  await expect(
    page.locator(".launcher-stack-graphic .garden-stone"),
  ).toHaveCount(6);
  expect(
    await root.evaluate((element) => getComputedStyle(element).backgroundColor),
  ).toBe("rgb(242, 239, 232)");

  await page
    .getByRole("button", { name: uiText("en-US", "app.settings.title") })
    .click();
  const settings = page.locator(".settings-dialog");
  const theme = settings.getByLabel(uiText("en-US", "app.settings.theme"));
  await theme.selectOption("dark");
  await expect(root).toHaveAttribute("data-theme", "dark");
  await expect(settings).toBeVisible();

  await page.emulateMedia({ colorScheme: "dark" });
  await theme.selectOption("system");
  await expect(root).toHaveAttribute("data-theme", "system");
  expect(
    await root.evaluate((element) => getComputedStyle(element).backgroundColor),
  ).toBe("rgb(21, 24, 21)");

  await page.emulateMedia({ colorScheme: "light" });
  expect(
    await root.evaluate((element) => getComputedStyle(element).backgroundColor),
  ).toBe("rgb(242, 239, 232)");
  await page.reload();
  await expect(root).toHaveAttribute("data-theme", "system");
  await expect(page.locator(".launcher-actions")).toBeVisible();
});
