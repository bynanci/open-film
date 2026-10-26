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
function keyboard(name: string, method = "keyboard") {
  const source = readFileSync(
    resolve(`apps/desktop/src/components/${name}.vue`),
    "utf8",
  );
  const start = source.indexOf(`function ${method}(`);
  if (start < 0) throw new Error(`Missing ${name} ${method} handler`);
  const shared = transformSync(
    readFileSync(resolve("apps/desktop/src/monitor.ts"), "utf8"),
    { loader: "ts", format: "esm" },
  ).code.replace(/^export /gm, "");
  return (
    shared +
    transformSync(source.slice(start, source.indexOf("\n}", start) + 2), {
      loader: "ts",
    }).code
  );
}
const handlers = {
  timeline: keyboard("TimelineEditor"),
  precision: keyboard("PrecisionEditor"),
  trim: keyboard("PrecisionEditor", "moveTrim"),
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
    const sourceActions: string[] = [];
    state.sourceActions = sourceActions;
    const mode = { value: "story" };
    state.shortcutCounts = counts;
    state.shortcutMode = mode;
    const timelineContext = {
      shortcutIsolation: { value: false },
      recordTarget: { value: false },
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
      addSourceMarker: () => {
        counts.marker++;
      },
      shuttle: () => sourceActions.push("shuttle"),
      stop: () => sourceActions.push("stop"),
      togglePlayback: () => sourceActions.push("play"),
      step: () => sourceActions.push("step"),
      stageIn: () => sourceActions.push("in"),
      stageOut: () => sourceActions.push("out"),
      split: () => sourceActions.push("split"),
      seek: () => sourceActions.push("seek"),
      trimIn: { value: 0 },
      trimOut: { value: 10 },
      playhead: { value: 2 },
      frameStep: { value: 1 / 30 },
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

test("Source shortcuts preserve Chromium defaults and counters in IME, editable, dialog, draft and Pipeline contexts", async ({
  page,
}) => {
  await mount(page);
  await page.evaluate(() => {
    const state = window as unknown as { shortcutMode: { value: string } };
    state.shortcutMode.value = "precision";
    document.body.insertAdjacentHTML(
      "beforeend",
      '<input id="input"><select id="select"><option>A</option></select><div contenteditable="" id="editable" tabindex="0">文字</div><div class="pipeline-workbench-root"><button id="pipeline">Pipeline</button></div><div class="runtime-drafts"><button id="draft">Draft</button></div><dialog id="dialog"><button id="dialog-button">Dialog</button></dialog>',
    );
  });
  const keys = [
    "j",
    "k",
    "l",
    "i",
    "o",
    "b",
    "m",
    " ",
    "ArrowLeft",
    "ArrowRight",
    "Home",
    "End",
  ];
  for (const context of [
    "ime",
    "input",
    "select",
    "editable",
    "pipeline",
    "draft",
    "dialog-button",
  ]) {
    const prevented = await page.evaluate(
      ({ context, keys }) => {
        if (context === "dialog-button")
          (document.getElementById("dialog") as HTMLDialogElement).showModal();
        const target = document.getElementById(
          context === "ime" ? "ready-control" : context,
        )!;
        target.focus();
        const results = keys.map((key) => {
          const event = new KeyboardEvent("keydown", {
            key,
            code: key === " " ? "Space" : key,
            isComposing: context === "ime",
            bubbles: true,
            cancelable: true,
          });
          target.dispatchEvent(event);
          return event.defaultPrevented;
        });
        if (context === "dialog-button")
          (document.getElementById("dialog") as HTMLDialogElement).close();
        return results;
      },
      { context, keys },
    );
    expect(prevented, context).toEqual(keys.map(() => false));
    expect(await counts(page), context).toEqual({
      deleted: 0,
      history: 0,
      marker: 0,
    });
    expect(
      await page.evaluate(
        () => (window as unknown as { sourceActions: string[] }).sourceActions,
      ),
      context,
    ).toEqual([]);
  }
  await page.locator("#ready-control").focus();
  await page.keyboard.press("j");
  await page.keyboard.press("i");
  await page.keyboard.press("o");
  await page.keyboard.press("m");
  expect(
    await page.evaluate(
      () => (window as unknown as { sourceActions: string[] }).sourceActions,
    ),
  ).toEqual(["shuttle", "in", "out"]);
  expect(await counts(page)).toEqual({ deleted: 0, history: 0, marker: 1 });
});

test("both Source trim handles preserve isolated defaults and retain intentional Shift adjustment in Chromium", async ({
  page,
}) => {
  await page.setContent(
    '<div id="box"><button id="in" role="slider">In</button><button id="out" role="slider">Out</button></div><dialog id="dialog"></dialog>',
  );
  await page.evaluate((code) => {
    const fixture = {
      trimIn: { value: 2 },
      trimOut: { value: 8 },
      lastDefault: false,
      handled: false,
    };
    (window as unknown as Record<string, unknown>).trimFixture = fixture;
    const context = {
      stageable: { value: true },
      trimIn: fixture.trimIn,
      trimOut: fixture.trimOut,
      trimSeparation: { value: 0.01 },
      sourceDuration: { value: 10 },
      frameStep: { value: 1 / 30 },
      snapResult: { value: undefined },
      clamp: (value: number, minimum: number, maximum: number) =>
        Math.min(maximum, Math.max(minimum, value)),
    };
    const moveTrim = new Function(
      "context",
      `const {${Object.keys(context).join(",")}} = context; ${code}; return moveTrim;`,
    )(context);
    for (const side of ["in", "out"]) {
      const handle = document.getElementById(side)!;
      handle.addEventListener("keydown", (event) => {
        if (fixture.handled) event.preventDefault();
      });
      handle.addEventListener("keydown", (event) => moveTrim(event, side));
      handle.addEventListener("keydown", (event) => {
        fixture.lastDefault = event.defaultPrevented;
      });
    }
  }, handlers.trim);
  const snapshot = () =>
    page.evaluate(() => {
      const fixture = (
        window as unknown as {
          trimFixture: {
            trimIn: { value: number };
            trimOut: { value: number };
            lastDefault: boolean;
          };
        }
      ).trimFixture;
      return {
        range: [fixture.trimIn.value, fixture.trimOut.value],
        prevented: fixture.lastDefault,
      };
    });
  for (const side of ["in", "out"]) {
    for (const modifier of ["Control", "Meta", "Alt"]) {
      await page.locator(`#${side}`).press(`${modifier}+ArrowRight`);
      expect(await snapshot(), `${side} ${modifier}`).toEqual({
        range: [2, 8],
        prevented: false,
      });
    }
    for (const context of [
      "ime",
      "handled",
      "contenteditable",
      "pipeline",
      "draft",
      "isolation",
      "dialog",
    ]) {
      await page.evaluate(
        ({ side, context }) => {
          const box = document.getElementById("box")!;
          const dialog = document.getElementById("dialog") as HTMLDialogElement;
          box.className =
            context === "pipeline"
              ? "pipeline-workbench-root"
              : context === "draft"
                ? "runtime-drafts"
                : "";
          box.removeAttribute("contenteditable");
          box.removeAttribute("data-shortcut-isolation");
          if (context === "contenteditable")
            box.setAttribute("contenteditable", "");
          if (context === "isolation")
            box.setAttribute("data-shortcut-isolation", "");
          if (context === "dialog") {
            dialog.append(box);
            dialog.showModal();
          } else document.body.append(box);
          const fixture = (
            window as unknown as { trimFixture: { handled: boolean } }
          ).trimFixture;
          fixture.handled = context === "handled";
          const handle = document.getElementById(side)!;
          handle.focus();
          handle.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "ArrowRight",
              isComposing: context === "ime",
              bubbles: true,
              cancelable: true,
            }),
          );
          fixture.handled = false;
          if (context === "dialog") {
            dialog.close();
            document.body.append(box);
          }
        },
        { side, context },
      );
      expect(await snapshot(), `${side} ${context}`).toEqual({
        range: [2, 8],
        prevented: context === "handled",
      });
    }
  }
  await page.locator("#in").press("ArrowRight");
  expect((await snapshot()).range[0]).toBeCloseTo(2 + 1 / 30);
  await page.locator("#out").press("Shift+ArrowLeft");
  expect((await snapshot()).range[1]).toBeCloseTo(8 - 10 / 30);
  expect((await snapshot()).prevented).toBe(true);
});
