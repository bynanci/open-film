import { build } from "esbuild";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, test, type Page, type Route } from "@playwright/test";
import type { Composition, MediaAsset } from "@openfilm/core";

const desktop = createRequire(resolve("apps/desktop/package.json"));
const compiler = desktop("vue/compiler-sfc");
const run = promisify(execFile);
let temporary: string;
let movie: Buffer;
let photo: Buffer;
let javascript: string;
let stylesheet: string;
interface BrowserMonitor {
  monitor: {
    frame: number;
    buffering: boolean;
    playing: boolean;
    play(): void;
    pause(): void;
    seek(frame: number): void;
  };
  frames: number[];
  issues: { code: string }[];
  events: { seeking: number; canplay: number };
  onFrame?: (frame: number) => void;
  replaceProject(projectId: string): void;
}
declare global {
  interface Window {
    recordTest: BrowserMonitor;
  }
}

test.beforeAll(async () => {
  temporary = await mkdtemp(join(tmpdir(), "openfilm-record-browser-"));
  await run("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=red:s=160x90:r=10:d=4",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=4",
    "-c:v",
    "libx264",
    "-threads",
    "1",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-movflags",
    "+faststart",
    join(temporary, "source.mp4"),
  ]);
  await run("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:s=40x80",
    "-frames:v",
    "1",
    "-threads",
    "1",
    join(temporary, "photo.png"),
  ]);
  movie = await readFile(join(temporary, "source.mp4"));
  photo = await readFile(join(temporary, "photo.png"));
  const styles: string[] = [
    readFileSync("apps/desktop/src/editor.css", "utf8"),
  ];
  const output = await build({
    stdin: {
      contents: `import {createApp,h,ref,reactive} from "vue";
        import RecordMonitor from "./src/components/RecordMonitor.vue";
        const monitor=ref(); const frames=[]; const issues=[]; const events={seeking:0,canplay:0};
        document.addEventListener('seeking',()=>events.seeking++,true);
        document.addEventListener('canplay',()=>events.canplay++,true);
        const fixture=reactive(window.recordFixture);
        const app=createApp({render:()=>h(RecordMonitor,{...fixture,ref:monitor,onFrame:f=>{frames.push(f);window.recordTest?.onFrame?.(f)},onIssue:i=>issues.push(i)})});
        app.mount('#app'); window.recordTest={get monitor(){return monitor.value},frames,issues,events,replaceProject:id=>fixture.projectId=id};`,
      resolveDir: resolve("apps/desktop"),
    },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    define: {
      "import.meta.env.DEV": "false",
      "process.env.NODE_ENV": '"production"',
      __VUE_OPTIONS_API__: "true",
      __VUE_PROD_DEVTOOLS__: "false",
      __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: "false",
    },
    plugins: [
      {
        name: "record-production-components",
        setup(bundler) {
          bundler.onResolve({ filter: /^vue$/ }, () => ({
            path: desktop.resolve("vue/dist/vue.esm-bundler.js"),
          }));
          // Translation formatting is the only component dependency replaced.
          bundler.onResolve(
            { filter: /^(vue-i18n|\.\.\/i18n)$/ },
            ({ path }) => ({ path, namespace: "labels" }),
          );
          bundler.onLoad({ filter: /.*/, namespace: "labels" }, () => ({
            contents:
              "export const useI18n=()=>({t:key=>key}); export const formatDuration=String;",
            loader: "js",
          }));
          bundler.onLoad({ filter: /\.vue$/ }, ({ path }) => {
            const descriptor = compiler.parse(readFileSync(path, "utf8"), {
              filename: path,
            }).descriptor;
            const id = `data-v-record-${basename(path).replaceAll(".", "-")}`;
            const script = compiler.compileScript(descriptor, {
              id,
              inlineTemplate: true,
            }).content;
            for (const style of descriptor.styles)
              styles.push(
                compiler.compileStyle({
                  source: style.content,
                  filename: path,
                  id,
                  scoped: style.scoped,
                }).code,
              );
            return {
              contents: `${script.replace("export default", "const component =")}\ncomponent.__scopeId=${JSON.stringify(id)};export default component;`,
              loader: "ts",
              resolveDir: resolve(path, ".."),
            };
          });
        },
      },
    ],
  });
  javascript = output.outputFiles[0]!.text;
  stylesheet = styles.join("\n");
});
test.afterAll(async () => {
  if (temporary) await rm(temporary, { recursive: true, force: true });
});

