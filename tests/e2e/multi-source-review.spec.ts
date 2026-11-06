import { join } from "node:path";
import {
  expect,
  request as playwrightRequest,
  test,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import {
  OpenFilmApplication,
  type SourceAnalysisRunRecord,
} from "@openfilm/application";
import type { OpenFilmProject, ProjectContentLocale } from "@openfilm/core";
import { createDesktopFixture } from "./helpers.js";
import { initialLocale, navigate, openFilm, uiText } from "./ui-helpers.js";

const api = "http://127.0.0.1:4310/api";
const cleanup: Array<() => Promise<void>> = [];
test.use({ viewport: { width: 1280, height: 800 }, actionTimeout: 15_000 });
test.beforeEach(async ({ request }) => {
  await request.post(`${api}/project/close`, { data: {} });
});
test.afterEach(async ({ request }) => {
  await request.post(`${api}/project/close`, { data: {} });
  for (const action of cleanup.splice(0)) await action();
});

async function savedProject(
  request: APIRequestContext,
): Promise<OpenFilmProject> {
  const response = await request.get(`${api}/project`);
  expect(response.ok()).toBe(true);
  return (await response.json()).project;
}

async function readJsonAfterTransientReset(
  request: APIRequestContext,
  url: string,
) {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await request.get(url);
      expect(
        response.ok(),
        `${response.status()} ${response.statusText()}`,
      ).toBe(true);
      return await response.json();
    } catch (error) {
      // The lost-response recovery test intentionally resets a browser socket.
      // On Windows the local server may also reset this idempotent verification
      // GET while the reloaded page is reconnecting. Retry only that transport
      // failure; HTTP errors and all other failures remain visible.
      if (
        attempt >= 2 ||
        !(error instanceof Error) ||
        !error.message.includes("ECONNRESET")
      )
        throw error;
      await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
    }
  }
}

async function prepareReview(page: Page, locale: ProjectContentLocale) {
  const fixture = await createDesktopFixture(0);
  cleanup.push(fixture.cleanup);
  const files = [
    join(fixture.media, "01-photo.png"),
    join(fixture.media, "04-motion.mp4"),
  ];
  const app = await OpenFilmApplication.create(
    fixture.project,
    "Synthetic source review",
    { projectContentLocale: locale },
  );
  try {
    const imported = await app.importFiles(files);
    expect(imported.job.errors).toEqual([]);
    expect(imported.imported).toBe(2);
    const story = app.generateStory({
      title: "Reviewed story 合成故事",
      template: "blank",
      assetIds: app.catalog.listAssets().map(({ id }) => id),
    });
    story.beats = [
      {
        id: "baseline-beat",
        title: "Synthetic baseline",
        candidateAssetIds: app.catalog.listAssets().map(({ id }) => id),
        selectedAssetIds: [app.catalog.listAssets()[0]!.id],
        targetDuration: 2,
        minDuration: 1,
        maxDuration: 3,
      },
    ];
    story.targetDuration = 2;
    story.maxDuration = 3;
    story.graph = undefined;
    app.compose(story.id);
    await app.save();
  } finally {
    app.close();
  }
  await initialLocale(page, locale);
  await page.goto("/");
  await openFilm(page, fixture.project, locale);
  await page
    .getByRole("main")
    .getByRole("button", {
      name: uiText(locale, "app.library.add"),
      exact: true,
    })
    .click();
  const panel = page.getByRole("region", {
    name: uiText(locale, "app.import.label"),
    exact: true,
  });
  const sourcesAdded = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/import-draft/sources") &&
      response.request().method() === "POST",
  );
  await panel
    .getByLabel(uiText(locale, "app.import.addFiles"), { exact: true })
    .setInputFiles(files);
  const sourceResponse = await sourcesAdded;
  expect(sourceResponse.ok(), await sourceResponse.text()).toBe(true);
  const { draft } = await sourceResponse.json();
  expect(draft.selections).toHaveLength(2);
  await expect(panel.locator(".import-source-card")).toHaveCount(2, {
    timeout: 15_000,
  });
  await panel
    .getByRole("button", {
      name: uiText(locale, "app.import.scan.action"),
      exact: true,
    })
    .click();
  const seal = panel.getByRole("button", {
    name: uiText(locale, "app.import.seal.action"),
    exact: true,
  });
  await expect(seal).toBeEnabled();
  await seal.click();
  await expect(panel.locator(".import-seal-result")).toBeVisible();
  await panel
    .getByLabel(uiText(locale, "app.import.analysis.visual.enable"), {
      exact: true,
    })
    .check();
  const analyzed = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/analysis-runs") &&
      response.request().method() === "POST",
  );
  await panel
    .getByRole("button", {
      name: uiText(locale, "app.import.analysis.run"),
      exact: true,
    })
    .click();
  const response = await analyzed;
  expect(response.ok(), await response.text()).toBe(true);
  const record: SourceAnalysisRunRecord = (await response.json()).result;
  expect(record.run.status).toBe("completed");
  await expect(
    page.locator(".activity-strip .job-summary strong").filter({
      hasText: uiText(locale, "app.import.analysis.status.completed"),
    }),
  ).toBeVisible();
  const samples = record.results.flatMap(({ evidence }) =>
    evidence.type === "visual-sample" ? [evidence] : [],
  );
  expect(samples.length).toBe(4);
  expect(
    samples.every(
      (sample) =>
        sample.frameHash?.length === 64 &&
        sample.status === "unknown" &&
        sample.reason === "provider-not-configured",
    ),
  ).toBe(true);
  expect(
    samples
      .map(({ sourceTimeRange }) => sourceTimeRange.start)
      .filter((time) => time > 0),
  ).toHaveLength(3);
  await expect(panel.locator(".import-review-result")).toHaveCount(
    record.results.length,
  );
  return { panel, record, fixture };
}

