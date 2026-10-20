import { build } from "esbuild";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { startServer } from "../../apps/server/src/server";
import { createAudioQualityFixture } from "../fixtures/audio-quality";

const desktop = createRequire(resolve("apps/desktop/package.json"));
const compiler = desktop("vue/compiler-sfc");
let runtime: Awaited<ReturnType<typeof startServer>>;
let root: string;
let prefix: string;
let fixture: string;
let filename: string;
let expectedVideo: string;
let expectedManifest: string;
const received: Array<{
  origin: string | undefined;
  site: string | undefined;
}> = [];
const digest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
test.beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "openfilm-native-download-browser-"));
  const { app, audio } = await createAudioQualityFixture(root);
  app.catalog.intelligence.replaceTranscript({
    id: randomUUID(),
    assetId: audio.id,
    language: "en",
    provenance: {
      providerId: "explicit-native-download-text-not-ASR",
      version: "1",
      sourceHash: audio.contentHash!,
      createdAt: "2026-10-20T00:00:00Z",
    },
    segments: [
      {
        id: "spoken",
        start: 0,
        end: 2,
        text: "Native caption download evidence.",
      },
    ],
  });
  await app.save();
  const exported = await app.exportMp4("film");
  filename = basename(exported.path);
  expectedVideo = digest(await readFile(exported.path));
  expectedManifest = digest(await readFile(`${exported.path}.manifest.json`));
  const props = JSON.stringify({
    busy: false,
    projectId: app.project.id,
    projectSettings: app.project.settings,
    composition: app.project.timelines[0],
    path: exported.path,
    filename,
    format: "mp4",
    stale: false,
  });
  app.close();
  const session = randomBytes(32).toString("hex");
  runtime = await startServer({
    port: 0,
    nativeSession: session,
    project: join(root, "film.openfilm"),
    userDataDirectory: join(root, "data"),
  });
  runtime.server.prependListener("request", (request) => {
    if (request.url?.includes("/export/file?"))
      received.push({
        origin: request.headers.origin,
        site: request.headers["sec-fetch-site"] as string | undefined,
      });
  });
  prefix = `http://127.0.0.1:${runtime.port}/native/${session}/api`;
  const output = await build({
    stdin: {
      contents: `import {createApp,h} from 'vue'; import ExportWorkspace from ${JSON.stringify(resolve("apps/desktop/src/components/ExportWorkspace.vue"))}; import {configureNativeConnection} from ${JSON.stringify(resolve("apps/desktop/src/api.ts"))}; configureNativeConnection(${runtime.port},${JSON.stringify(session)}); createApp({render:()=>h(ExportWorkspace,${props})}).mount('#app');`,
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
        name: "actual-native-download-components",
        setup(bundler) {
          bundler.onResolve({ filter: /^vue$/ }, () => ({
            path: desktop.resolve("vue/dist/vue.esm-bundler.js"),
          }));
          bundler.onResolve(
            { filter: /^(vue-i18n|\.\.\/i18n)$/ },
            ({ path }) => ({ path, namespace: "labels" }),
          );
          bundler.onLoad({ filter: /.*/, namespace: "labels" }, ({ path }) => ({
            loader: "ts",
            contents:
              path === "vue-i18n"
                ? "import {ref} from 'vue'; export const useI18n=()=>({t:key=>key,te:()=>true,locale:ref('en-US')});"
                : "export const localizeError=e=>e.message; export const errorDetail=e=>String(e); export const formatNumber=String; export const formatDuration=String;",
          }));
          bundler.onLoad({ filter: /\.vue$/ }, ({ path }) => ({
            loader: "ts",
            contents: compiler.compileScript(
              compiler.parse(readFileSync(path, "utf8"), { filename: path })
                .descriptor,
              { id: path, inlineTemplate: true },
            ).content,
            resolveDir: resolve(path, ".."),
          }));
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
async function mount(page: Page, sameOrigin = false) {
  await page.context().grantPermissions(["local-network-access"], {
    origin: "http://tauri.localhost",
  });
  const documentUrl = `${sameOrigin ? new URL(prefix).origin : "http://tauri.localhost"}/download-fixture`;
  await page.route(documentUrl, (route) =>
    route.fulfill({ contentType: "text/html", body: '<div id="app"></div>' }),
  );
  await page.goto(documentUrl);
  await page.evaluate(() => {
    const state = window as unknown as {
      blobCreated: number;
      blobRevoked: number;
    };
    state.blobCreated = 0;
    state.blobRevoked = 0;
    const create = URL.createObjectURL.bind(URL),
      revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      state.blobCreated++;
      return create(blob);
    };
    URL.revokeObjectURL = (url) => {
      state.blobRevoked++;
      revoke(url);
    };
  });
  await page.addScriptTag({ content: fixture });
}
async function downloaded(
  page: Page,
  link: Locator,
  expectedName: string,
  keyboard = false,
) {
  await expect(link).toBeVisible();
  const pending = page.waitForEvent("download", { timeout: 5000 });
  if (keyboard) {
    await link.focus();
    await link.press("Enter");
  } else await link.click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe(expectedName);
  const path = await download.path();
  expect(path).toBeTruthy();
  expect(await download.failure()).toBeNull();
  const bytes = await readFile(path!);
  await test
    .info()
    .attach(`native-download-${expectedName}-${digest(bytes).slice(0, 8)}`, {
      contentType: "application/json",
      body: Buffer.from(
        JSON.stringify({
          filename: download.suggestedFilename(),
          bytes: bytes.byteLength,
          sha256: digest(bytes),
        }),
      ),
    });
  return bytes;
}
test("native-origin rendered MP4 and manifest download real bytes with Enter and blob URL cleanup", async ({
  page,
  request,
}) => {
  await mount(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  expect(
    digest(
      await downloaded(page, page.locator(".export-result a"), filename, true),
    ),
  ).toBe(expectedVideo);
  await page.locator(".export-report-details > summary").click();
  expect(
    digest(
      await downloaded(
        page,
        page.locator(".export-report-details a"),
        `${filename}.manifest.json`,
      ),
    ),
  ).toBe(expectedManifest);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const s = window as unknown as {
          blobCreated: number;
          blobRevoked: number;
        };
        return [s.blobCreated, s.blobRevoked];
      }),
    )
    .toEqual([2, 2]);
  expect(errors).toEqual([]);
  expect(
    (
      await request.get(prefix + "/workspace", {
        headers: { Origin: "https://attacker.example" },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.get(
        `http://127.0.0.1:${runtime.port}/api/export/file?name=${encodeURIComponent(filename)}`,
      )
    ).status(),
  ).toBe(403);
});
test("same-origin browser exports preserve direct streaming without creating a blob", async ({
  page,
}) => {
  await mount(page, true);
  expect(
    digest(
      await downloaded(page, page.locator(".export-result a"), filename, true),
    ),
  ).toBe(expectedVideo);
  expect(
    await page.evaluate(() => {
      const s = window as unknown as {
        blobCreated: number;
        blobRevoked: number;
      };
      return [s.blobCreated, s.blobRevoked];
    }),
  ).toEqual([0, 0]);
});
test("a forbidden native download surfaces an error without an unhandled rejection or a leaked blob", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let downloads = 0;
  page.on("download", () => downloads++);
  await mount(page);
  await page.evaluate(() => {
    const s = window as unknown as { unhandled: string[] };
    s.unhandled = [];
    window.addEventListener("unhandledrejection", (event) =>
      s.unhandled.push(String(event.reason)),
    );
  });
  // Response fault injection exercises the actual compiled link/helper error
  // path. Successful downloads and Origin rejection use the real server above.
  await page.route(`${prefix}/export/file?**`, (route) =>
    route.fulfill({
      status: 403,
      headers: { "Access-Control-Allow-Origin": "http://tauri.localhost" },
      contentType: "application/json",
      body: JSON.stringify({
        error: "Synthetic forbidden download",
        code: "request.invalid",
      }),
    }),
  );
  await page.locator(".export-result a").focus();
  await page.locator(".export-result a").press("Enter");
  await expect(page.locator(".export-result [role=alert]")).toHaveText(
    "Synthetic forbidden download",
  );
  expect(
    await page.evaluate(() => {
      const s = window as unknown as {
        blobCreated: number;
        blobRevoked: number;
        unhandled: string[];
      };
      return {
        created: s.blobCreated,
        revoked: s.blobRevoked,
        unhandled: s.unhandled,
      };
    }),
  ).toEqual({ created: 0, revoked: 0, unhandled: [] });
  expect(downloads).toBe(0);
  expect(errors).toEqual([]);
});
test("native-origin SRT and VTT publications and their manifests download exact server-owned bytes", async ({
  page,
}) => {
  await mount(page);
  await page.locator(".caption-export > summary").click();
  await page.getByTestId("caption-track").selectOption("sound");
  await page.getByTestId("caption-generate").click();
  await expect(page.getByTestId("caption-cue")).toHaveCount(1);
  for (const format of ["srt", "vtt"] as const) {
    const publicationResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/captions/export") &&
        response.request().method() === "POST",
    );
    await page.getByTestId(`caption-export-${format}`).click();
    const publication = (await (await publicationResponse).json()) as {
      id: string;
      relativePath: string;
      fileName: string;
    };
    const bytes = await downloaded(
      page,
      page.getByTestId("caption-download"),
      `captions.${format}`,
    );
    expect(digest(bytes)).toBe(
      digest(
        await readFile(join(root, "film.openfilm", publication.relativePath)),
      ),
    );
    expect(bytes.toString()).toContain("Native caption download evidence.");
    const manifest = await downloaded(
      page,
      page.getByTestId("caption-manifest"),
      "captions.manifest.json",
    );
    expect(digest(manifest)).toBe(
      digest(
        await readFile(
          join(
            root,
            "film.openfilm",
            "exports",
            `captions-${publication.id}`,
            "manifest.json",
          ),
        ),
      ),
    );
  }
});
test("a direct cross-site download navigation without Origin remains forbidden", async ({
  page,
}) => {
  await mount(page);
  const offset = received.length;
  await page.evaluate(
    (url) => {
      const a = document.createElement("a");
      a.id = "negative-anchor";
      a.href = url;
      a.download = "direct.mp4";
      a.textContent = "Direct control";
      document.body.append(a);
    },
    `${prefix}/export/file?name=${encodeURIComponent(filename)}`,
  );
  const response = page.waitForResponse((response) =>
    response.url().includes("/export/file?"),
  );
  await page.locator("#negative-anchor").click();
  const blocked = await response;
  expect(blocked.status()).toBe(403);
  expect(received.slice(offset)).toContainEqual({
    origin: undefined,
    site: "cross-site",
  });
});