const asset = (id: string, image = false): MediaAsset => ({
  id,
  name: id,
  uri: `file:///${id}`,
  mediaType: image ? "image" : "video",
  duration: 4,
  frameRate: 10,
  dimensions: image ? { width: 40, height: 80 } : { width: 160, height: 90 },
  tags: [],
  state: {},
  metadata: image
    ? {}
    : { "openfilm.ffprobe": { streams: [{ codec_type: "audio" }] } },
});
async function serve(route: Route, image: boolean, fail = false) {
  const body = image ? photo : movie;
  const range = route
    .request()
    .headers()
    .range?.match(/bytes=(\d+)-(\d*)/);
  const start = range ? Number(range[1]) : 0;
  const end = range?.[2]
    ? Math.min(body.length - 1, Number(range[2]))
    : body.length - 1;
  await route.fulfill({
    status: fail ? 404 : range ? 206 : 200,
    headers: {
      "access-control-allow-origin": "*",
      "content-type": image ? "image/png" : "video/mp4",
      "accept-ranges": "bytes",
      ...(range
        ? { "content-range": `bytes ${start}-${end}/${body.length}` }
        : {}),
    },
    body: fail ? Buffer.alloc(0) : body.subarray(start, end + 1),
  });
}
async function mount(
  page: Page,
  composition: Composition,
  assets: MediaAsset[],
) {
  await page.route("http://record.test/", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<div id="app" style="width:320px"></div>',
    }),
  );
  await page.goto("http://record.test/");
  await page.evaluate(
    (fixture) => {
      Object.assign(window, { recordFixture: fixture });
    },
    {
      projectId: "project",
      composition,
      assets,
      revision: "r1",
      active: true,
      settings: { width: 320, height: 180, frameRate: 10 },
    },
  );
  await page.addStyleTag({ content: stylesheet });
  await page.addScriptTag({ content: javascript });
}
const composition = (): Composition => ({
  id: "record",
  storyId: "story",
  duration: 3,
  tracks: [
    {
      id: "v",
      type: "video",
      clips: [
        {
          id: "video",
          assetId: "video",
          timelineStart: 0,
          timelineDuration: 3,
          sourceOut: 3,
        },
      ],
    },
  ],
});

test("slow GraphicScene playback retains its texture with bounded requests and fences discontinuities and owner switches", async ({
  page,
}) => {
  await page.route("http://127.0.0.1:4310/api/source/**", (route) =>
    serve(route, false),
  );
  const pending: Array<{ route: Route; frame: number; projectId: string }> = [];
  await page.route("**/compositions/record/graphics.png?**", async (route) => {
    const url = new URL(route.request().url());
    const frame = Number(url.searchParams.get("frame"));
    const projectId = url.searchParams.get("projectId")!;
    if (pending.length === 0 && frame === 0 && projectId === "project") {
      pending.push({ route, frame, projectId });
      await route.fulfill({ contentType: "image/png", body: photo });
    } else pending.push({ route, frame, projectId });
  });
  const saved = composition();
  saved.graphicScenes = [
    {
      version: 1,
      id: "g",
      name: "synthetic",
      start: 0,
      duration: 3,
      zIndex: 0,
      nodes: [],
    },
  ];
  try {
    await mount(page, saved, [asset("video")]);
    const image = page.getByTestId("graphic-preview");
    await expect(image).toHaveAttribute("data-frame", "0");
    await expect
      .poll(() => page.evaluate(() => window.recordTest.monitor.buffering))
      .toBe(false);
    await page.evaluate(() => window.recordTest.monitor.play());
    await expect.poll(() => pending.length).toBe(2);
    const slow = pending[1]!;
    await expect
      .poll(() => page.evaluate(() => window.recordTest.monitor.frame))
      .toBeGreaterThanOrEqual(slow.frame + 4);
    await expect(image).toHaveAttribute("data-frame", "0");
    expect(pending).toHaveLength(2);
    await slow.route.fulfill({ contentType: "image/png", body: photo });
    await expect(image).toHaveAttribute("data-frame", String(slow.frame));
    await expect.poll(() => pending.length).toBe(3);
    const obsolete = pending[2]!;
    await page.evaluate(() => {
      window.recordTest.monitor.pause();
      window.recordTest.monitor.seek(17);
    });
    await expect
      .poll(() => pending.some((item) => item.frame === 17))
      .toBe(true);
    const exact = pending.findLast((item) => item.frame === 17)!;
    await exact.route.fulfill({ contentType: "image/png", body: photo });
    await expect(image).toHaveAttribute("data-frame", "17");
    await obsolete.route
      .fulfill({ contentType: "image/png", body: photo })
      .catch(() => {});
    await expect(image).toHaveAttribute("data-frame", "17");
    await page.evaluate(() => window.recordTest.monitor.seek(22));
    await expect
      .poll(() => pending.some((item) => item.frame === 22))
      .toBe(true);
    const oldOwner = pending.findLast((item) => item.frame === 22)!;
    await page.evaluate(() => window.recordTest.replaceProject("replacement"));
    await expect
      .poll(() => pending.some((item) => item.projectId === "replacement"))
      .toBe(true);
    await oldOwner.route
      .fulfill({ contentType: "image/png", body: photo })
      .catch(() => {});
    await expect(image).toHaveCount(0);
    await pending
      .findLast((item) => item.projectId === "replacement")!
      .route.fulfill({ contentType: "image/png", body: photo });
    await expect(image).toHaveAttribute("data-frame", "0");
  } finally {
    await page.unrouteAll({ behavior: "ignoreErrors" });
  }
});

