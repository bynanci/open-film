import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { OpenFilmApplication } from "@openfilm/application";
import { test, expect } from "@playwright/test";
import { navigate, openFilm } from "./ui-helpers.js";

const api = "http://127.0.0.1:4310/api";
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

test("native retry waits for the lazy planner mount before restoring its draft", async ({
  page,
  request,
}) => {
  await request.post(`${api}/project/close`, { data: {} });
  const root = await mkdtemp(join(tmpdir(), "openfilm-native-planner-"));
  const projectPath = join(root, "planner-recovery.openfilm");
  try {
    const app = await OpenFilmApplication.create(
      projectPath,
      "Planner recovery",
    );
    try {
      await app.save();
    } finally {
      app.close();
    }
    await page.addInitScript(() => {
      (window as unknown as { isTauri: boolean }).isTauri = true;
      (window as unknown as { runtimeFailed: boolean }).runtimeFailed = false;
      (
        window as unknown as {
          __TAURI_INTERNALS__: {
            invoke: (command: string) => Promise<unknown>;
          };
        }
      ).__TAURI_INTERNALS__ = {
        invoke: async (command) => {
          if (command === "native_runtime_start")
            return { state: "development" };
          if (command === "native_runtime_status")
            return (window as unknown as { runtimeFailed: boolean })
              .runtimeFailed
              ? { state: "blocked", code: "runtime.serviceExited" }
              : { state: "development" };
          return false;
        },
      };
    });
    await page.goto("/");
    await openFilm(page, projectPath);
    await navigate(page, "story");
    await page.getByTestId("scene-planner-toggle").click();
    await expect(page.getByTestId("scene-planner")).toBeVisible();
    await page.getByTestId("scene-plan-title").fill("Retained planner title");
    await page
      .getByTestId("scene-plan-brief")
      .fill("Keep this planning brief.");

    await page.evaluate(() => {
      (window as unknown as { runtimeFailed: boolean }).runtimeFailed = true;
    });
    await expect(page.getByRole("button", { name: "Retry setup" })).toBeVisible(
      {
        timeout: 5_000,
      },
    );
    await page.evaluate(() => {
      (window as unknown as { runtimeFailed: boolean }).runtimeFailed = false;
    });
    await page.getByRole("button", { name: "Retry setup" }).click();

    await expect(page.getByTestId("scene-planner")).toBeVisible();
    await expect(page.getByTestId("scene-plan-title")).toHaveValue(
      "Retained planner title",
    );
    await expect(page.getByTestId("scene-plan-brief")).toHaveValue(
      "Keep this planning brief.",
    );
    await expect(page.locator(".runtime-drafts")).toHaveCount(0);
  } finally {
    await request.post(`${api}/project/close`, { data: {} });
    await rm(root, { recursive: true, force: true });
  }
});
