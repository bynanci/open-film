import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import { describe, expect, it, vi } from "vitest";
import { resolveProjectTimebase, type ProjectSettings } from "@openfilm/core";
import {
  DEFAULT_PROJECT_TIMEBASE_PRESET_ID,
  PROJECT_TIMEBASE_PRESETS,
  sameRateDropFrameChoice,
} from "../../apps/desktop/src/projectTimebase";
import type { FilmCreation } from "../../apps/desktop/src/appTypes";
import { vue } from "./helpers/vue-sfc-host";

const ntscDf = {
  version: 1 as const,
  rateNumerator: 30000,
  rateDenominator: 1001,
  dropFrame: true,
};
function appHost() {
  const source = readFileSync("apps/desktop/src/App.vue", "utf8");
  const code = ["run", "refreshProject", "changeProjectTimebase"]
    .map((name) => {
      let start = source.indexOf(`function ${name}(`);
      if (start < 0) throw new Error(`Missing App function ${name}`);
      if (source.slice(start - 6, start) === "async ") start -= 6;
      return source.slice(start, source.indexOf("\n}", start) + 2);
    })
    .join("\n");
  const original = {
    id: "film-a",
    settings: {
      frameRate: 30000 / 1001,
      timebase: { ...ntscDf, dropFrame: false },
    },
  };
  const dependencies = {
    project: vue.ref(original),
    projectGeneration: vue.ref(0),
    projectPath: vue.ref("/film-a"),
    connected: vue.ref(true),
    busy: vue.ref(""),
    error: vue.ref(null as unknown),
    notice: vue.ref(null),
    relinkBusy: vue.ref(false),
    analysisRecoveryPending: vue.ref(false),
    flushProjectPending: vi.fn(async () => true),
    sameRateDropFrameChoice,
    api: {
      projectVersionRevision: vi.fn(async () => ({
        projectId: "film-a",
        revision: "a".repeat(64),
      })),
      updateProjectTimebase: vi.fn(async () => ({
        project: {
          ...original,
          settings: { ...original.settings, timebase: ntscDf },
        },
        path: "/film-a",
      })),
      project: vi.fn(async () => ({
        project: {
          ...original,
          settings: { ...original.settings, timebase: ntscDf },
        },
        path: "/film-a",
      })),
    },
  };
  const change = new Function(
    "dependencies",
    `const {${Object.keys(dependencies).join(",")}} = dependencies; let projectMutationVersion = 0;\n${transformSync(code, { loader: "ts" }).code}\nreturn changeProjectTimebase;`,
  )(dependencies);
  return { ...dependencies, change, original };
}

describe("App timebase update ownership", () => {
  it("flushes before reading the digest, submits exact data and refreshes the same owner", async () => {
    const host = appHost();
    host.api.projectVersionRevision.mockImplementation(async () => {
      expect(host.flushProjectPending).toHaveBeenCalledOnce();
      return { projectId: "film-a", revision: "a".repeat(64) };
    });
    await host.change(ntscDf);
    expect(host.api.updateProjectTimebase).toHaveBeenCalledWith({
      projectId: "film-a",
      baseRevision: "a".repeat(64),
      timebase: ntscDf,
    });
    expect(host.project.value.settings.timebase).toEqual(ntscDf);
  });

  it.each(["flush", "digest", "update", "refresh"])(
    "does not publish after a project switch during %s",
    async (stage) => {
      const host = appHost();
      const switchProject = () => {
        host.project.value = { ...host.original, id: "film-b" };
        host.projectGeneration.value++;
      };
      if (stage === "flush")
        host.flushProjectPending.mockImplementation(async () => {
          switchProject();
          return true;
        });
      if (stage === "digest")
        host.api.projectVersionRevision.mockImplementation(async () => {
          switchProject();
          return { projectId: "film-a", revision: "a".repeat(64) };
        });
      if (stage === "update")
        host.api.updateProjectTimebase.mockImplementation(async () => {
          switchProject();
          return { project: host.original, path: "/film-a" };
        });
      if (stage === "refresh")
        host.api.project.mockImplementation(async () => {
          switchProject();
          return { project: host.original, path: "/film-a" };
        });
      await host.change(ntscDf);
      expect(host.project.value.id).toBe("film-b");
      expect(host.project.value.settings.timebase.dropFrame).toBe(false);
      if (stage === "flush" || stage === "digest")
        expect(host.api.updateProjectTimebase).not.toHaveBeenCalled();
    },
  );

  it.each(["conflict", "abort"])(
    "retains the project and reports %s on the existing error surface",
    async (kind) => {
      const host = appHost();
      const failure =
        kind === "conflict"
          ? { code: "project.timebaseConflict" }
          : new DOMException("Aborted", "AbortError");
      host.api.updateProjectTimebase.mockRejectedValue(failure);
      await host.change(ntscDf);
      expect(host.project.value).toEqual(host.original);
      expect(host.error.value).toEqual(failure);
      expect(host.api.project).not.toHaveBeenCalled();
    },
  );

  it("rejects a foreign revision snapshot", async () => {
    const host = appHost();
    host.api.projectVersionRevision.mockResolvedValue({
      projectId: "film-b",
      revision: "a".repeat(64),
    });
    await host.change(ntscDf);
    expect(host.api.updateProjectTimebase).not.toHaveBeenCalled();
    expect(host.project.value).toEqual(host.original);
    expect(host.error.value).toMatchObject({
      code: "project.timebaseConflict",
    });
  });

  it("does not publish a foreign refresh response", async () => {
    const host = appHost();
    host.api.project.mockResolvedValue({
      project: { ...host.original, id: "film-b" },
      path: "/film-b",
    });
    await host.change(ntscDf);
    expect(host.project.value).toEqual(host.original);
    expect(host.projectPath.value).toBe("/film-a");
    expect(host.error.value).toMatchObject({
      code: "project.timebaseConflict",
    });
  });

  it("does not submit after a failed draft flush", async () => {
    const host = appHost();
    host.flushProjectPending.mockResolvedValue(false);
    await host.change(ntscDf);
    expect(host.api.projectVersionRevision).not.toHaveBeenCalled();
    expect(host.project.value).toEqual(host.original);
  });
});