test("canplay settles without seek feedback and actual video playback advances Record", async ({
  page,
}) => {
  await page.route("http://127.0.0.1:4310/api/source/**", (route) =>
    serve(route, false),
  );
  await mount(page, composition(), [asset("video")]);
  await expect
    .poll(() =>
      page
        .locator("video")
        .evaluate((node) => (node as HTMLVideoElement).readyState),
    )
    .toBeGreaterThanOrEqual(3);
  // This observation window detects a self-sustaining native canplay/seek loop.
  await page.waitForTimeout(250);
  expect(
    await page.evaluate(() => window.recordTest.events.seeking),
  ).toBeLessThan(10);
  expect(await page.evaluate(() => window.recordTest.monitor.buffering)).toBe(
    false,
  );
  await page.evaluate(() => window.recordTest.monitor.play());
  await expect
    .poll(() => page.evaluate(() => window.recordTest.monitor.frame))
    .toBeGreaterThanOrEqual(12);
  expect(
    await page.evaluate(() => window.recordTest.events.seeking),
  ).toBeLessThan(20);
});

test("a frame consumer seeking the published frame cannot feed native readiness back into publication", async ({
  page,
}) => {
  await page.route("http://127.0.0.1:4310/api/source/**", (route) =>
    serve(route, false),
  );
  await mount(page, composition(), [asset("video")]);
  await expect
    .poll(() =>
      page
        .locator("video")
        .evaluate((node) => (node as HTMLVideoElement).readyState),
    )
    .toBeGreaterThanOrEqual(3);
  await page.evaluate(() => {
    const probe = window.recordTest;
    probe.onFrame = (frame) => probe.monitor.seek(frame);
    probe.monitor.seek(1);
  });
  // Observe the native seek/canplay callbacks after the synchronous drain ends.
  await page.waitForTimeout(300);
  const observed = await page.evaluate(() => ({
    ...window.recordTest.events,
    publications: window.recordTest.frames.filter((frame) => frame === 1)
      .length,
    frame: window.recordTest.monitor.frame,
    buffering: window.recordTest.monitor.buffering,
  }));
  console.log("Record frame-consumer/native feedback", observed);
  expect(observed.publications).toBe(1);
  expect(observed.seeking).toBeLessThan(10);
  expect(observed.canplay).toBeLessThan(10);
  expect(observed.frame).toBe(1);
  expect(observed.buffering).toBe(false);
  await page.evaluate(() => window.recordTest.monitor.seek(1));
  await page.waitForTimeout(100);
  expect(
    await page.evaluate(
      () => window.recordTest.frames.filter((frame) => frame === 1).length,
    ),
  ).toBe(2);
  await page.evaluate(() => window.recordTest.monitor.play());
  await expect
    .poll(() => page.evaluate(() => window.recordTest.monitor.frame))
    .toBeGreaterThanOrEqual(12);
});

