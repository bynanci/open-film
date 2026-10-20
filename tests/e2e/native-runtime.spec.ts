import { test, expect } from "@playwright/test";
test("native preflight failure is readable and keyboard retry opens the existing workspace", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as unknown as { isTauri: boolean }).isTauri = true;
    let attempts = 0;
    (
      window as unknown as { __TAURI_INTERNALS__: unknown }
    ).__TAURI_INTERNALS__ = {
      invoke: async (command: string) => {
        if (command === "native_runtime_start")
          return ++attempts === 1
            ? { state: "blocked", code: "runtime.hash" }
            : { state: "development" };
        if (command === "native_runtime_status")
          return { state: "development" };
        return false;
      },
    };
  });
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText("integrity");
  await page.getByRole("button", { name: "Retry setup" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".runtime-gate")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /Create Film/i }).first(),
  ).toBeVisible();
});

test("native close preserves a pending browser draft until it is resolved", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as unknown as { isTauri: boolean }).isTauri = true;
    let pending = true;
    (
      window as unknown as { __TAURI_INTERNALS__: unknown }
    ).__TAURI_INTERNALS__ = {
      invoke: async (command: string, args?: { cancel?: boolean }) => {
        if (command === "native_runtime_start") return { state: "development" };
        if (command === "native_runtime_status")
          return {
            state: "development",
            ...(pending ? { closeRequestId: 1 } : {}),
          };
        if (command === "native_runtime_close") {
          if (!args?.cancel) throw new Error("Draft must prevent native close");
          pending = false;
          return;
        }
        return false;
      },
    };
    window.addEventListener("beforeunload", (event) => event.preventDefault());
  });
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText("pending draft");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.locator(".runtime-gate")).toHaveCount(0);
});

test("native recovery remounts the workspace for the replacement connection", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as unknown as { isTauri: boolean }).isTauri = true;
    (window as unknown as { runtimeFailed: boolean }).runtimeFailed = false;
    (
      window as unknown as { __TAURI_INTERNALS__: unknown }
    ).__TAURI_INTERNALS__ = {
      invoke: async (command: string) =>
        command === "native_runtime_status" &&
        (window as unknown as { runtimeFailed: boolean }).runtimeFailed
          ? { state: "blocked", code: "runtime.serviceExited" }
          : { state: "development" },
    };
  });
  await page.goto("/");
  await expect(page.locator(".runtime-gate")).toHaveCount(0);
  await page
    .locator(".runtime-workspace > *")
    .first()
    .evaluate((element) => {
      element.setAttribute("data-old-connection", "true");
      (window as unknown as { runtimeFailed: boolean }).runtimeFailed = true;
    });
  await expect(page.getByRole("alert")).toBeVisible();
  await page.evaluate(() => {
    (window as unknown as { runtimeFailed: boolean }).runtimeFailed = false;
  });
  await page.getByRole("button", { name: "Retry setup" }).click();
  await expect(page.locator(".runtime-gate")).toHaveCount(0);
  await expect(page.locator("[data-old-connection]")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /Create Film/i }).first(),
  ).toBeVisible();
});
