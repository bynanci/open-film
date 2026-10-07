import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { transform } from "esbuild";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PROVIDER_DATA_KINDS } from "@openfilm/plugin-sdk";
import { ApiError, type ReviewProviderState } from "../../apps/desktop/src/api";
import { loadReviewRecovery } from "../../apps/desktop/src/reviewRecovery";
import en from "../../apps/desktop/src/i18n/modules/transcript/en-US";
import zh from "../../apps/desktop/src/i18n/modules/transcript/zh-TW";
import ja from "../../apps/desktop/src/i18n/modules/transcript/ja-JP";

// Compile the actual component setup and template with the installed Vue SSR
// renderer; this checks disclosure content and the event's snapshot together.
const requireDesktop = createRequire(
  new URL("../../apps/desktop/package.json", import.meta.url),
);
const vue = requireDesktop("vue") as Record<string, unknown> & {
  createSSRApp: (component: unknown) => unknown;
  effectScope: () => {
    run: <T>(callback: () => T) => T | undefined;
    stop: () => void;
  };
};
const { parse, compileScript, compileTemplate } = requireDesktop(
  "vue/compiler-sfc",
) as {
  parse: (source: string) => {
    descriptor: {
      template: { content: string };
      scriptSetup: { content: string };
    };
  };
  compileScript: (
    descriptor: unknown,
    options: object,
  ) => {
    bindings: Record<string, string>;
  };
  compileTemplate: (options: object) => { code: string; errors: unknown[] };
};
const { renderToString } = requireDesktop("vue/server-renderer") as {
  renderToString: (app: unknown) => Promise<string>;
};
const { createI18n } = requireDesktop("vue-i18n") as {
  createI18n: (options: object) => {
    global: { t: (key: string, ...args: unknown[]) => string };
  };
};
type Panel = {
  provider: { value: ReviewProviderState };
  refresh: () => Promise<void>;
  consent: (allow: boolean) => Promise<void>;
};
let factory: (dependencies: Record<string, unknown>) => Panel;
let render: unknown;
const cleanup: (() => void)[] = [];
beforeAll(async () => {
  const source = await readFile(
    new URL(
      "../../apps/desktop/src/components/ReviewPanel.vue",
      import.meta.url,
    ),
    "utf8",
  );
  const { descriptor } = parse(source);
  const bindings = compileScript(descriptor, { id: "consent" }).bindings;
  const setup = (
    await transform(descriptor.scriptSetup.content, {
      loader: "ts",
      format: "esm",
    })
  ).code.replace(/^import[\s\S]*?from\s+"[^"]+";\n/gm, "");
  const exposed = Object.keys(bindings).filter(
    (key) => bindings[key] !== "props",
  );
  factory = (dependencies) =>
    new Function(
      "dependencies",
      `const {${Object.keys(dependencies).join(",")}}=dependencies;\n${setup}\nreturn {${exposed.join(",")}};`,
    )(dependencies);
  const compiled = compileTemplate({
    source: descriptor.template.content,
    filename: "ReviewPanel.vue",
    id: "consent",
    compilerOptions: { bindingMetadata: bindings },
  });
  expect(compiled.errors).toEqual([]);
  const code = (
    await transform(compiled.code, { loader: "ts", format: "esm" })
  ).code
    .replace(
      /import \{([^}]+)\} from "vue"/gu,
      (_match: string, names: string) =>
        `const {${names
          .split(",")
          .map((name) => name.trim().replace(/\s+as\s+/u, ":"))
          .join(",")}}=Vue;`,
    )
    .replace("export function render", "function render")
    .replace(/\nexport\s*\{[\s\S]*?\};\s*$/, "");
  render = new Function("Vue", `${code};return render;`)(vue);
});
afterEach(() => {
  for (const callback of cleanup.splice(0).reverse()) callback();
  vi.unstubAllGlobals();
});

describe("remote review consent disclosure", () => {
  it.each([
    ["en-US", en],
    ["zh-TW", zh],
    ["ja-JP", ja],
  ] as const)(
    "shows every declared kind before consent in %s",
    async (locale, messages) => {
      const descriptor = {
        id: "extra-kind-remote",
        name: "Explicitly configured fixture",
        execution: "remote",
        endpoint: "https://review.invalid/explicit-destination",
        dataKinds: [...PROVIDER_DATA_KINDS],
      };
      let available = false;
      const api = {
        reviewSuggestions: vi.fn(async () => ({
          suggestions: [],
          total: 0,
          offset: 0,
          limit: 100,
        })),
        reviewProvider: vi.fn(async () => ({
          configured: true,
          available,
          provider: structuredClone(descriptor),
        })),
        reviewConsent: vi.fn(async (allow: boolean) => {
          available = allow;
          return api.reviewProvider();
        }),
        runReview: vi.fn(),
      };
      const i18n = createI18n({
        legacy: false,
        locale,
        messages: { [locale]: messages },
      });
      vi.stubGlobal("localStorage", { getItem: () => null });
      const scope = vue.effectScope();
      cleanup.push(() => scope.stop());
      const panel = scope.run(() =>
        factory({
          ...vue,
          onBeforeUnmount: () => {},
          onMounted: () => {},
          useI18n: () => ({ t: i18n.global.t }),
          api,
          ApiError,
          loadReviewRecovery,
          post: vi.fn(),
          errorDetail: String,
          localizeError: String,
          formatNumber: (value: number) =>
            new Intl.NumberFormat(locale).format(value),
          defineProps: () => ({
            projectId: "project",
            assetId: "asset",
            jobs: [],
            flush: async () => true,
          }),
          defineEmits: () => () => {},
          defineExpose: () => {},
        }),
      )!;
      await panel.refresh();
      const html = await renderToString(
        vue.createSSRApp({ setup: () => panel, render }),
      );
      expect(html).toContain(descriptor.endpoint);
      expect(html).toContain(messages.transcript.providerDataKinds);
      for (const kind of PROVIDER_DATA_KINDS)
        expect(html).toContain(
          `<li>${messages.transcript.dataKinds[kind]}</li>`,
        );
      expect(html).toContain(messages.transcript.reviewDataAccess);
      expect(html).toContain(messages.transcript.grantConsent);
      expect(api.reviewConsent).not.toHaveBeenCalled();
      expect(api.runReview).not.toHaveBeenCalled();
      const displayed = panel.provider.value.provider;
      await panel.consent(true);
      expect(api.reviewConsent).toHaveBeenCalledWith(true, displayed);
      expect(panel.provider.value.available).toBe(true);
      await panel.consent(false);
      expect(api.reviewConsent).toHaveBeenLastCalledWith(
        false,
        panel.provider.value.provider,
      );
      expect(panel.provider.value.available).toBe(false);
      expect(api.runReview).not.toHaveBeenCalled();
    },
  );
});
