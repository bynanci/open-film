// Modified by OpenFilm contributors on 2026-11-12. See LICENSE and NOTICE.
// Opt-in local recorded-media browser validation; never imported by OpenFilm or CI.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { connect } from "node:net";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { assertSessionProjectState } from "./silence-real-browser-state.ts";

const execFileAsync = promisify(execFile);
const pins = {
  "paddy-neary.opus":
    "42973f944af32809fe9f7446a7a745d64fe9fc3e51db521902563f7fa2946053",
  "guitar.ogg":
    "d6ff6cafd3025db2e2215b32e3e7e6411fa08a8d2e0fca7c3353b5a4a82523a5",
};
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i];
  assert(
    [
      "--repo",
      "--packet",
      "--sources",
      "--output",
      "--head",
      "--browser",
      "--headed",
    ].includes(key),
    `Unknown argument ${key}`,
  );
  assert(!(key in args), `Duplicate argument ${key}`);
  args[key] = key === "--headed" ? true : process.argv[++i];
}
for (const key of ["--repo", "--packet", "--sources", "--output", "--head"])
  assert.equal(typeof args[key], "string", `Required ${key}`);
assert.match(args["--head"], /^[a-f0-9]{40}$/u);
const repo = await realpath(args["--repo"]);
const packet = await realpath(args["--packet"]);
const sources = await realpath(args["--sources"]);
const outputParent = await realpath(dirname(resolve(args["--output"])));
const output = join(outputParent, resolve(args["--output"]).split(sep).at(-1));
function external(path) {
  const rel = relative(repo, path);
  assert(
    rel && (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)),
    `Must remain outside candidate: ${path}`,
  );
}
for (const path of [packet, sources, output]) external(path);
for (const parent of [packet, sources]) {
  const rel = relative(parent, output);
  assert(
    rel && (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)),
    "Evidence must not be created inside packet or source directories",
  );
}
await mkdir(output); // Deliberately nonrecursive: never overwrite a previous attempt.
assert.equal(await realpath(output), output);

