import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { build, transformSync } from "esbuild";
import { expect, test, type Page } from "@playwright/test";

const desktop = createRequire(resolve("apps/desktop/package.json"));
const compiler = desktop("vue/compiler-sfc");
const gatePath = resolve("apps/desktop/src/components/RuntimeGate.vue");
const gate = compiler.compileScript(
  compiler.parse(readFileSync(gatePath, "utf8"), { filename: gatePath })
    .descriptor,
  { id: "native-keyboard-fixture", inlineTemplate: true },
).content;
function keyboard(name: string) {
  const source = readFileSync(
    resolve(`apps/desktop/src/components/${name}.vue`),
    "utf8",
  );
  const start = source.indexOf("function keyboard(event: KeyboardEvent)");
  if (start < 0) throw new Error(`Missing ${name} keyboard handler`);
  return transformSync(source.slice(start, source.indexOf("\n}", start) + 2), {
    loader: "ts",
  }).code;
}
const handlers = {
  timeline: keyboard("TimelineEditor"),
  precision: keyboard("PrecisionEditor"),
};
let fixture: string;
test.beforeAll(async () => {
  // Run the real Gate template/lifecycle and exact editor window handlers.
  // Only the App slot, IPC and editor actions are sinks; this fixture tests
  // Chromium event phases/default button activation without backend ports.
  const output = await build({
    stdin: {
      contents:
        'import { createApp } from "vue"; import Gate from "fixture:gate"; createApp(Gate).mount("#app");',
      resolveDir: resolve("apps/desktop"),
    },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    define: {
      __VUE_OPTIONS_API__: "true",
      __VUE_PROD_DEVTOOLS__: "false",
      __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: "false",
    },
    plugins: [
      {
        name: "native-keyboard-fixture",
        setup(bundler) {
          bundler.onResolve({ filter: /^vue$/ }, () => ({
            path: desktop.resolve("vue/dist/vue.esm-bundler.js"),
          }));
          bundler.onResolve(
            {
              filter:
                /^(fixture:gate|\.\.\/App\.vue|\.\.\/api|vue-i18n|@tauri-apps\/api\/core)$/,
            },
            ({ path }) => ({ path, namespace: "fixture" }),
          );
          bundler.onLoad(
            { filter: /.*/, namespace: "fixture" },
            ({ path }) => ({
              loader: "ts",
              contents:
                path === "fixture:gate"
                  ? gate
                  : path === "../App.vue"
                    ? `import { h } from "vue"; export default { setup(_, { expose }) { expose({ captureNativeDrafts: () => window.fixtureDrafts ?? [], prepareNativeClose: async () => { if (window.fixtureHoldClose) await new Promise(resolve => window.releaseClose = resolve); return !window.fixtureCancelClose; }, openNativeDraftProject: async () => {} }); return () => h("button", { id: "ready-control" }, "Ready editor"); } };`
                    : path === "../api"
                      ? "export const configureNativeConnection = () => {};"
                      : path === "vue-i18n"
                        ? "export const useI18n = () => ({ t: key => key });"
                        : "export const invoke = (command, args) => window.fixtureInvoke(command, args);",
            }),
          );
        },
      },
    ],
  });
  fixture = output.outputFiles[0]!.text;
});
async function mount(page: Page) {
  await page.setContent('<div id="app"></div>');
  await page.evaluate(() => {
    const state = window as unknown as Record<string, unknown>;
    state.__TAURI_INTERNALS__ = {};
    state.fixtureCancelClose = true;
    state.fixtureInvoke = async (command: string) => {
      if (command === "native_runtime_status")
        return {
          state: state.fixtureFailed ? "blocked" : "development",
          code: "runtime.serviceExited",
          ...(state.fixtureRequestClose ? { closeRequestId: 1 } : {}),
        };
      if (command === "native_runtime_close") state.fixtureRequestClose = false;
      if (command === "native_runtime_start" && state.fixtureHoldStart)
        await new Promise((resolve) => {
          state.releaseStart = resolve;
        });
      return { state: "development" };
    };
  });
  await page.addScriptTag({ content: fixture });
  await expect(page.locator("#ready-control")).toBeVisible();
  await page.evaluate(({ timeline, precision }) => {
    const state = window as unknown as Record<string, unknown>;
    const counts = { deleted: 0, history: 0, marker: 0 };
    const mode = { value: "story" };
    state.shortcutCounts = counts;
    state.shortcutMode = mode;
    const timelineContext = {
      directionBlocked: { value: false },
      editMode: mode,
      props: { active: true },
      draftAction: { value: null },
      history: () => {
        counts.history++;
      },
      deleteSelected: () => {
        counts.deleted++;
      },
    };
    const precisionContext = {
      props: { active: true },
      playable: { value: true },
      addMarker: () => {
        counts.marker++;
      },
    };
    for (const [code, context] of [
      [timeline, timelineContext],
      [precision, precisionContext],
    ] as const) {
      const handler = new Function(
        "context",
        `const {${Object.keys(context).join(",")}} = context;\n${code}\nreturn keyboard;`,
      )(context);
      window.addEventListener("keydown", handler);
    }
  }, handlers);
}
async function counts(page: Page) {
  return page.evaluate(
    () => (window as unknown as { shortcutCounts: object }).shortcutCounts,
  );
}
async function pressShortcuts(page: Page) {
  await page.keyboard.press("Delete");
  await page.keyboard.press("Control+z");
  await page.keyboard.press("m");
}
async function flag(page: Page, name: string, value: unknown) {
  await page.evaluate(
    ([key, input]) => {
      (window as unknown as Record<string, unknown>)[key] = input;
    },
    [name, value] as const,
  );
}
test("native blocked, busy and closing controls isolate global editor shortcuts while preserving keyboard activation", async ({
  page,
}) => {
  await mount(page);
  await page.locator("#ready-control").focus();
  await pressShortcuts(page);
  const initial = await counts(page);
  expect(initial).toEqual({ deleted: 1, history: 1, marker: 1 });
  await flag(page, "fixtureHoldClose", true);
  await flag(page, "fixtureRequestClose", true);
  await expect(page.locator(".runtime-gate")).toBeVisible();
  await page.keyboard.press("Delete");
  await page.keyboard.press("Control+z");
  expect(await counts(page)).toEqual(initial);
  await page.evaluate(() =>
    (window as unknown as { releaseClose: () => void }).releaseClose(),
  );
  const back = page.getByRole("button", {
    name: "app.actions.back",
    exact: true,
  });
  await expect(back).toBeEnabled();
  await back.focus();
  await pressShortcuts(page);
  expect(await counts(page)).toEqual(initial);
  await page.keyboard.press("Enter");
  await expect(page.locator(".runtime-gate")).toHaveCount(0);
  await flag(page, "fixtureFailed", true);
  const retry = page.getByRole("button", {
    name: "app.nativeRuntime.retry",
    exact: true,
  });
  await expect(retry).toBeVisible();
  await retry.focus();
  await flag(page, "fixtureFailed", false);
  await flag(page, "fixtureHoldStart", true);
  await page.keyboard.press("Enter");
  await expect(page.locator(".runtime-card [role='status']")).toBeVisible();
  await pressShortcuts(page);
  expect(await counts(page)).toEqual(initial);
  await page.evaluate(() =>
    (window as unknown as { releaseStart: () => void }).releaseStart(),
  );
  await expect(page.locator(".runtime-gate")).toHaveCount(0);
  await page.locator("#ready-control").focus();
  await pressShortcuts(page);
  expect(await counts(page)).toEqual({ deleted: 2, history: 2, marker: 2 });
});
test("ready retained-draft controls isolate shortcuts and keep Tab, Enter and Space defaults", async ({
  page,
}) => {
  await mount(page);
  await flag(page, "fixtureDrafts", [
    {
      projectId: "project",
      projectPath: "/synthetic/project.openfilm",
      projectTitle: "Synthetic",
      kind: "category",
      entityId: "asset",
      label: "Photo",
      baseline: "saved",
      value: ["Local text"],
    },
  ]);
  await flag(page, "fixtureFailed", true);
  const retry = page.getByRole("button", {
    name: "app.nativeRuntime.retry",
    exact: true,
  });
  await expect(retry).toBeVisible();
  await flag(page, "fixtureFailed", false);
  await retry.click();
  await expect(page.locator(".runtime-gate")).toHaveCount(0);
  const download = page.getByRole("button", {
    name: "app.nativeRuntime.downloadDraft",
    exact: true,
  });
  await expect(download).toBeVisible();
  await download.focus();
  await pressShortcuts(page);
  expect(await counts(page)).toEqual({ deleted: 0, history: 0, marker: 0 });
  const downloaded = page.waitForEvent("download");
  await page.keyboard.press("Enter");
  expect((await downloaded).suggestedFilename()).toBe(
    "openfilm-local-draft.json",
  );
  await page.keyboard.press("Tab");
  const discard = page.getByRole("button", {
    name: "app.nativeRuntime.discardDraft",
    exact: true,
  });
  await expect(discard).toBeFocused();
  await page.keyboard.press("Space");
  await expect(page.locator(".runtime-drafts")).toHaveCount(0);
  await page.locator("#ready-control").focus();
  await pressShortcuts(page);
  expect(await counts(page)).toEqual({ deleted: 1, history: 1, marker: 1 });
});
