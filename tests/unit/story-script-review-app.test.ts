import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { transformSync } from "esbuild";
import { describe, expect, it, vi } from "vitest";

const requireDesktop = createRequire(resolve("apps/desktop/package.json"));
const vue = requireDesktop("vue");
const { parse, compileTemplate } = requireDesktop("vue/compiler-sfc");
type VNode = {
  type: unknown;
  props?: Record<string, unknown>;
  children?: unknown;
};
function nodes(value: unknown): VNode[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object" || !("type" in value)) return [];
  const node = value as VNode;
  return [node, ...nodes(node.children)];
}
function source() {
  return readFileSync(resolve("apps/desktop/src/App.vue"), "utf8");
}
function renderReview(storyId = "story", beatId = "beat") {
  const template = parse(source()).descriptor.template.content as string;
  const start = template.indexOf('<div class="beat-script-fields">');
  const end = template.indexOf('<div class="candidate-heading">', start);
  const compiled = compileTemplate({
    source: template.slice(start, end),
    id: "script-review",
  });
  expect(compiled.errors).toEqual([]);
  const module = {
    exports: {} as { render: (context: object, cache: object[]) => VNode },
  };
  new Function(
    "require",
    "module",
    "exports",
    transformSync(compiled.code, { format: "cjs" }).code,
  )(
    () => ({
      ...vue,
      resolveComponent: (name: string) => name,
      withDirectives: (value: unknown) => value,
    }),
    module,
    module.exports,
  );
  return nodes(
    module.exports.render(
      {
        t: String,
        project: { id: "project" },
        activeStory: { id: storyId },
        activeBeat: { id: beatId },
        beatDraft: { narration: "manual", visualDirection: "direction" },
        beatDirty: true,
        busy: "",
        relinkBusy: false,
        storyReviewBusy: false,
        storyReviewPending: false,
        jobs: [],
        flushPending: vi.fn(),
        scriptReviewAccepted: vi.fn(),
        refreshJobs: vi.fn(),
      },
      [],
    ),
  );
}

describe("Story review integration in the actual App template", () => {
  it("renders a saved-beat review boundary beside the manual script fields", () => {
    const review = renderReview().find(
      (node) => node.type === "StoryScriptReview",
    );
    expect(
      review,
      "Story scripts need optional provider review beside their manual fields",
    ).toBeDefined();
    expect(review!.props?.["project-id"]).toBe("project");
    expect(review!.props?.["story-id"]).toBe("story");
    expect(review!.props?.["beat-id"]).toBe("beat");
    expect(typeof review!.props?.prepare).toBe("function");
  });
  it("assigns distinct review owners to opaque Story and beat IDs containing delimiters", () => {
    const first = renderReview("a:b", "c").find(
      (node) => node.type === "StoryScriptReview",
    )!;
    const second = renderReview("a", "b:c").find(
      (node) => node.type === "StoryScriptReview",
    )!;
    expect(first.props?.key).not.toEqual(second.props?.key);
  });
  it.each(["opaque scope tuple", "project"])(
    "hydrates the manual beat when the %s owner changes",
    async (change) => {
      const appSource = source();
      const start = appSource.indexOf(
        "watch(\n",
        appSource.indexOf("function scriptReviewAccepted("),
      );
      const end = appSource.indexOf("\nfunction chooseCandidate", start);
      const project = vue.ref({ id: "project" });
      const activeStory = vue.ref({ id: "a:b" });
      const activeBeat = vue.ref({ id: "c" });
      const hydrateBeat = vi.fn();
      const dependencies = {
        project,
        activeStory,
        activeBeat,
        hydrateBeat,
        watch: vue.watch,
        loadCandidates: async () => {},
        error: vue.ref(null),
      };
      const scope = vue.effectScope();
      try {
        scope.run(() =>
          new Function(
            "dependencies",
            `const {${Object.keys(dependencies).join(",")}}=dependencies;${transformSync(appSource.slice(start, end), { loader: "ts", format: "esm" }).code}`,
          )(dependencies),
        );
        if (change === "project") project.value = { id: "another-project" };
        else {
          activeStory.value = { id: "a" };
          activeBeat.value = { id: "b:c" };
        }
        await vue.nextTick();
        expect(hydrateBeat).toHaveBeenCalledOnce();
      } finally {
        scope.stop();
      }
    },
  );
});
