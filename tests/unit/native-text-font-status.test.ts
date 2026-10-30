// SPDX-License-Identifier: Apache-2.0
import { existsSync } from "node:fs";
import { expect, it } from "vitest";
import {
  flatten,
  loadComponent,
  mountComponent,
  vue,
} from "./helpers/vue-sfc-host";
it("shows actual per-run font evidence and drops a stale inspection owner", async () => {
  const path = "apps/desktop/src/components/NativeTextFontStatus.vue";
  expect(existsSync(path)).toBe(true);
  const pending: Array<(value: unknown) => void> = [];
  const props = vue.reactive({
    projectId: "one",
    compositionId: "film",
    revision: "r1",
    reference: { kind: "title", clipId: "title" },
    active: true,
  });
  const component = loadComponent(path, {
    "vue-i18n": {
      useI18n: () => ({
        t: (key: string, params?: Record<string, unknown>) =>
          `${key} ${JSON.stringify(params ?? {})}`,
      }),
    },
    "../api": {
      nativeTextInspection: () =>
        new Promise((resolve) => pending.push(resolve)),
    },
  });
  const mounted = mountComponent(component, props);
  try {
    props.projectId = "two";
    await vue.nextTick();
    pending[0]!({
      status: "measured",
      runFonts: [
        {
          id: "primary",
          font: { family: "STALE" },
          actualWeight: 400,
          diagnostics: [],
        },
      ],
    });
    await Promise.resolve();
    await vue.nextTick();
    expect(
      flatten(mounted.root)
        .map((node) => node.text)
        .join(" "),
    ).not.toContain("STALE");
    pending[1]!({
      status: "measured",
      runFonts: [
        {
          id: "secondary",
          font: { family: "Actual Local Family" },
          actualWeight: 700,
          diagnostics: [{ code: "family-fallback" }],
        },
      ],
    });
    await Promise.resolve();
    await vue.nextTick();
    expect(
      flatten(mounted.root)
        .map((node) => node.text)
        .join(" "),
    ).toContain("Actual Local Family");
  } finally {
    mounted.unmount();
  }
});