const report = {
  schema: "openfilm.recorded-browser-qa.v1",
  status: "RUNNING",
  startedAt: new Date().toISOString(),
  candidate: args["--head"],
  repo,
  packet,
  sources,
  output,
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  driverPath: fileURLToPath(import.meta.url),
  scope:
    "New candidate-bound CC0 packet; objective Linux browser lifecycle only",
  humanListening: "NOT PERFORMED",
  physicalAudioOutput: "NOT OBSERVED",
  qualityAcceptance: "manual-review-required",
  fullyAcceptedQuality: false,
  recordedAvSync: "NOT PERFORMED",
  capturedChannelsAboveStereo: "NOT PERFORMED",
  windowsMacosWorkstations: "NOT PERFORMED",
  cancellationPhase: "UNOBSERVED; no FFmpeg-phase claim is permitted",
  checks: [],
  cleanup: [],
  failures: [],
  serverRequests: [],
  browserRequests: [],
  projectIdentityObservations: [],
  projectCloseWindows: [],
  sessionProjectStateChecks: [],
};
const save = () =>
  writeFile(
    join(output, "browser-results.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
const fail = (where, error) =>
  report.failures.push({ where, message: String(error), stack: error?.stack });
async function sha(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
async function json(path) {
  return JSON.parse(await readFile(path, "utf8"));
}
async function tree(path) {
  const found = {};
  async function visit(current) {
    for (const name of (await readdir(current)).sort()) {
      const child = join(current, name),
        info = await lstat(child);
      assert(
        !info.isSymbolicLink(),
        `Packet project must not contain symlinks: ${child}`,
      );
      if (info.isDirectory()) await visit(child);
      else {
        assert(info.isFile(), `Unexpected packet object ${child}`);
        found[relative(path, child)] = await sha(child);
      }
    }
  }
  await visit(path);
  return found;
}
async function git(...params) {
  return (await execFileAsync("git", ["-C", repo, ...params])).stdout.trim();
}
async function until(check, description, timeout = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const result = await check();
    if (result) return result;
    await new Promise((done) => setTimeout(done, 25));
  }
  throw new Error(`Timed out: ${description}`);
}
async function portClosed(port) {
  return new Promise((done) => {
    const socket = connect({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      done(false);
    });
    socket.once("error", () => {
      socket.destroy();
      done(true);
    });
    socket.setTimeout(1000, () => {
      socket.destroy();
      done(false);
    });
  });
}
let runtime, vite, browser, context, page, expect;
let serverOrigin, desktopOrigin, serverPort, desktopPort;
let baseline, cases;
let lastObservedProjectIdentity;
let interrupted;
const browserEventTasks = new Set();
const serverAuditions = [];
const cleanup = async (name, action) => {
  try {
    await action();
    report.cleanup.push({ name, ok: true });
  } catch (error) {
    fail(`cleanup:${name}`, error);
    report.cleanup.push({ name, ok: false });
  }
};
function onSignal(signal) {
  if (interrupted) return;
  interrupted = signal;
  fail("signal", new Error(`Interrupted by ${signal}`));
  // Closing only our own browser interrupts pending UI waits and enters finally.
  // Signals during startup are checked immediately after each resource is acquired.
  if (browser)
    void browser.close().catch((error) => fail("signal:browser-close", error));
}
const onInt = () => onSignal("SIGINT"),
  onTerm = () => onSignal("SIGTERM");
process.once("SIGINT", onInt);
process.once("SIGTERM", onTerm);
function assertRunning() {
  assert(!interrupted, `Interrupted by ${interrupted}`);
}
function observedWait(promise) {
  // Handle the original promise immediately, including when a preceding click fails.
  // Return that same promise so its eventual await still throws the original error.
  void promise.then(
    () => {},
    () => {},
  );
  return promise;
}
async function api(path, method = "GET", body) {
  const response = await fetch(`${serverOrigin}/api${path}`, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    value = text;
  }
  return {
    status: response.status,
    value,
    headers: Object.fromEntries(response.headers),
  };
}
async function observeProjectIdentity() {
  const response = await api("/project");
  assert.equal(response.status, 200);
  const projectId = response.value.project?.id ?? null;
  assert(projectId === null || typeof projectId === "string");
  const identity = {
    projectId,
    observedAt: Date.now(),
    source: "GET /api/project",
  };
  report.projectIdentityObservations.push(identity);
  lastObservedProjectIdentity = identity;
  return { response, identity };
}
function auditionRegion() {
  return page.getByRole("region", {
    name: "Rendered seam audition",
    exact: true,
  });
}
async function openFilm(item) {
  item.uiEpoch = Date.now();
  await page.getByRole("button", { name: "Open project", exact: true }).click();
  const form = page.locator(".open-project-form");
  await form
    .getByLabel("Project folder to open", { exact: true })
    .fill(item.sessionPath);
  await form.getByRole("button", { name: "Open project", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Switch project", exact: true }),
  ).toBeEnabled();
}
async function openReview(item) {
  await page
    .getByRole("navigation", { name: "Film workspace", exact: true })
    .getByRole("button", { name: "Edit", exact: true })
    .click();
  await expect(page.locator(`#clip-${item.voiceClipId}`)).toBeVisible();
  const precision = page
    .getByRole("group", { name: "Editing mode", exact: true })
    .getByRole("button", { name: "Precision", exact: true });
  if ((await precision.getAttribute("aria-pressed")) !== "true")
    await precision.click();
  const toggle = page.getByRole("button", {
    name: "Silence review",
    exact: true,
  });
  if (!(await page.locator(".silence-review").isVisible()))
    await toggle.click();
  const source = page.getByRole("combobox", {
    name: "Timeline source",
    exact: true,
  });
  await source.selectOption(item.review.proposal.assetId);
  await expect(page.locator(".silence-candidate")).toHaveCount(
    item.review.proposal.candidates.length,
    { timeout: 30000 },
  );
  await expect(page.locator(".silence-status")).toHaveText("Review candidates");
  const boxes = page.locator(".silence-candidate input[type=checkbox]");
  for (let index = 0; index < item.review.proposal.candidates.length; index++) {
    const selected = item.review.proposal.selectedCandidateIds.includes(
      item.review.proposal.candidates[index].id,
    );
    if (selected) await expect(boxes.nth(index)).toBeChecked();
    else await expect(boxes.nth(index)).not.toBeChecked();
  }
  const visibleReview = await assertReviewDom(item);
  const browserReview = await until(
    () =>
      report.browserRequests.findLast(
        (row) =>
          row.event === "response" &&
          row.method === "GET" &&
          new URL(row.url).pathname ===
            `/api/silence/jobs/${item.jobId}/review` &&
          row.at >= item.uiEpoch &&
          row.body?.review?.reviewId === item.review.reviewId,
      ),
    "browser received the current project Review",
  );
  assert.deepEqual(browserReview.body.review, item.review);
  return {
    ...(await verify(item)),
    visibleReview,
    browserReviewResponse: {
      at: browserReview.at,
      reviewId: browserReview.body.review.reviewId,
      jobId: browserReview.body.job.id,
    },
  };
}
// Exact formatting contract reviewed at candidate H: SilenceReviewPanel.vue:197.
function reviewTime(value) {
  const milliseconds = Math.max(0, Math.round(value * 1000));
  return `${String(Math.floor(milliseconds / 60000)).padStart(2, "0")}:${String(Math.floor(milliseconds / 1000) % 60).padStart(2, "0")}.${String(milliseconds % 1000).padStart(3, "0")}`;
}
function expectedReviewDom(item) {
  const proposal = item.review.proposal;
  return {
    rows: proposal.candidates.map((candidate) => ({
      source: `${reviewTime(candidate.sourceInterval.start)}–${reviewTime(candidate.sourceInterval.end)}`,
      timeline: candidate.timelineIntervals.map(
        (range) => `${reviewTime(range.start)}–${reviewTime(range.end)}`,
      ),
      unmapped: candidate.timelineIntervals.length
        ? []
        : ["No matching primary timeline range"],
      selected: proposal.selectedCandidateIds.includes(candidate.id),
    })),
    // The saved proposal's merged selected ranges supply the exact declared removal total.
    summary: [
      String(proposal.selectedCandidateIds.length),
      reviewTime(
        proposal.timelineIntervals.reduce(
          (sum, range) => sum + range.end - range.start,
          0,
        ),
      ),
      reviewTime(proposal.totalDurationReduced),
    ],
  };
}
async function assertReviewDom(item) {
  const expected = expectedReviewDom(item);
  const read = () =>
    page.locator(".silence-review").evaluate((panel) => ({
      rows: Array.from(panel.querySelectorAll(".silence-candidate"), (row) => ({
        source: row
          .querySelector(".silence-candidate-time")
          ?.textContent?.trim(),
        timeline: Array.from(
          row.querySelectorAll(".silence-timecode"),
          (node) => node.textContent?.trim(),
        ),
        unmapped: Array.from(
          row.querySelectorAll(".silence-unmapped"),
          (node) => node.textContent?.trim(),
        ),
        selected: row.querySelector("input[type=checkbox]")?.checked,
      })),
      summary: Array.from(
        panel.querySelectorAll(".silence-summary strong"),
        (node) => node.textContent?.trim(),
      ),
    }));
  // Ordered arrays preserve all repeated source occurrences and speed-mapped ranges.
  await expect
    .poll(read, {
      timeout: 30000,
      message: `Visible Review must match ${item.name}'s exact saved mappings and summary`,
    })
    .toEqual(expected);
  return { reviewId: item.review.reviewId, ...(await read()) };
}
async function verify(item) {
  const { response: current } = await observeProjectIdentity();
  assert.equal(current.status, 200);
  assert.equal(current.value.project.id, item.project.id);
  assert.equal(current.value.path, item.sessionPath);
  assert.deepEqual(current.value.project.timelines, item.project.timelines);
  const state = await api(`/silence/jobs/${encodeURIComponent(item.jobId)}`);
  assert.equal(state.status, 200);
  assert.equal(state.value.job.status, "waiting-review");
  assert.equal(state.value.freshness, "current");
  const saved = await api(
    `/silence/jobs/${encodeURIComponent(item.jobId)}/review`,
  );
  assert.equal(saved.status, 200);
  assert.equal(saved.value.freshness, "current");
  assert.equal(saved.value.job.id, item.jobId);
  assert.deepEqual(saved.value.review, item.review);
  const sessionState = await verifySessionProject(item, "verify");
  return {
    name: item.name,
    projectId: item.project.id,
    jobId: item.jobId,
    reviewId: item.review.reviewId,
    baseRevision: item.review.proposal.baseRevision,
    freshness: saved.value.freshness,
    sessionState,
  };
}
async function verifySessionProject(item, phase) {
  const currentText = await readFile(
    join(item.sessionPath, "project.json"),
    "utf8",
  );
  const observation = {
    phase,
    name: item.name,
    projectId: item.project.id,
    observedAt: Date.now(),
    originalTextSha256: item.projectSha256,
    currentTextSha256: createHash("sha256").update(currentText).digest("hex"),
    status: "checking",
    protectedFileHashes: {},
  };
  report.sessionProjectStateChecks.push(observation);
  try {
    Object.assign(
      observation,
      assertSessionProjectState(
        item.projectText,
        currentText,
        item.project.id,
        report.projectCloseWindows,
      ),
    );
    assert.equal(observation.originalTextSha256, item.projectSha256);
    // Protect all original catalog/Review files; new audition cache files are separate.
    for (const [path, expected] of Object.entries(
      baseline.projects[item.originalPath],
    )) {
      if (path === "project.json") continue;
      const actual = await sha(join(item.sessionPath, path));
      observation.protectedFileHashes[path] = actual;
      assert.equal(actual, expected, `${item.name}: ${path}`);
    }
    observation.status = "passed";
    return observation;
  } catch (error) {
    observation.status = "failed";
    observation.failure = String(error);
    throw error;
  }
}
async function switchProject() {
  const { response: current } = await observeProjectIdentity();
  assert(
    cases.some(
      (item) =>
        item.project.id === current.value.project?.id &&
        item.sessionPath === current.value.path,
    ),
    "Switch must close an actual known session project",
  );
  await page
    .getByRole("button", { name: "Switch project", exact: true })
    .click();
  await expect(page.locator(".launcher-actions")).toBeVisible();
  const { response: closed } = await observeProjectIdentity();
  assert.equal(closed.value.project, null);
}
async function switchTo(item) {
  await switchProject();
  await openFilm(item);
  return openReview(item);
}
async function prepare(item, windowSeconds) {
  const region = auditionRegion();
  if (windowSeconds !== undefined)
    await region
      .getByLabel("Seam window (seconds each side)", { exact: true })
      .fill(String(windowSeconds));
  const responsePromise = observedWait(
    page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
          `/api/silence/jobs/${item.jobId}/audition` &&
        response.request().method() === "POST",
      { timeout: 120000 },
    ),
  );
  await region
    .getByRole("button", { name: "Render before / after", exact: true })
    .click();
  const response = await responsePromise;
  const result = await response.json();
  assert.equal(response.status(), 200, JSON.stringify(result));
  assert.equal(result.parity, "renderer");
  assert.equal(result.reviewId, item.review.reviewId);
  assert.equal(result.baseRevision, item.review.proposal.baseRevision);
  assert(result.seams.length > 0);
  for (const descriptor of [result.before, result.after]) {
    assert.equal(descriptor.sampleRate, 48000);
    assert.equal(descriptor.channels, 2);
    assert.equal(descriptor.format, "pcm_s24le");
  }
  await expect(
    region.getByRole("button", { name: "Play edited mix", exact: true }),
  ).toBeEnabled();
  return result;
}
async function retired(result) {
  const retired = [];
  for (const descriptor of [result.before, result.after]) {
    const response = await api(
      `/record-audio-preview/${encodeURIComponent(descriptor.id)}/pcm?startSample=0&count=1`,
    );
    assert.equal(response.status, 404);
    assert.equal(response.value.code, "request.notFound");
    retired.push({
      id: descriptor.id,
      status: response.status,
      code: response.value.code,
    });
  }
  return retired;
}
async function snapshotAudio(name) {
  const value = await page.evaluate(() => ({
    events: window.__openfilmAudioEvidence,
    contexts: window.__openfilmAudioContexts.map((item) => ({
      id: item.id,
      state: item.context.state,
      currentTime: item.context.currentTime,
      sampleRate: item.context.sampleRate,
    })),
  }));
  await writeFile(
    join(output, `${name}-audio.json`),
    JSON.stringify(value, null, 2) + "\n",
  );
  return value;
}

try {
  assert.equal(
    process.platform,
    "linux",
    "This driver claims Linux evidence only",
  );
  assert.equal(await git("rev-parse", "HEAD"), args["--head"]);
  assert.equal(
    await git("status", "--porcelain"),
    "",
    "Candidate must be clean, including untracked files",
  );
  report.driverSha256 = await sha(fileURLToPath(import.meta.url));
  report.stateGuardSha256 = await sha(
    join(
      dirname(fileURLToPath(import.meta.url)),
      "silence-real-browser-state.ts",
    ),
  );
  const receipt = await json(join(packet, "results.json"));
  assert.equal(
    receipt.candidate,
    args["--head"],
    "Packet was produced for another candidate",
  );
  assert.equal(
    receipt.status,
    "objective-contract-pass; manual-review-required",
  );
  report.packetResultsSha256 = await sha(join(packet, "results.json"));
  report.manualReviewWarnings = receipt.manualReviewWarnings; // Preserve the mixed 1,152-sample / 24-ms warning.
  report.packetQualityAcceptance = receipt.qualityAcceptance;
  assert.equal(receipt.fullyAcceptedQuality, false);
  baseline = { files: {}, projects: {} };
  for (const [name, pin] of Object.entries(pins)) {
    const path = join(sources, name);
    baseline.files[path] = await sha(path);
    assert.equal(baseline.files[path], pin);
  }
  for (const item of receipt.derived) {
    const path = join(packet, item.name);
    baseline.files[path] = await sha(path);
    assert.equal(baseline.files[path], item.sha256);
  }
  baseline.files[join(packet, "results.json")] = report.packetResultsSha256;
  await mkdir(join(output, "session"));
  cases = [];
  for (const name of ["natural", "mixed-reuse-speed"]) {
    const record = receipt.cases.find((item) => item.name === name);
    assert(record, `Missing ${name}`);
    const path = join(packet, `${name}-review.json`),
      saved = await json(path);
    baseline.files[path] = await sha(path);
    assert.equal(saved.jobId, record.jobId);
    assert.deepEqual(saved.review, record.review);
    const originalPath = join(packet, record.reviewProject);
    assert.equal(await realpath(originalPath), originalPath);
    assert.equal(dirname(originalPath), packet);
    baseline.projects[originalPath] = await tree(originalPath);
    const sessionPath = join(output, "session", `${name}-review.openfilm`);
    await cp(originalPath, sessionPath, {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    assert.deepEqual(await tree(sessionPath), baseline.projects[originalPath]);
    const projectText = await readFile(
      join(sessionPath, "project.json"),
      "utf8",
    );
    const project = JSON.parse(projectText);
    const composition = project.timelines.find(
      (item) => item.id === saved.review.proposal.compositionId,
    );
    assert(composition);
    const voiceClip = composition.tracks
      .flatMap((track) => track.clips)
      .find((clip) => clip.assetId === saved.review.proposal.assetId);
    assert(voiceClip);
    assert(saved.review.proposal.selectedCandidateIds.length > 0);
    assert.equal(
      saved.review.proposal.sourceHash,
      baseline.files[join(packet, "voice.wav")],
    );
    cases.push({
      name,
      ...saved,
      project,
      projectText,
      sessionPath,
      originalPath,
      voiceClipId: voiceClip.id,
      projectSha256: baseline.projects[originalPath]["project.json"],
    });
  }
  assert.notEqual(cases[0].review.reviewId, cases[1].review.reviewId);
  report.packetCases = cases.map((item) => ({
    name: item.name,
    originalPath: item.originalPath,
    sessionPath: item.sessionPath,
    projectId: item.project.id,
    jobId: item.jobId,
    reviewId: item.review.reviewId,
    sourceHash: item.review.proposal.sourceHash,
  }));
  await writeFile(
    join(output, "packet-baseline.json"),
    JSON.stringify(baseline, null, 2) + "\n",
  );
  await save();

  const requireFromRepo = createRequire(join(repo, "package.json"));
  const playwright = requireFromRepo("@playwright/test");
  expect = playwright.expect;
  const { createServer } = await import(
    pathToFileURL(requireFromRepo.resolve("vite")).href
  );
  const { startServer } = await import(
    pathToFileURL(join(repo, "apps/server/src/server.ts")).href
  );
  process.chdir(repo);
  runtime = await startServer({
    port: 0,
    projectRoot: join(output, "session"),
    userDataDirectory: join(output, "user-data"),
  });
  serverPort = runtime.port;
  serverOrigin = `http://127.0.0.1:${serverPort}`;
  assertRunning();
  // Passive observation: no render, provider, response, source, or job implementation is replaced.
  runtime.server.on("request", (request, response) => {
    const row = {
      method: request.method,
      url: request.url,
      receivedAt: Date.now(),
      receivedAtUtc: new Date().toISOString(),
      ended: false,
      finished: false,
      closed: false,
    };
    const projectClose =
      request.method === "POST" && request.url === "/api/project/close";
    if (projectClose)
      row.actualProjectIdentityAtReceipt = lastObservedProjectIdentity
        ? { ...lastObservedProjectIdentity }
        : null;
    report.serverRequests.push(row);
    request.once("end", () => {
      row.ended = true;
      row.bodyEndedAt = Date.now();
    });
    response.once("finish", () => {
      row.finished = true;
      row.finishedAt = Date.now();
      row.status = response.statusCode;
      if (projectClose && row.status === 200) {
        const identity = row.actualProjectIdentityAtReceipt;
        if (identity?.projectId)
          report.projectCloseWindows.push({
            projectId: identity.projectId,
            kind: "http-project-close",
            status: row.status,
            identityObservedAt: identity.observedAt,
            startedAt: row.receivedAt,
            finishedAt: row.finishedAt,
          });
        else
          fail(
            "project-close-identity",
            new Error(
              "Successful project close had no observed actual project identity",
            ),
          );
        lastObservedProjectIdentity = undefined;
      }
    });
    response.once("close", () => {
      row.closed = true;
      row.closedAt = Date.now();
      row.closedBeforeFinish = !response.writableEnded;
    });
    if (
      request.method === "POST" &&
      /^\/api\/silence\/jobs\/[^/]+\/audition$/u.test(request.url)
    )
      serverAuditions.push(row);
  });
  // Load the existing config with tsx; avoid Vite's bundled-config temp files in the checkout.
  const viteConfig = (
    await import(pathToFileURL(join(repo, "apps/desktop/vite.config.ts")).href)
  ).default;
  assert(viteConfig && typeof viteConfig === "object");
  vite = await createServer({
    ...viteConfig,
    root: join(repo, "apps/desktop"),
    configFile: false,
    cacheDir: join(output, "vite-cache"),
    server: {
      ...viteConfig.server,
      host: "127.0.0.1",
      // Existing trusted UI origin; an occupied strict port must fail without fallback.
      port: 1420,
      strictPort: true,
      proxy: { ...viteConfig.server.proxy, "/api": serverOrigin },
    },
    clearScreen: false,
  });
  assertRunning();
  await vite.listen();
  desktopPort = vite.httpServer.address().port;
  desktopOrigin = `http://127.0.0.1:${desktopPort}`;
  assertRunning();
  report.ports = { serverPort, desktopPort, serverOrigin, desktopOrigin };
  browser = await playwright.chromium.launch({
    headless: !args["--headed"],
    ...(args["--browser"] ? { executablePath: args["--browser"] } : {}),
  });
  assertRunning();
  report.browser = {
    version: browser.version(),
    headless: !args["--headed"],
    executablePath: args["--browser"] ?? "Playwright default",
  };
  context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    reducedMotion: "reduce",
  });
  await context.tracing.start({
    screenshots: true,
    snapshots: true,
    sources: true,
  });
  await context.addInitScript(() => {
    localStorage.setItem("openfilm.uiLocale", "en-US");
    const events = [],
      contexts = [],
      nodes = [],
      ids = new WeakMap();
    window.__openfilmAudioEvidence = events;
    window.__openfilmAudioContexts = contexts;
    function id(context) {
      if (!ids.has(context)) {
        const value = contexts.length + 1;
        ids.set(context, value);
        contexts.push({ id: value, context });
        context.addEventListener("statechange", () =>
          events.push({
            event: "statechange",
            id: value,
            at: performance.now(),
            state: context.state,
          }),
        );
      }
      return ids.get(context);
    }
    const originalCreate = AudioContext.prototype.createBufferSource;
    const originalClose = AudioContext.prototype.close;
    function observeBufferSource(node, context) {
      const contextId = id(context),
        nativeStart = node.start,
        nativeStop = node.stop;
      const observed = {
        nodeId: nodes.length + 1,
        contextId,
        node,
        context,
        started: false,
        ended: false,
        stopCalls: [],
      };
      nodes.push(observed);
      node.addEventListener("ended", () => {
        observed.ended = true;
        observed.endedAtContextTime = context.currentTime;
        events.push({
          event: "native-source-ended",
          id: contextId,
          nodeId: observed.nodeId,
          at: performance.now(),
          currentTime: context.currentTime,
        });
      });
      node.start = function (...args) {
        const buffer = this.buffer,
          beforeNativeCurrentTime = context.currentTime;
        const playbackRate = this.playbackRate.value,
          detune = this.detune.value,
          loop = this.loop;
        const result = Reflect.apply(nativeStart, this, args);
        const afterNativeCurrentTime = context.currentTime;
        const scheduledWhen = args[0] ?? 0,
          offsetSeconds = args[1] ?? 0,
          requestedDurationSeconds = args[2] ?? null;
        const availableBufferSeconds = buffer
          ? Math.max(0, buffer.duration - offsetSeconds)
          : 0;
        const bufferSliceSeconds =
          requestedDurationSeconds === null
            ? availableBufferSeconds
            : Math.min(availableBufferSeconds, requestedDurationSeconds);
        const effectivePlaybackRate = Math.abs(
          playbackRate * 2 ** (detune / 1200),
        );
        const effectiveDurationSeconds = effectivePlaybackRate
          ? bufferSliceSeconds / effectivePlaybackRate
          : null;
        // Conservatively bracket native start time if currentTime advanced during start().
        const effectiveStartEarliest = Math.max(
            scheduledWhen,
            beforeNativeCurrentTime,
          ),
          effectiveStartLatest = Math.max(
            scheduledWhen,
            afterNativeCurrentTime,
          );
        const metadata = {
          bufferLength: buffer?.length ?? null,
          bufferSampleRate: buffer?.sampleRate ?? null,
          bufferChannels: buffer?.numberOfChannels ?? null,
          bufferDurationSeconds: buffer?.duration ?? null,
          scheduledWhen,
          offsetSeconds,
          requestedDurationSeconds,
          playbackRate,
          detune,
          loop,
          effectivePlaybackRate,
          effectiveDurationSeconds,
          beforeNativeCurrentTime,
          afterNativeCurrentTime,
          effectiveStartEarliest,
          effectiveStartLatest,
          effectiveEndEarliest:
            effectiveDurationSeconds === null
              ? null
              : effectiveStartEarliest + effectiveDurationSeconds,
        };
        Object.assign(observed, metadata, { started: true });
        events.push({
          event: "native-source-start",
          id: contextId,
          nodeId: observed.nodeId,
          at: performance.now(),
          currentTime: context.currentTime,
          state: context.state,
          args,
          ...metadata,
        });
        return result;
      };
      node.stop = function (...args) {
        const beforeNativeCurrentTime = context.currentTime;
        const result = Reflect.apply(nativeStop, this, args);
        const value = {
          at: performance.now(),
          beforeNativeCurrentTime,
          afterNativeCurrentTime: context.currentTime,
          scheduledWhen: args[0] ?? 0,
        };
        observed.stopCalls.push(value);
        events.push({
          event: "native-source-stop",
          id: contextId,
          nodeId: observed.nodeId,
          ...value,
        });
        return result;
      };
      return node;
    }
    AudioContext.prototype.createBufferSource = function (...args) {
      return observeBufferSource(
        Reflect.apply(originalCreate, this, args),
        this,
      );
    };
    AudioContext.prototype.close = function (...args) {
      const contextId = id(this);
      const result = Reflect.apply(originalClose, this, args);
      events.push({
        event: "native-close-request",
        id: contextId,
        at: performance.now(),
        state: this.state,
      });
      result.then(
        () =>
          events.push({
            event: "native-close-resolved",
            id: contextId,
            at: performance.now(),
            state: this.state,
          }),
        (error) =>
          events.push({
            event: "native-close-rejected",
            id: contextId,
            at: performance.now(),
            message: String(error),
          }),
      );
      return result;
    };
    // Capture the trusted real click before Vue's existing handler runs; never cancel or alter it.
    document.addEventListener(
      "click",
      (event) => {
        const button =
          event.target instanceof Element
            ? event.target.closest("button")
            : null;
        if (
          !button?.matches('button.project-switch[aria-label="Switch project"]')
        )
          return;
        events.push({
          event: "switch-project-click",
          at: performance.now(),
          trusted: event.isTrusted,
          nodes: nodes.map((value) => {
            const { node, context, stopCalls, ...metadata } = value;
            return {
              ...metadata,
              stopCalls: stopCalls.map((item) => ({ ...item })),
              currentTimeAtClick: context.currentTime,
              contextStateAtClick: context.state,
              playbackRateAtClick: node.playbackRate.value,
              detuneAtClick: node.detune.value,
              loopAtClick: node.loop,
            };
          }),
        });
      },
      { capture: true },
    );
  });
  page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("request", (request) =>
    report.browserRequests.push({
      event: "request",
      method: request.method(),
      url: request.url(),
      at: Date.now(),
    }),
  );
  page.on("requestfailed", (request) =>
    report.browserRequests.push({
      event: "requestfailed",
      method: request.method(),
      url: request.url(),
      failure: request.failure(),
      at: Date.now(),
    }),
  );
  page.on("response", (response) => {
    if (!response.url().includes("/api/")) return;
    const task = (async () => {
      const row = {
        event: "response",
        method: response.request().method(),
        url: response.url(),
        status: response.status(),
        at: Date.now(),
      };
      const path = new URL(response.url()).pathname;
      if (
        path.endsWith("/audition") ||
        (path.endsWith("/review") && row.method === "GET")
      ) {
        try {
          row.body = await response.json();
        } catch (error) {
          row.bodyReadFailure = String(error);
        }
      }
      report.browserRequests.push(row);
    })();
    browserEventTasks.add(task);
    void task.then(
      () => browserEventTasks.delete(task),
      (error) => {
        fail("browser-response-observer", error);
        browserEventTasks.delete(task);
      },
    );
  });
  page.on("pageerror", (error) => {
    report.browserRequests.push({
      event: "pageerror",
      message: String(error),
      at: Date.now(),
    });
  });
  const [natural, mixed] = cases;
  await page.goto(desktopOrigin);
  await openFilm(natural);
  report.checks.push({
    check: "initial-review",
    ...(await openReview(natural)),
  });
  const reconnectResponse = observedWait(
    page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
          `/api/silence/jobs/${natural.jobId}/review` &&
        response.request().method() === "GET",
    ),
  );
  await page
    .getByRole("button", { name: "Reconnect to job", exact: true })
    .click();
  const reconnect = await reconnectResponse;
  assert.equal(reconnect.status(), 200);
  assert.deepEqual((await reconnect.json()).review, natural.review);
  report.checks.push({
    check: "reconnect-same-review",
    ...(await verify(natural)),
    visibleReview: await assertReviewDom(natural),
  });
  natural.uiEpoch = Date.now();
  await page.reload();
  report.checks.push({
    check: "reload-discovery-same-review",
    ...(await openReview(natural)),
  });
  await page.screenshot({
    path: join(output, "natural-reconnected.png"),
    fullPage: true,
    animations: "disabled",
  });

  const region = auditionRegion(),
    beforeCount = serverAuditions.length;
  const failedRequest = observedWait(
    page.waitForEvent("requestfailed", {
      predicate: (request) =>
        new URL(request.url()).pathname ===
          `/api/silence/jobs/${natural.jobId}/audition` &&
        request.method() === "POST",
      timeout: 30000,
    }),
  );
  await region
    .getByRole("button", { name: "Render before / after", exact: true })
    .click();
  const inflight = await until(
    () => serverAuditions[beforeCount]?.ended && serverAuditions[beforeCount],
    "actual audition request reached server with a complete body",
  );
  assert.equal(
    inflight.finished,
    false,
    "Audition completed before active-owner barrier; cancellation window NOT covered",
  );
  // The 409 is from the real existing API, while the real audition owns work.
  const barrier = await api("/project/close", "POST", {});
  assert.equal(
    barrier.status,
    409,
    "Active-owner close barrier was not observed; do not claim cancellation coverage",
  );
  assert.equal(
    inflight.finished,
    false,
    "Audition completed before UI Cancel; cancellation window NOT covered",
  );
  report.checks.push({
    check: "active-owner-409-before-cancel",
    response: barrier,
    auditionReceivedAt: inflight.receivedAt,
    assertedAt: Date.now(),
  });
  await region
    .getByRole("button", { name: "Cancel rendering", exact: true })
    .click();
  const cancelClickCompletedAt = Date.now();
  const aborted = await failedRequest;
  await until(
    () => inflight.closed && inflight.closedBeforeFinish,
    "real server response closed unfinished after browser abort",
  );
  await expect(
    region.getByRole("status").filter({ hasText: "Audition cancelled" }),
  ).toBeVisible();
  const prepareButton = region.getByRole("button", {
    name: "Render before / after",
    exact: true,
  });
  await expect(prepareButton).toBeFocused();
  await expect(
    region.getByRole("button", { name: "Play edited mix", exact: true }),
  ).toHaveCount(0);
  // A single declared settling window, then one retry; jobs.busy is a failure, not retried away.
  await page.waitForTimeout(1000);
  await expect(
    region.getByRole("button", { name: "Play edited mix", exact: true }),
  ).toHaveCount(0);
  report.cancellationPhase =
    "Real in-flight HTTP/source-verification cancellation; FFmpeg phase unobserved";
  report.checks.push({
    check: "real-http-cancel",
    phase: report.cancellationPhase,
    browserFailure: aborted.failure(),
    serverObservation: { ...inflight },
    cancelledUi: true,
    prepareFocusRestored: true,
    lateResultAbsentAfterMilliseconds: 1000,
    configuredPostCancelSettlingMilliseconds: 1000,
    immediateOwnerRelease: "NOT MEASURED",
  });
  const retryCallEnteredAt = Date.now(),
    retryServerIndex = serverAuditions.length;
  const firstRendered = await prepare(natural);
  const actualRetry = serverAuditions[retryServerIndex];
  assert(
    actualRetry &&
      actualRetry.url === `/api/silence/jobs/${natural.jobId}/audition`,
    "Require the actual retry request received by the server",
  );
  report.checks.push({
    check: "single-retry-same-durable-review-after-declared-delay",
    result: firstRendered,
    retryCallEnteredAt,
    retryHttpReceivedAt: actualRetry.receivedAt,
    cancelClickCompletedAt,
    retryHttpReceivedElapsedAfterCancelCompletedMilliseconds:
      actualRetry.receivedAt - cancelClickCompletedAt,
    immediateOwnerRelease: "NOT MEASURED",
    ...(await verify(natural)),
    visibleReview: await assertReviewDom(natural),
  });
  await page.screenshot({
    path: join(output, "natural-retry-prepared.png"),
    fullPage: true,
    animations: "disabled",
  });
  const preparedSwitch = await switchTo(mixed);
  await expect(
    auditionRegion().getByRole("button", {
      name: "Play edited mix",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(auditionRegion().getByText(/^Reviewed removal:/u)).toHaveCount(
    0,
  );
  report.checks.push({
    check: "prepared-switch-correct-second-review",
    ...preparedSwitch,
    retired: await retired(firstRendered),
    oldResultAbsent: true,
  });

  const secondRendered = await prepare(mixed, 3);
  assert.notEqual(secondRendered.before.id, firstRendered.before.id);
  assert.notEqual(secondRendered.after.id, firstRendered.after.id);
  const longestSeam = secondRendered.seams
    .map((seam, index) => ({
      index,
      samples: seam.afterEndSample - seam.afterStartSample,
    }))
    .sort((a, b) => b.samples - a.samples)[0];
  assert(
    longestSeam.samples >= 48000,
    "Need at least one second of real scheduled audio for the playing-switch observation",
  );
  const seamSelect = auditionRegion().locator("label > select");
  await expect(seamSelect).toHaveCount(1);
  assert.equal(
    await seamSelect.evaluate((select) =>
      Array.from(select.parentElement.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent)
        .join("")
        .trim(),
    ),
    "Timeline seam",
  );
  const expectedSeamOptions = secondRendered.seams.map((seam, index) => ({
    value: String(index),
    text: `${index + 1} · ${(seam.removedStartSample / 48000).toFixed(3)}–${(seam.removedEndSample / 48000).toFixed(3)} s`,
  }));
  const readSeamOptions = () =>
    seamSelect.locator("option").evaluateAll((options) =>
      options.map((option) => ({
        value: option.value,
        text: option.textContent.replace(/\s+/gu, " ").trim(),
      })),
    );
  assert.deepEqual(await readSeamOptions(), expectedSeamOptions);
  await seamSelect.selectOption(String(longestSeam.index));
  await expect(seamSelect).toHaveValue(String(longestSeam.index));
  assert.deepEqual(await readSeamOptions(), expectedSeamOptions);
  const pcmResponse = observedWait(
    page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname.includes(
          `/record-audio-preview/${secondRendered.after.id}/pcm`,
        ) && response.request().method() === "GET",
    ),
  );
  await auditionRegion()
    .getByRole("button", { name: "Play edited mix", exact: true })
    .click();
  const pcm = await pcmResponse;
  assert.equal(pcm.status(), 200);
  assert.equal(pcm.headers()["x-openfilm-pcm-sample-rate"], "48000");
  assert.equal(pcm.headers()["x-openfilm-pcm-channels"], "2");
  await until(
    () =>
      page.evaluate(() =>
        window.__openfilmAudioEvidence.findLast(
          (item) =>
            item.event === "native-source-start" && item.state === "running",
        ),
      ),
    "native Web Audio scheduled real PCM",
  );
  await expect(
    auditionRegion()
      .getByRole("status")
      .filter({ hasText: "Playing rendered audio" }),
  ).toBeVisible();
  const playing = await snapshotAudio("mixed-playing");
  const playingContext = playing.events.findLast(
    (item) => item.event === "native-source-start",
  ).id;
  assert.equal(
    playing.contexts.find((item) => item.id === playingContext).state,
    "running",
  );
  const returned = await switchTo(natural);
  await until(
    () =>
      page.evaluate(
        (id) =>
          window.__openfilmAudioContexts.find((item) => item.id === id)?.context
            .state === "closed",
        playingContext,
      ),
    "old native AudioContext actually closed after project switch",
  );
  const afterSwitch = await snapshotAudio("mixed-playing-switch-returned");
  const previousClickCount = playing.events.filter(
    (item) => item.event === "switch-project-click",
  ).length;
  const capturedClicks = afterSwitch.events.filter(
    (item) => item.event === "switch-project-click",
  );
  assert.equal(
    capturedClicks.length,
    previousClickCount + 1,
    "Exactly one real Switch project click must be captured",
  );
  const switchClick = capturedClicks.at(-1);
  assert.equal(
    switchClick.trusted,
    true,
    "Require the actual trusted UI click",
  );
  const overlappingNativeNodes = switchClick.nodes.filter(
    (node) =>
      node.contextId === playingContext &&
      node.contextStateAtClick === "running" &&
      node.started &&
      !node.ended &&
      node.stopCalls.length === 0 &&
      node.bufferLength > 0 &&
      node.bufferSampleRate === 48000 &&
      node.bufferChannels === 2 &&
      node.playbackRate === 1 &&
      node.playbackRateAtClick === 1 &&
      node.detune === 0 &&
      node.detuneAtClick === 0 &&
      !node.loop &&
      !node.loopAtClick &&
      node.currentTimeAtClick >= node.effectiveStartLatest &&
      node.currentTimeAtClick < node.effectiveEndEarliest,
  );
  assert(
    overlappingNativeNodes.length > 0,
    "No unended, unstopped native buffer overlapped the actual Switch click; playing-switch NOT covered",
  );
  const closure = afterSwitch.events.find(
    (item) =>
      item.id === playingContext && item.event === "native-close-resolved",
  );
  assert(closure);
  assert(
    switchClick.at < closure.at,
    "Switch click must precede actual context close",
  );
  assert(
    !afterSwitch.events.some(
      (item) =>
        item.id === playingContext &&
        item.event === "native-source-start" &&
        item.at > closure.at,
    ),
  );
  await expect(
    auditionRegion().getByRole("button", {
      name: "Play edited mix",
      exact: true,
    }),
  ).toHaveCount(0);
  report.checks.push({
    check: "playing-switch-native-buffer-overlaps-click-and-context-closes",
    scheduledContext: playingContext,
    switchClick,
    overlappingNativeNodes,
    closure,
    returned,
    retired: await retired(secondRendered),
    realPcmHttpStatus: pcm.status(),
    physicalListening: false,
    lateStartsAfterClose: 0,
  });
  await page.screenshot({
    path: join(output, "returned-natural-unprepared.png"),
    fullPage: true,
    animations: "disabled",
  });
  report.checks.push({
    check: "second-review-remains-immutable-after-playing",
    ...(await switchTo(mixed)),
  });
  await switchProject();
  const forbidden = report.serverRequests.filter(
    (row) =>
      row.method === "POST" &&
      (/^\/api\/silence\/jobs\/?$/u.test(row.url) ||
        /^\/api\/silence\/jobs\/[^/]+\/(review|apply|retry|recover|cancel)$/u.test(
          row.url,
        )),
  );
  assert.deepEqual(
    forbidden,
    [],
    "Browser must not analyze, revise, accept, apply, or recover jobs",
  );
  assert.equal(await git("rev-parse", "HEAD"), args["--head"]);
  assert.equal(await git("status", "--porcelain"), "");
  report.status =
    "OBJECTIVE BROWSER CHECKS PASSED; MANUAL QUALITY GATES REMAIN";
} catch (error) {
  fail("validation", error);
  report.status = "FAILED";
  if (page && !page.isClosed())
    await cleanup("failure-screenshot", () =>
      page.screenshot({
        path: join(output, "failure.png"),
        fullPage: true,
        animations: "disabled",
      }),
    );
} finally {
  if (context)
    await cleanup("trace-preserved", () =>
      context.tracing.stop({ path: join(output, "trace.zip") }),
    );
  if (browser) await cleanup("owned-browser-closed", () => browser.close());
  if (browserEventTasks.size)
    await cleanup("browser-events-drained", () =>
      Promise.allSettled([...browserEventTasks]),
    );
  if (vite) await cleanup("owned-vite-closed", () => vite.close());
  if (runtime) {
    let actualIdentity;
    await cleanup("actual-project-before-server-close", async () => {
      actualIdentity = (await observeProjectIdentity()).identity;
    });
    await cleanup("owned-openfilm-server-closed", async () => {
      const startedAt = Date.now();
      await runtime.close();
      const finishedAt = Date.now();
      if (actualIdentity?.projectId)
        report.projectCloseWindows.push({
          projectId: actualIdentity.projectId,
          kind: "owned-server-close",
          status: "closed",
          identityObservedAt: actualIdentity.observedAt,
          startedAt,
          finishedAt,
        });
    });
  }
  if (serverPort)
    await cleanup("owned-api-port-closed", async () =>
      assert(await portClosed(serverPort)),
    );
  if (desktopPort)
    await cleanup("owned-desktop-port-closed", async () =>
      assert(await portClosed(desktopPort)),
    );
  if (baseline)
    await cleanup("original-packet-and-source-bytes-unchanged", async () => {
      for (const [path, expected] of Object.entries(baseline.files))
        assert.equal(await sha(path), expected, path);
      for (const [path, expected] of Object.entries(baseline.projects))
        assert.deepEqual(await tree(path), expected, path);
    });
  if (cases)
    for (const item of cases)
      await cleanup(
        `session-project-state-and-durable-bytes:${item.name}`,
        () => verifySessionProject(item, "finally"),
      );
  if (report.failures.length) report.status = "FAILED";
  report.finishedAt = new Date().toISOString();
  await save();
  process.removeListener("SIGINT", onInt);
  process.removeListener("SIGTERM", onTerm);
}
console.log(
  JSON.stringify({
    status: report.status,
    output,
    failures: report.failures.length,
  }),
);
if (report.failures.length) process.exitCode = 1;
