import { build } from "esbuild";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import { TimelineEditor } from "@openfilm/application";
import { startServer } from "../../apps/server/src/server";
import { createAudioQualityFixture } from "../fixtures/audio-quality";

const desktop = createRequire(resolve("apps/desktop/package.json"));
const compiler = desktop("vue/compiler-sfc");
let runtime: Awaited<ReturnType<typeof startServer>>;
let root: string;
let fixture: string;
let prefix: string;
test.beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "openfilm-native-audio-browser-"));
  const previousData = process.env.OPENFILM_USER_DATA_DIR;
  process.env.OPENFILM_USER_DATA_DIR = join(root, "user-data");
  let projectId: string;
  let revision: string;
  try {
    const { app } = await createAudioQualityFixture(root);
    projectId = app.project.id;
    revision = new TimelineEditor(app).get("film").revision;
    app.close();
  } finally {
    if (previousData === undefined) delete process.env.OPENFILM_USER_DATA_DIR;
    else process.env.OPENFILM_USER_DATA_DIR = previousData;
  }
  const session = randomBytes(32).toString("hex");
  runtime = await startServer({
    port: 0,
    nativeSession: session,
    project: join(root, "film.openfilm"),
    userDataDirectory: join(root, "user-data"),
  });
  prefix = `http://127.0.0.1:${runtime.port}/native/${session}/api`;
  const components: Record<string, string> = {};
  for (const [name, file] of [
    ["quality", "AudioQualityPanel.vue"],
    ["generation", "AudioGenerationPanel.vue"],
  ]) {
    const path = resolve("apps/desktop/src/components", file!);
    components[`fixture:${name}`] = compiler.compileScript(
      compiler.parse(readFileSync(path, "utf8"), { filename: path }).descriptor,
      { id: `native-audio-${name}`, inlineTemplate: true },
    ).content;
  }
  const props = JSON.stringify({
    projectId,
    revision,
    compositionId: "film",
    clipId: "sound",
    disabled: false,
  });
  const output = await build({
    stdin: {
      contents: `import { createApp, h } from "vue"; import Quality from "fixture:quality"; import Generation from "fixture:generation"; import {configureNativeConnection} from ${JSON.stringify(resolve("apps/desktop/src/api.ts"))}; configureNativeConnection(${runtime.port},${JSON.stringify(session)}); createApp({render:()=>h('div',[h(Quality,${props}),h(Generation,${props})])}).mount('#app');`,
      resolveDir: resolve("apps/desktop"),
    },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    define: {
      "import.meta.env.DEV": "false",
      __VUE_OPTIONS_API__: "true",
      __VUE_PROD_DEVTOOLS__: "false",
      __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: "false",
    },
    plugins: [
      {
        name: "native-audio-browser-fixture",
        setup(bundler) {
          bundler.onResolve({ filter: /^vue$/ }, () => ({
            path: desktop.resolve("vue/dist/vue.esm-bundler.js"),
          }));
          bundler.onResolve(
            { filter: /^(fixture:(quality|generation)|vue-i18n)$/ },
            ({ path }) => ({ path, namespace: "fixture" }),
          );
          bundler.onLoad(
            { filter: /.*/, namespace: "fixture" },
            ({ path }) => ({
              contents:
                components[path] ??
                "export const useI18n = () => ({t:key=>key});",
              loader: "ts",
              resolveDir: resolve("apps/desktop/src/components"),
            }),
          );
        },
      },
    ],
  });
  fixture = output.outputFiles[0]!.text;
});
test.afterAll(async () => {
  await runtime?.close();
  if (root) await rm(root, { recursive: true, force: true });
});
test("native audio quality A/B and generated preview decode through the owned private endpoint", async ({
  page,
  request,
}) => {
  // The real native origin and session boundary are used; only the shell page
  // and translation labels are fixtures. Synthesis is the explicit local mock.
  // Chromium's website permission is specific to this simulated native origin;
  // the installed WebView's OS behavior remains a separate workstation gate.
  await page
    .context()
    .grantPermissions(["local-network-access"], {
      origin: "http://tauri.localhost",
    });
  await page.route("http://tauri.localhost/**", (route) =>
    route.fulfill({ contentType: "text/html", body: '<div id="app"></div>' }),
  );
  await page.goto("http://tauri.localhost/");
  await page.addScriptTag({ content: fixture });
  await page.getByTestId("audio-quality-measure").click();
  const quality = page.locator(".audio-quality-panel");
  await expect(quality.locator("audio")).toBeVisible();
  async function decoded(panel: string) {
    const audio = page.locator(panel).locator("audio");
    const src = await audio.getAttribute("src");
    expect(src).toContain(`${prefix}/`);
    await expect(audio).toHaveAttribute("crossorigin", "anonymous");
    expect(
      (await request.get(src!, { headers: { range: "bytes=0-63" } })).status(),
    ).toBe(206);
    await audio.evaluate((node) => {
      const player = node as HTMLAudioElement;
      player.preload = "metadata";
      player.load();
    });
    await expect
      .poll(() =>
        audio.evaluate((node) => (node as HTMLAudioElement).readyState),
      )
      .toBeGreaterThan(0);
  }
  await decoded(".audio-quality-panel");
  await quality
    .getByRole("button", { name: "editor.audioQuality.candidate", exact: true })
    .click();
  await decoded(".audio-quality-panel");
  const generation = page.locator(".audio-generation-panel");
  await generation
    .getByTestId("audio-generation-text")
    .fill("Synthetic local audio preview");
  await generation.getByTestId("audio-generation-consent").check();
  await generation.getByTestId("audio-generation-generate").click();
  await expect(generation.locator("audio")).toBeVisible();
  await decoded(".audio-generation-panel");
  expect(
    (
      await request.get(`http://127.0.0.1:${runtime.port}/api/workspace`)
    ).status(),
  ).toBe(403);
});
