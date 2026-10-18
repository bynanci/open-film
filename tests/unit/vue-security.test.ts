// SPDX-License-Identifier: GPL-3.0-only
import { afterEach, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const { ssrRenderAttrs } = createRequire(resolve("apps/desktop/package.json"))(
  "vue/server-renderer",
) as { ssrRenderAttrs: (props: Record<string, unknown>) => string };

afterEach(() => vi.restoreAllMocks());

// Dependency regression for GHSA-g2v6-rqmx-r4w6. The current Desktop is CSR;
// this tests the installed helper, not a claim that OpenFilm exposes SSR.
it("rejects carriage returns in dynamic SSR attribute names", () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  expect(ssrRenderAttrs({ ["data-label\ronfocus"]: "inert-sentinel" })).toBe(
    "",
  );
});

it("still escapes ordinary dynamic attribute values", () => {
  expect(ssrRenderAttrs({ "data-label": '<safe> & "quoted"' })).toBe(
    ' data-label="&lt;safe&gt; &amp; &quot;quoted&quot;"',
  );
});
