import { expect, test } from "@playwright/test";
import { OpenFilmApplication } from "@openfilm/application";
import { initialLocale, navigate, uiText } from "./ui-helpers.js";
import { createDesktopFixture } from "./helpers.js";

const api = "http://127.0.0.1:4310/api";
const cleanups: Array<() => Promise<unknown>> = [];

test.use({ viewport: { width: 1440, height: 900 } });
test.beforeEach(async ({ request }) => {
  expect((await request.post(`${api}/project/close`, { data: {} })).ok()).toBe(
    true,
  );
});
test.afterEach(async ({ request }) => {
  expect((await request.post(`${api}/project/close`, { data: {} })).ok()).toBe(
    true,
  );
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

test("creates, compares, renames, and explicitly restores a saved version", async ({
  page,
  request,
}) => {
  const fixture = await createDesktopFixture(0);
  cleanups.push(fixture.cleanup);
  const app = await OpenFilmApplication.create(
    fixture.project,
    "Synthetic versions film",
  );
  try {
    app.project.stories = [
      {
        id: "version-story",
        title: "Synthetic story",
        beats: [{ id: "opening", title: "Opening beat" }],
      },
    ];
    await app.save();
  } finally {
    app.close();
  }
  const opened = await request.post(`${api}/project/open`, {
    data: { path: fixture.project },
  });
  expect(opened.ok(), await opened.text()).toBe(true);

  await initialLocale(page, "en-US");
  await page.goto("/");
  await navigate(page, "versions");
  const panel = page.getByRole("region", { name: "Named versions" });
  await panel.getByLabel("Version name", { exact: true }).fill("Opening cut");
  await panel.getByRole("button", { name: "Save current version" }).click();
  await expect(panel.getByTestId(/^version-/)).toHaveCount(1);
  const firstId = await panel
    .locator(".version-card")
    .first()
    .locator(".version-select")
    .getAttribute("data-testid");
  expect(firstId).toMatch(/^version-/);

  const editStory = await request.patch(`${api}/stories/version-story`, {
    data: { title: "Revised synthetic story" },
  });
  expect(editStory.ok(), await editStory.text()).toBe(true);
  await panel.getByRole("button", { name: "Refresh versions" }).click();
  await panel.getByLabel("Version name", { exact: true }).fill("Second cut");
  await panel.getByRole("button", { name: "Save current version" }).click();
  await expect(panel.getByTestId(/^version-/)).toHaveCount(2);
  await expect(
    panel.getByText("Changes from Opening cut to Second cut"),
  ).toBeVisible();
  await expect(
    panel.getByText("Story and beats", { exact: true }),
  ).toBeVisible();

  const firstCard = panel.getByTestId(firstId!).locator("xpath=..");
  await firstCard.getByRole("button", { name: "Rename", exact: true }).click();
  const renameInput = firstCard.getByLabel("Version name", { exact: true });
  await renameInput.fill("Opening · approved");
  await firstCard
    .getByRole("button", { name: "Save name", exact: true })
    .click();
  await expect(panel.getByTestId(firstId!)).toContainText("Opening · approved");

  await firstCard
    .getByRole("button", { name: "Restore…", exact: true })
    .click();
  const dialog = page.getByRole("alertdialog", {
    name: "Restore “Opening · approved”?",
  });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("checkpoint");
  await dialog
    .getByRole("button", { name: "Create checkpoint and restore" })
    .click();

  await expect
    .poll(async () => {
      const current = await (await request.get(`${api}/project`)).json();
      return current.project.stories[0].title;
    })
    .toBe("Synthetic story");
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(panel.getByTestId(/^version-/)).toHaveCount(3);
  await expect(
    page.getByLabel("Saved project versions", { exact: true }),
  ).toBeVisible();
  expect(uiText("en-US", "app.navigation.versions")).toBe("Versions");
  const checkpoint = panel
    .locator(".version-card")
    .filter({ hasText: "Before restore:" });
  await checkpoint
    .getByRole("button", { name: "Delete…", exact: true })
    .click();
  const deletion = page.getByRole("alertdialog", {
    name: /Delete “Before restore:/,
  });
  await expect(deletion).toContainText(
    "Original media and the current project stay unchanged",
  );
  await page.keyboard.press("Escape");
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(panel.getByTestId(/^version-/)).toHaveCount(3);
  await checkpoint
    .getByRole("button", { name: "Delete…", exact: true })
    .click();
  await expect(
    deletion.getByRole("button", { name: "Delete saved version", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(panel.getByTestId(/^version-/)).toHaveCount(2);
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  expect(
    (await (await request.get(`${api}/project`)).json()).project.stories[0]
      .title,
  ).toBe("Synthetic story");
  let deleteRequests = 0;
  page.on("request", (sent) => {
    if (sent.method() === "DELETE" && sent.url().includes("/api/versions/"))
      deleteRequests++;
  });
  await firstCard.getByRole("button", { name: "Delete…", exact: true }).click();
  await page.route("**/api/versions/revision", (route) =>
    route.fulfill({
      json: { projectId: "another-project", revision: "0".repeat(64) },
    }),
  );
  const wrongProject = page.waitForResponse("**/api/versions/revision");
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Delete saved version", exact: true })
    .click();
  await wrongProject;
  await expect(
    page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Delete saved version", exact: true }),
  ).toBeEnabled();
  expect(deleteRequests).toBe(0);
  await expect(panel.getByTestId(/^version-/)).toHaveCount(2);
  await page.keyboard.press("Escape");
  await page.unroute("**/api/versions/revision");
});