function launcher() {
  const source = readFileSync(
    "apps/desktop/src/components/AppLauncher.vue",
    "utf8",
  );
  const code = transformSync(
    source.match(/<script setup[^>]*>([\s\S]*?)<\/script>/)![1]!,
    { loader: "ts", format: "esm" },
  ).code.replace(/^import[\s\S]*?from "[^"\n]+";\n/gm, "");
  const payloads: FilmCreation[] = [];
  const host = new Function(
    "dependencies",
    `const {${["ref", "computed", "watch", "useI18n", "defineProps", "defineEmits", "preferences", "supportedLocales", "PROJECT_TIMEBASE_PRESETS", "DEFAULT_PROJECT_TIMEBASE_PRESET_ID"].join(",")}} = dependencies;\n${code}\nreturn {name, template, target, maximum, timebasePresetId: typeof timebasePresetId === "undefined" ? undefined : timebasePresetId, submit};`,
  )({
    ref: vue.ref,
    computed: vue.computed,
    watch: vue.watch,
    useI18n: () => ({ t: (key: string) => key }),
    defineProps: () => ({
      templates: [
        { id: "blank", targetDuration: 120, maxDuration: 180 },
        { id: "proposal-film", targetDuration: 60, maxDuration: 90 },
      ],
    }),
    defineEmits: () => (_name: string, payload: FilmCreation) =>
      payloads.push(payload),
    preferences: { defaultFilmLocale: "en-US" },
    supportedLocales: [],
    PROJECT_TIMEBASE_PRESETS,
    DEFAULT_PROJECT_TIMEBASE_PRESET_ID,
  });
  host.name.value = "Exact film";
  return { ...host, payloads };
}

describe("project timebase presets and creation payload", () => {
  it("offers ten unique, valid exact presets", () => {
    expect(PROJECT_TIMEBASE_PRESETS).toHaveLength(10);
    expect(
      new Set(PROJECT_TIMEBASE_PRESETS.map((preset) => preset.id)).size,
    ).toBe(10);
    expect(
      PROJECT_TIMEBASE_PRESETS.map(({ timebase }) => [
        timebase.rateNumerator,
        timebase.rateDenominator,
        timebase.dropFrame,
      ]),
    ).toEqual([
      [24000, 1001, false],
      [24, 1, false],
      [25, 1, false],
      [30000, 1001, true],
      [30000, 1001, false],
      [30, 1, false],
      [50, 1, false],
      [60000, 1001, true],
      [60000, 1001, false],
      [60, 1, false],
    ]);
    for (const { timebase } of PROJECT_TIMEBASE_PRESETS)
      expect(
        resolveProjectTimebase({
          frameRate: timebase.rateNumerator / timebase.rateDenominator,
          timebase,
        } as ProjectSettings),
      ).toEqual(timebase);
  });

  it("emits 30/1 NDF by default after changing template and duration", async () => {
    const form = launcher();
    form.template.value = "proposal-film";
    await vue.nextTick();
    form.target.value = 20;
    form.maximum.value = 30;
    form.submit();
    expect(form.payloads[0]?.timebase).toEqual({
      version: 1,
      rateNumerator: 30,
      rateDenominator: 1,
      dropFrame: false,
    });
  });

  it("keeps selected 29.97 DF through other form changes and serializes integers", async () => {
    const form = launcher();
    form.timebasePresetId.value = "29.97-df";
    form.template.value = "proposal-film";
    await vue.nextTick();
    form.target.value = 20;
    form.maximum.value = 30;
    form.submit();
    expect(JSON.parse(JSON.stringify(form.payloads[0])).timebase).toEqual({
      version: 1,
      rateNumerator: 30000,
      rateDenominator: 1001,
      dropFrame: true,
    });
  });
});

describe("existing project drop-frame choice", () => {
  it.each([30000, 60000])(
    "offers only the opposite flag at %s/1001",
    (rateNumerator) => {
      for (const dropFrame of [false, true]) {
        const timebase = {
          version: 1 as const,
          rateNumerator,
          rateDenominator: 1001,
          dropFrame,
        };
        expect(
          sameRateDropFrameChoice({
            frameRate: rateNumerator / 1001,
            timebase,
          } as ProjectSettings),
        ).toEqual({ ...timebase, dropFrame: !dropFrame });
      }
    },
  );

  it("resolves a legacy NTSC rate without mutating saved settings", () => {
    const settings = { frameRate: 29.97 } as ProjectSettings;
    expect(sameRateDropFrameChoice(settings)).toEqual({
      version: 1,
      rateNumerator: 30000,
      rateDenominator: 1001,
      dropFrame: true,
    });
    expect(settings).toEqual({ frameRate: 29.97 });
  });

  it.each([24, 25, 30, 50, 60, 24000 / 1001])(
    "offers no DF alternative for %s",
    (frameRate) => {
      expect(
        sameRateDropFrameChoice({ frameRate } as ProjectSettings),
      ).toBeUndefined();
    },
  );
});