for (const secondaryFails of [false, true]) {
  test(`Record waits for both displayed diptych images and ${secondaryFails ? "holds secondary decode failure" : "resumes after both loads"}`, async ({
    page,
  }) => {
    const pending: Array<{ route: Route; secondary: boolean }> = [];
    await page.route("http://127.0.0.1:4310/api/source/**", async (route) => {
      const source = new URL(route.request().url());
      const secondary = source.pathname.endsWith("/secondary");
      if (secondary || source.searchParams.get("v")?.startsWith("photo:file"))
        pending.push({ route, secondary });
      else await serve(route, true);
    });
    const saved = composition();
    saved.tracks[0]!.clips = [
      {
        id: "photo",
        assetId: "photo",
        timelineStart: 0,
        timelineDuration: 3,
        layout: {
          version: 1,
          preset: "diptych",
          secondary: { assetId: "secondary" },
        },
      },
    ];
    await mount(page, saved, [asset("photo", true), asset("secondary", true)]);
    await expect.poll(() => pending.length).toBe(2);
    await page.evaluate(() => window.recordTest.monitor.play());
    await page.waitForTimeout(250);
    expect(await page.evaluate(() => window.recordTest.monitor.frame)).toBe(0);
    expect(await page.evaluate(() => window.recordTest.monitor.buffering)).toBe(
      true,
    );
    const displayed = page.locator(".photo-presentation-layers > img");
    expect(
      await displayed
        .first()
        .evaluate((node) => (node as HTMLImageElement).naturalWidth),
    ).toBe(0);
    await serve(pending.find((entry) => !entry.secondary)!.route, true);
    await expect
      .poll(() =>
        displayed
          .first()
          .evaluate((node) => (node as HTMLImageElement).naturalWidth),
      )
      .toBe(40);
    expect(await page.evaluate(() => window.recordTest.monitor.buffering)).toBe(
      true,
    );
    await serve(
      pending.find((entry) => entry.secondary)!.route,
      true,
      secondaryFails,
    );
    if (!secondaryFails) {
      await expect
        .poll(() => page.evaluate(() => window.recordTest.monitor.frame))
        .toBeGreaterThanOrEqual(2);
      expect(
        await page.evaluate(() => window.recordTest.monitor.buffering),
      ).toBe(false);
      expect(
        await displayed
          .last()
          .evaluate((node) => (node as HTMLImageElement).naturalWidth),
      ).toBe(40);
      return;
    }
    await expect
      .poll(() =>
        page.evaluate(() =>
          window.recordTest.issues.some(
            (issue) => issue.code === "record.decode-failed",
          ),
        ),
      )
      .toBe(true);
    expect(await page.evaluate(() => window.recordTest.monitor.playing)).toBe(
      false,
    );
    expect(await page.evaluate(() => window.recordTest.monitor.frame)).toBe(0);
  });
}

test("actual controlled overlay frame keeps its uncovered region transparent", async ({
  page,
}) => {
  await page.route("http://127.0.0.1:4310/api/source/**", (route) =>
    serve(route, route.request().url().includes("/portrait?")),
  );
  const saved = composition();
  saved.tracks.push({
    id: "overlay",
    type: "overlay",
    clips: [
      {
        id: "portrait",
        assetId: "portrait",
        timelineStart: 0,
        timelineDuration: 3,
        transform: { scale: 0.5 },
      },
    ],
  });
  await mount(page, saved, [asset("video"), asset("portrait", true)]);
  const frame = page.locator(".photo-presentation-frame");
  expect(
    await frame.evaluate((node) => getComputedStyle(node).backgroundColor),
  ).toBe("rgba(0, 0, 0, 0)");
  expect(
    await page
      .locator(".photo-presentation-layers > img")
      .evaluate((node) => node.getBoundingClientRect().width),
  ).toBeLessThan(160);
});