for (const locale of ["en-US", "zh-TW", "ja-JP"] as const) {
  test(`${locale}: changing a correction invalidates its preview and accepted story adoption refreshes the workspace`, async ({
    page,
    request,
  }) => {
    const { panel, record, fixture } = await prepareReview(page, locale);
    const observation = record.results.find(
      ({ kind }) => kind === "observation",
    )!;
    await panel
      .locator(`.import-review-result input[value="${observation.id}"]`)
      .check();
    await panel
      .getByRole("combobox", {
        name: uiText(locale, "app.import.analysis.review.operation"),
        exact: true,
      })
      .selectOption("correct");
    const correction = panel.getByLabel(
      uiText(locale, "app.import.analysis.review.correction"),
      { exact: true },
    );
    await correction.fill("人工確認：合成測試畫面");
    const preview = panel.getByRole("button", {
      name: uiText(locale, "app.import.analysis.review.preview"),
      exact: true,
    });
    await preview.click();
    const accept = panel.getByRole("button", {
      name: uiText(locale, "app.import.analysis.review.accept"),
      exact: true,
    });
    await expect(accept).toBeVisible();
    await correction.fill("修正後的合成場景描述");
    await expect(accept).toHaveCount(0);
    await preview.click();
    await accept.click();
    await expect(
      panel.getByRole("button", {
        name: uiText(locale, "app.import.analysis.review.retryAccept"),
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      panel
        .locator(".import-review-result")
        .filter({ hasText: "修正後的合成場景描述" }),
    ).toHaveCount(1);
    const before = await savedProject(request);
    const story = before.stories[0]!;
    await panel
      .getByRole("combobox", {
        name: uiText(locale, "app.import.analysis.review.operation"),
        exact: true,
      })
      .selectOption("adopt");
    await panel
      .locator(`.import-review-result input[value="${observation.id}"]`)
      .check();
    const event = record.results.find(({ kind }) => kind === "event")!;
    await panel
      .locator(`.import-review-result input[value="${event.id}"]`)
      .check();
    await panel
      .getByRole("combobox", {
        name: uiText(locale, "app.import.analysis.review.operation"),
        exact: true,
      })
      .selectOption("adopt");
    await panel
      .getByRole("combobox", {
        name: uiText(locale, "app.import.analysis.review.story"),
        exact: true,
      })
      .selectOption(story.id);
    await preview.click();
    await accept.click();
    await expect(
      panel.getByRole("button", {
        name: uiText(locale, "app.import.analysis.review.retryAccept"),
        exact: true,
      }),
    ).toHaveCount(0);
    const updated = await savedProject(request);
    expect(updated.stories[0]!.beats).toHaveLength(story.beats.length + 1);
    const adoptedBeat = updated.stories[0]!.beats.at(-1)!;
    expect(adoptedBeat.intent).toBe("修正後的合成場景描述");
    await panel
      .getByRole("button", {
        name: uiText(locale, "app.import.close"),
        exact: true,
      })
      .click();
    await navigate(page, "story", locale);
    await page.getByTestId("perspective-tab-storyboard").click();
    await expect(
      page.getByTestId(`storyboard-card-${adoptedBeat.id}`),
    ).toBeVisible();
    expect(await fixture.assertOriginalsUnchanged()).toBe(true);
  });
}

test("split review derives both ranges from the real video duration", async ({
  page,
  request,
}) => {
  const { panel, record } = await prepareReview(page, "en-US");
  const { assets } = await (
    await request.get(`${api}/assets?limit=100`)
  ).json();
  const video = assets.find(
    (asset: { id: string; mediaType: string }) =>
      asset.mediaType === "video" &&
      record.results.some(
        ({ evidence }) =>
          evidence.type === "visual-sample" && evidence.assetId === asset.id,
      ),
  );
  const result = record.results.find(
    ({ evidence }) =>
      evidence.type === "visual-sample" && evidence.assetId === video.id,
  )!;
  await panel
    .locator(`.import-review-result input[value="${result.id}"]`)
    .check();
  await panel
    .getByRole("combobox", {
      name: uiText("en-US", "app.import.analysis.review.operation"),
      exact: true,
    })
    .selectOption("split");
  await panel
    .getByRole("spinbutton", {
      name: uiText("en-US", "app.import.analysis.review.splitBoundary"),
      exact: true,
    })
    .fill(String(video.duration / 2));
  const response = page.waitForResponse((response) =>
    response
      .url()
      .endsWith(
        `/analysis-runs/${encodeURIComponent(record.run.id)}/review/preview`,
      ),
  );
  await panel
    .getByRole("button", {
      name: uiText("en-US", "app.import.analysis.review.preview"),
      exact: true,
    })
    .click();
  const { preview } = await (await response).json();
  expect(preview.operation.ranges).toEqual([
    { assetId: video.id, start: 0, end: video.duration / 2 },
    { assetId: video.id, start: video.duration / 2, end: video.duration },
  ]);
  const before = await savedProject(request);
  await panel
    .getByRole("button", {
      name: uiText("en-US", "app.import.analysis.review.accept"),
      exact: true,
    })
    .click();
  await expect(
    panel.getByRole("button", {
      name: uiText("en-US", "app.import.analysis.review.retryAccept"),
      exact: true,
    }),
  ).toHaveCount(0);
  const review = await readJsonAfterTransientReset(
    request,
    `${api}/analysis-runs/${encodeURIComponent(record.run.id)}/review`,
  );
  expect(
    review.result.items.find((item: { id: string }) => item.id === result.id)
      .review.sourceRanges,
  ).toEqual(preview.operation.ranges);
  expect(before.timelines.length).toBe(1);
  expect((await savedProject(request)).timelines).toEqual(before.timelines);
});

test("a committed review with a lost response recovers after reload using one receipt", async ({
  page,
}) => {
  const locale = "zh-TW";
  const { panel, record, fixture } = await prepareReview(page, locale);
  const event = record.results.find(({ kind }) => kind === "event")!;
  await panel
    .locator(`.import-review-result input[value="${event.id}"]`)
    .check();
  await panel
    .getByRole("button", {
      name: uiText(locale, "app.import.analysis.review.preview"),
      exact: true,
    })
    .click();
  let originalPayload: unknown;
  let acceptedId: string | undefined;
  const endpoint = `/api/analysis-runs/${encodeURIComponent(record.run.id)}/review/accept`;
  await page.route(
    `**${endpoint}`,
    async (route) => {
      originalPayload = route.request().postDataJSON();
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      acceptedId = (await response.json()).decision.id;
      await route.abort("connectionreset");
    },
    { times: 1 },
  );
  await panel
    .getByRole("button", {
      name: uiText(locale, "app.import.analysis.review.accept"),
      exact: true,
    })
    .click();
  await expect(
    panel.getByRole("button", {
      name: uiText(locale, "app.import.analysis.review.retryAccept"),
      exact: true,
    }),
  ).toBeEnabled();
  await expect(
    panel.getByRole("combobox", {
      name: uiText(locale, "app.import.analysis.review.operation"),
      exact: true,
    }),
  ).toBeDisabled();
  await page.reload();
  await page
    .getByRole("main")
    .getByRole("button", {
      name: uiText(locale, "app.library.add"),
      exact: true,
    })
    .click();
  const retry = page.getByRole("button", {
    name: uiText(locale, "app.import.analysis.review.retryAccept"),
    exact: true,
  });
  await expect(retry).toBeVisible();
  await page.setViewportSize({ width: 375, height: 720 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 2,
    ),
  ).toBe(true);
  const requestRetried = page.waitForRequest(
    (req) => req.url().endsWith(endpoint) && req.method() === "POST",
  );
  await retry.focus();
  await retry.press("Enter");
  expect((await requestRetried).postDataJSON()).toEqual(originalPayload);
  await expect(retry).toHaveCount(0);
  const verification = await playwrightRequest.newContext();
  let review: { decisions: { id: string; outcome: string }[] };
  try {
    const response = await verification.get(
      `${api}/analysis-runs/${encodeURIComponent(record.run.id)}/review`,
    );
    expect(response.ok()).toBe(true);
    review = await response.json();
  } finally {
    await verification.dispose();
  }
  expect(review.decisions).toHaveLength(1);
  expect(review.decisions[0]).toMatchObject({
    id: acceptedId,
    outcome: "applied",
  });
  expect(await fixture.assertOriginalsUnchanged()).toBe(true);
});

test("search keeps the latest results, clears reviewed selection and exposes a usable empty state", async ({
  page,
}) => {
  const { panel, record } = await prepareReview(page, "en-US");
  const event = record.results.find(({ kind }) => kind === "event")!;
  await panel
    .locator(`.import-review-result input[value="${event.id}"]`)
    .check();
  await panel
    .getByRole("button", {
      name: uiText("en-US", "app.import.analysis.review.preview"),
      exact: true,
    })
    .click();
  const accept = panel.getByRole("button", {
    name: uiText("en-US", "app.import.analysis.review.accept"),
    exact: true,
  });
  await expect(accept).toBeVisible();
  let release!: () => void;
  let started!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const intercepted = new Promise<void>((resolve) => {
    started = resolve;
  });
  const endpoint = `/api/analysis-runs/${encodeURIComponent(record.run.id)}/review`;
  await page.route(`**${endpoint}?*`, async (route) => {
    const response = await route.fetch();
    if (
      new URL(route.request().url()).searchParams.get("query") === "unknown"
    ) {
      started();
      await held;
    }
    await route.fulfill({ response });
  });
  try {
    const search = panel.getByRole("searchbox", {
      name: uiText("en-US", "app.import.analysis.review.search"),
      exact: true,
    });
    await search.fill("unknown");
    await expect(accept).toHaveCount(0);
    await intercepted;
    await search.fill("event");
    const eventCount = record.results.filter(
      ({ kind }) => kind === "event",
    ).length;
    await expect(panel.locator(".import-review-result")).toHaveCount(
      eventCount,
    );
    release();
    await expect(
      panel.locator(`.import-review-result input[value="${event.id}"]`),
    ).toBeVisible();
    await expect(panel.locator(".import-review-result")).toHaveCount(
      eventCount,
    );
    await search.fill("zz-no-matching-synthetic-result");
    await expect(
      panel.getByText(uiText("en-US", "app.import.analysis.review.noResults"), {
        exact: true,
      }),
    ).toBeVisible();
    await expect(panel.locator(".import-review-pagination")).toContainText(
      "0–0 / 0",
    );
    await expect(panel.locator(".import-review-pagination button")).toHaveCount(
      2,
    );
    for (const button of await panel
      .locator(".import-review-pagination button")
      .all())
      await expect(button).toBeDisabled();
  } finally {
    release();
  }
});
