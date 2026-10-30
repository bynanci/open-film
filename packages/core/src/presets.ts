// SPDX-License-Identifier: Apache-2.0
import { ApplicationError } from "./errors.js";
import { validateTitleStyle } from "./validation.js";
import type {
  Composition,
  OpenFilmProject,
  ProjectContentLocale,
  TitleStyle,
} from "./models.js";
import type { FilmLookMatrix } from "./looks.js";
import type { StoryPlanOptions } from "./story-plan.js";

export const PRESET_LIMITS = Object.freeze({
  packageBytes: 262144,
  depth: 12,
  tokens: 20000,
  entries: 32,
  packages: 32,
  installedEntries: 256,
  registryBytes: 8388608,
  snapshotBytes: 98304,
  projectSnapshots: 256,
  projectSnapshotBytes: 4194304,
  receipts: 200,
  totalText: 131072,
});
export const PRESET_KINDS = ["film-look", "title", "story"] as const;
export type PresetKind = (typeof PRESET_KINDS)[number];
export type TitlePresetRecipe = TitleStyle;
export interface FilmLookPresetRecipeV1 {
  version: 1;
  domain: "encoded-sdr-rgb";
  matrix: FilmLookMatrix;
  defaultStrength: number;
}
export interface StoryPresetRecipeV1 {
  version: 1;
  defaultLocale: ProjectContentLocale;
  defaults: { targetDuration: number; maxDuration: number };
  beats: {
    key: string;
    weight: number;
    text: Partial<
      Record<
        ProjectContentLocale,
        { title: string; intent: string; visualDirection: string }
      >
    >;
  }[];
}
export type PresetRecipeByKind = {
  "film-look": FilmLookPresetRecipeV1;
  title: TitlePresetRecipe;
  story: StoryPresetRecipeV1;
};
export type PresetEntry = {
  [K in PresetKind]: {
    kind: K;
    id: string;
    name: string;
    recipe: PresetRecipeByKind[K];
  };
}[PresetKind];
export interface PresetPackageV1 {
  format: "openfilm-presets";
  schemaVersion: 1;
  id: string;
  name: string;
  version: string;
  description?: string;
  license: {
    spdxId:
      | "Apache-2.0"
      | "MIT"
      | "BSD-2-Clause"
      | "BSD-3-Clause"
      | "CC0-1.0"
      | "CC-BY-4.0";
    copyright: string;
    notice: string;
  };
  provenance: {
    author: string;
    origin: "original" | "adapted";
    source: string;
    modificationNotice?: string;
  };
  entries: PresetEntry[];
}
export interface PresetSnapshot<K extends PresetKind = PresetKind> {
  version: 1;
  canonicalId: string;
  packageId: string;
  packageVersion: string;
  packageSha256: string;
  entryId: string;
  kind: K;
  name: string;
  license: PresetPackageV1["license"];
  provenance: PresetPackageV1["provenance"];
  recipe: PresetRecipeByKind[K];
  recipeSha256: string;
  snapshotSha256: string;
}
export interface PresetPlanSource {
  version: 1;
  storyId: string;
  planId: string;
  sourceGuardSha256: string;
  bindings: { recipeBeatKey: string; sourceBeatId: string; beatId: string }[];
}
export interface PresetStoryPlanContext {
  version: 1;
  snapshot: PresetSnapshot<"story">;
  bindings: { recipeBeatKey: string; beatId: string }[];
  baseProjectRevision: string;
  sourceGuardSha256: string;
}
export interface PresetApplicationReceipt {
  version: 1;
  projectId: string;
  requestId: string;
  requestSha256: string;
  reviewSha256: string;
  kind: PresetKind;
  canonicalId: string;
  packageSha256: string;
  snapshotSha256: string;
  result: { storyId: string; compositionId: string };
  acceptedRevision: string;
  acceptedAt: string;
}
export interface PresetSelection {
  canonicalId: string;
  packageSha256: string;
  registryRevision: string;
}
export type PresetApplyTarget =
  | {
      kind: "film-look";
      compositionId: string;
      scope: "film";
      strength?: number;
    }
  | {
      kind: "film-look";
      compositionId: string;
      scope: "beat";
      beatId: string;
      strength?: number;
    }
  | {
      kind: "film-look";
      compositionId: string;
      scope: "clip";
      clipId: string;
      strength?: number;
    }
  | { kind: "title"; compositionId: string; clipId: string }
  | {
      kind: "story";
      storyId: string;
      bindings: { recipeBeatKey: string; beatId: string }[];
      options: Pick<
        StoryPlanOptions,
        "targetDuration" | "maxDuration" | "transition"
      >;
    };
export interface PresetApplyInput {
  projectId: string;
  selection: PresetSelection;
  baseRevision: string;
  target: PresetApplyTarget;
}
export interface PresetAcceptInput {
  request: PresetApplyInput;
  reviewSha256: string;
  requestId: string;
}
type Data = Record<string, unknown>;
const locales = ["en-US", "zh-TW", "ja-JP"] as const;
export function presetInvalid(path: string, message: string): never {
  throw new ApplicationError("presets.invalid", `${path}: ${message}`, 400, {
    path,
  });
}
export function presetRecord(
  value: unknown,
  path: string,
  allowed: readonly string[],
): Data {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    presetInvalid(path, "expected a plain JSON object");
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowed.includes(key))
      presetInvalid(path, "unknown field");
    const d = Object.getOwnPropertyDescriptor(value, key)!;
    if (!("value" in d) || !d.enumerable)
      presetInvalid(path, "expected JSON data, not an accessor");
  }
  return value as Data;
}
/** Descriptor-first walk. Data supplied by executable host code is not a JS sandbox. */
export function assertPresetJsonData(
  value: unknown,
  limits: { depth?: number; tokens?: number; text?: number } = {},
): void {
  let tokens = 0,
    text = 0;
  const ancestors = new WeakSet<object>();
  const walk = (v: unknown, depth: number): void => {
    if (++tokens > (limits.tokens ?? PRESET_LIMITS.tokens))
      presetInvalid("data", "token budget exceeded");
    if (typeof v === "string") {
      text += v.length;
      if (
        text > (limits.text ?? PRESET_LIMITS.totalText) ||
        /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
          v,
        )
      )
        presetInvalid("data", "invalid or oversized Unicode text");
      return;
    }
    if (v === null || typeof v === "boolean") return;
    if (typeof v === "number") {
      if (!Number.isFinite(v)) presetInvalid("data", "expected finite number");
      return;
    }
    if (typeof v !== "object") presetInvalid("data", "expected JSON data");
    if (depth > (limits.depth ?? PRESET_LIMITS.depth) || ancestors.has(v))
      presetInvalid("data", "depth budget exceeded or cyclic data");
    ancestors.add(v);
    if (Array.isArray(v)) {
      if (
        Object.getPrototypeOf(v) !== Array.prototype ||
        v.length > (limits.tokens ?? PRESET_LIMITS.tokens)
      )
        presetInvalid("data", "invalid array data");
      if (
        Reflect.ownKeys(v).some(
          (k) =>
            typeof k !== "string" ||
            (k !== "length" && !/^(0|[1-9]\d*)$/.test(k)),
        )
      )
        presetInvalid("data", "decorated array data");
      for (let i = 0; i < v.length; i++) {
        const d = Object.getOwnPropertyDescriptor(v, String(i));
        if (!d || !("value" in d) || !d.enumerable)
          presetInvalid("data", "expected dense data array");
        walk(d.value, depth + 1);
      }
    } else {
      if (![Object.prototype, null].includes(Object.getPrototypeOf(v)))
        presetInvalid("data", "expected plain JSON data");
      for (const key of Reflect.ownKeys(v)) {
        if (
          typeof key !== "string" ||
          key.length > 64 ||
          ["__proto__", "prototype", "constructor"].includes(key)
        )
          presetInvalid("data", "unsafe object key");
        const d = Object.getOwnPropertyDescriptor(v, key)!;
        if (!("value" in d) || !d.enumerable)
          presetInvalid("data", "expected data, not an accessor");
        if (++tokens > (limits.tokens ?? PRESET_LIMITS.tokens))
          presetInvalid("data", "token budget exceeded");
        walk(d.value, depth + 1);
      }
    }
    ancestors.delete(v);
  };
  walk(value, 1);
}
/** Called only after the bounded descriptor walk; Vue wrappers are copied as data. */
function copyValidatedPresetData(value: unknown): unknown {
  if (Array.isArray(value))
    return Array.from({ length: value.length }, (_, index) =>
      copyValidatedPresetData(
        Object.getOwnPropertyDescriptor(value, String(index))!.value,
      ),
    );
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(Object.getOwnPropertyDescriptors(value)).map(
        ([key, descriptor]) => [key, copyValidatedPresetData(descriptor.value)],
      ),
    );
  return value;
}
export function presetText(
  value: unknown,
  path: string,
  max = 256,
  multiline = false,
): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > max ||
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
      value,
    ) ||
    /[<>]/u.test(value) ||
    /(?:\b(?:https?|file|data|javascript):|[a-z][a-z0-9+.-]*:\/\/)/iu.test(
      value,
    ) ||
    [...value].some((c) => {
      const n = c.codePointAt(0)!;
      return (n < 32 && !(multiline && n === 10)) || n === 127;
    })
  )
    presetInvalid(
      path,
      "expected bounded plain Unicode text without markup, URL or controls",
    );
  return value;
}
export function presetId(value: unknown, path: string, max = 64): string {
  const s = presetText(value, path, max);
  if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(s))
    presetInvalid(path, "expected lowercase identifier");
  return s;
}
export function presetVersion(value: unknown, path = "version"): string {
  const s = presetText(value, path, 32);
  if (!/^(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})$/.test(s))
    presetInvalid(path, "expected supported stable semantic version");
  return s;
}
export function presetHash(value: unknown, path: string): string {
  if (typeof value !== "string" || !/^(?:[a-f0-9]{64})$/.test(value))
    presetInvalid(path, "expected SHA-256 digest");
  return value;
}
export function presetNumber(
  value: unknown,
  path: string,
  min: number,
  max: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  )
    presetInvalid(path, "number outside supported finite range");
  return value;
}
export function canonicalPresetId(
  packageId: string,
  version: string,
  kind: PresetKind,
  entryId: string,
): string {
  presetId(packageId, "packageId", 96);
  presetVersion(version);
  presetId(entryId, "entryId");
  if (!PRESET_KINDS.includes(kind)) presetInvalid("kind", "unsupported kind");
  return `local:${packageId}@${version}/${kind}/${entryId}`;
}
function rights(data: Data, path: string): void {
  const l = presetRecord(data.license, `${path}.license`, [
    "spdxId",
    "copyright",
    "notice",
  ]);
  if (
    ![
      "Apache-2.0",
      "MIT",
      "BSD-2-Clause",
      "BSD-3-Clause",
      "CC0-1.0",
      "CC-BY-4.0",
    ].includes(String(l.spdxId))
  )
    presetInvalid(`${path}.license.spdxId`, "unsupported license identifier");
  presetText(l.copyright, `${path}.license.copyright`);
  presetText(l.notice, `${path}.license.notice`, 4096, true);
  const p = presetRecord(data.provenance, `${path}.provenance`, [
    "author",
    "origin",
    "source",
    "modificationNotice",
  ]);
  presetText(p.author, `${path}.provenance.author`);
  presetText(p.source, `${path}.provenance.source`, 512);
  if (p.origin !== "original" && p.origin !== "adapted")
    presetInvalid(`${path}.provenance.origin`, "unsupported provenance origin");
  if (p.modificationNotice !== undefined || p.origin === "adapted")
    presetText(
      p.modificationNotice,
      `${path}.provenance.modificationNotice`,
      2048,
      true,
    );
}
export function validatePresetRecipe<K extends PresetKind>(
  value: unknown,
  kind: K,
  path = "recipe",
): PresetRecipeByKind[K] {
  assertPresetJsonData(value);
  if (kind === "title") {
    const style = validateTitleStyle(value);
    if (style.fontFamily !== undefined) {
      presetText(style.fontFamily, `${path}.fontFamily`, 128);
      if (/[\\/]/u.test(style.fontFamily))
        presetInvalid(`${path}.fontFamily`, "expected family name, not a path");
    }
    if (style.maxWidth !== undefined)
      presetNumber(style.maxWidth, `${path}.maxWidth`, Number.MIN_VALUE, 4096);
    return style as PresetRecipeByKind[K];
  }
  const r = presetRecord(
    value,
    path,
    kind === "film-look"
      ? ["version", "domain", "matrix", "defaultStrength"]
      : ["version", "defaultLocale", "defaults", "beats"],
  );
  if (r.version !== 1)
    presetInvalid(`${path}.version`, "unsupported recipe version");
  if (kind === "film-look") {
    if (r.domain !== "encoded-sdr-rgb")
      presetInvalid(`${path}.domain`, "unsupported matrix domain");
    const a = r.matrix;
    if (!Array.isArray(a) || a.length !== 20)
      presetInvalid(`${path}.matrix`, "expected 20 matrix values");
    a.forEach((v, i) => {
      presetNumber(
        v,
        `${path}.matrix[${i}]`,
        [3, 8, 13].includes(i) ? -0.5 : -2,
        [3, 8, 13].includes(i) ? 0.5 : 2,
      );
      if (
        ([4, 9, 14, 15, 16, 17, 19].includes(i) && v !== 0) ||
        (i === 18 && v !== 1)
      )
        presetInvalid(
          `${path}.matrix[${i}]`,
          "constant columns and alpha row must preserve alpha",
        );
    });
    presetNumber(r.defaultStrength, `${path}.defaultStrength`, 0, 1);
  } else {
    if (!locales.includes(r.defaultLocale as ProjectContentLocale))
      presetInvalid(`${path}.defaultLocale`, "unsupported content locale");
    const d = presetRecord(r.defaults, `${path}.defaults`, [
      "targetDuration",
      "maxDuration",
    ]);
    const target = presetNumber(
      d.targetDuration,
      `${path}.defaults.targetDuration`,
      Number.MIN_VALUE,
      3600,
    );
    const maximum = presetNumber(
      d.maxDuration,
      `${path}.defaults.maxDuration`,
      target,
      10800,
    );
    void maximum;
    if (!Array.isArray(r.beats) || r.beats.length < 1 || r.beats.length > 12)
      presetInvalid(`${path}.beats`, "expected 1 to 12 authored beats");
    const seen = new Set<string>();
    r.beats.forEach((b, i) => {
      const q = `${path}.beats[${i}]`,
        beat = presetRecord(b, q, ["key", "weight", "text"]);
      const key = presetId(beat.key, `${q}.key`);
      if (seen.has(key)) presetInvalid(`${q}.key`, "duplicate beat key");
      seen.add(key);
      if (!Number.isInteger(presetNumber(beat.weight, `${q}.weight`, 1, 1000)))
        presetInvalid(`${q}.weight`, "expected integer weight");
      const t = presetRecord(beat.text, `${q}.text`, locales);
      if (!Object.hasOwn(t, String(r.defaultLocale)))
        presetInvalid(`${q}.text`, "default locale text is required");
      for (const [locale, v] of Object.entries(t)) {
        const a = presetRecord(v, `${q}.text.${locale}`, [
          "title",
          "intent",
          "visualDirection",
        ]);
        presetText(a.title, `${q}.text.${locale}.title`, 128);
        presetText(a.intent, `${q}.text.${locale}.intent`, 1024, true);
        presetText(
          a.visualDirection,
          `${q}.text.${locale}.visualDirection`,
          2048,
          true,
        );
      }
    });
  }
  return copyValidatedPresetData(value) as PresetRecipeByKind[K];
}
export function validatePresetPackage(value: unknown): PresetPackageV1 {
  assertPresetJsonData(value);
  const p = presetRecord(value, "package", [
    "format",
    "schemaVersion",
    "id",
    "name",
    "version",
    "description",
    "license",
    "provenance",
    "entries",
  ]);
  if (p.format !== "openfilm-presets" || p.schemaVersion !== 1)
    presetInvalid(
      "package.schemaVersion",
      "unsupported preset package format/version",
    );
  const id = presetId(p.id, "package.id", 96);
  if (/^(?:openfilm|builtin)(?:\.|$)/.test(id))
    presetInvalid("package.id", "reserved built-in namespace");
  presetVersion(p.version);
  presetText(p.name, "package.name", 128);
  if (p.description !== undefined)
    presetText(p.description, "package.description", 1024);
  rights(p, "package");
  if (
    !Array.isArray(p.entries) ||
    !p.entries.length ||
    p.entries.length > PRESET_LIMITS.entries
  )
    presetInvalid("package.entries", "expected 1 to 32 entries");
  const ids = new Set<string>();
  p.entries.forEach((v, i) => {
    const path = `package.entries[${i}]`,
      e = presetRecord(v, path, ["kind", "id", "name", "recipe"]);
    const id = presetId(e.id, `${path}.id`);
    if (ids.has(id)) presetInvalid(`${path}.id`, "duplicate entry identifier");
    ids.add(id);
    presetText(e.name, `${path}.name`, 128);
    if (!PRESET_KINDS.includes(e.kind as PresetKind))
      presetInvalid(`${path}.kind`, "unsupported preset kind");
    validatePresetRecipe(e.recipe, e.kind as PresetKind, `${path}.recipe`);
  });
  if (
    new TextEncoder().encode(JSON.stringify(value)).length >
    PRESET_LIMITS.packageBytes
  )
    presetInvalid("package", "package byte budget exceeded");
  return copyValidatedPresetData(value) as PresetPackageV1;
}
export function canonicalPresetJson(value: unknown): string {
  assertPresetJsonData(value, { depth: 24, tokens: 1000000, text: 16777216 });
  const encode = (v: unknown): string =>
    Array.isArray(v)
      ? `[${v.map(encode).join(",")}]`
      : v && typeof v === "object"
        ? `{${Object.keys(v)
            .sort()
            .map((k) => `${JSON.stringify(k)}:${encode((v as Data)[k])}`)
            .join(",")}}`
        : JSON.stringify(v);
  return encode(value);
}
export function presetRecipeHashInput(
  recipe: PresetRecipeByKind[PresetKind],
): string {
  return canonicalPresetJson(recipe);
}
export function presetSnapshotHashInput(snapshot: PresetSnapshot): string {
  const { snapshotSha256: _hash, ...payload } = snapshot;
  return canonicalPresetJson(payload);
}
export function validatePresetSnapshot<K extends PresetKind>(
  value: unknown,
  kind: K,
): PresetSnapshot<K> {
  assertPresetJsonData(value);
  const p = presetRecord(value, "snapshot", [
    "version",
    "canonicalId",
    "packageId",
    "packageVersion",
    "packageSha256",
    "entryId",
    "kind",
    "name",
    "license",
    "provenance",
    "recipe",
    "recipeSha256",
    "snapshotSha256",
  ]);
  if (p.version !== 1 || p.kind !== kind)
    presetInvalid("snapshot.version", "unsupported snapshot version/kind");
  const id = canonicalPresetId(
    presetId(p.packageId, "snapshot.packageId", 96),
    presetVersion(p.packageVersion),
    kind,
    presetId(p.entryId, "snapshot.entryId"),
  );
  if (p.canonicalId !== id)
    presetInvalid("snapshot.canonicalId", "canonical identity mismatch");
  presetText(p.name, "snapshot.name", 128);
  rights(p, "snapshot");
  for (const k of ["packageSha256", "recipeSha256", "snapshotSha256"])
    presetHash(p[k], `snapshot.${k}`);
  validatePresetRecipe(p.recipe, kind);
  if (
    new TextEncoder().encode(JSON.stringify(value)).length >
    PRESET_LIMITS.snapshotBytes
  )
    presetInvalid("snapshot", "snapshot byte budget exceeded");
  return copyValidatedPresetData(value) as PresetSnapshot<K>;
}
export function compositionPresetSnapshots(c: Composition): PresetSnapshot[] {
  const result: PresetSnapshot[] = [];
  if (c.storyPresetSnapshot)
    result.push(validatePresetSnapshot(c.storyPresetSnapshot, "story"));
  const look = (l: typeof c.defaultLook) => {
    if (l?.version === 2)
      result.push(validatePresetSnapshot(l.snapshot, "film-look"));
  };
  look(c.defaultLook);
  for (const b of c.beatLooks ?? []) look(b.look);
  for (const track of c.tracks)
    for (const clip of track.clips) {
      look(clip.look);
      if (clip.titlePresetSnapshot)
        result.push(validatePresetSnapshot(clip.titlePresetSnapshot, "title"));
    }
  return result;
}
export function projectPresetSnapshots(p: OpenFilmProject): PresetSnapshot[] {
  const snapshots = p.timelines.flatMap(compositionPresetSnapshots);
  for (const story of p.stories)
    if (story.presetSnapshot)
      snapshots.push(validatePresetSnapshot(story.presetSnapshot, "story"));
  if (
    snapshots.length > PRESET_LIMITS.projectSnapshots ||
    snapshots.reduce(
      (n, s) => n + new TextEncoder().encode(JSON.stringify(s)).length,
      0,
    ) > PRESET_LIMITS.projectSnapshotBytes
  )
    presetInvalid("project.presets", "project snapshot budget exceeded");
  return snapshots;
}
export function validatePresetApplyInput(value: unknown): PresetApplyInput {
  assertPresetJsonData(value);
  const p = presetRecord(value, "apply", [
    "projectId",
    "selection",
    "baseRevision",
    "target",
  ]);
  presetText(p.projectId, "apply.projectId");
  presetHash(p.baseRevision, "apply.baseRevision");
  const s = presetRecord(p.selection, "apply.selection", [
    "canonicalId",
    "packageSha256",
    "registryRevision",
  ]);
  presetText(s.canonicalId, "apply.selection.canonicalId", 256);
  presetHash(s.packageSha256, "apply.selection.packageSha256");
  presetHash(s.registryRevision, "apply.selection.registryRevision");
  const t = presetRecord(p.target, "apply.target", [
    "kind",
    "compositionId",
    "scope",
    "beatId",
    "clipId",
    "strength",
    "storyId",
    "bindings",
    "options",
  ]);
  if (t.kind === "story") {
    presetRecord(t, "apply.target", ["kind", "storyId", "bindings", "options"]);
    presetText(t.storyId, "apply.target.storyId");
    if (
      !Array.isArray(t.bindings) ||
      !t.bindings.length ||
      t.bindings.length > 12
    )
      presetInvalid("apply.target.bindings", "expected 1 to 12 bindings");
    for (const b of t.bindings) {
      const r = presetRecord(b, "binding", ["recipeBeatKey", "beatId"]);
      presetId(r.recipeBeatKey, "binding.recipeBeatKey");
      presetText(r.beatId, "binding.beatId");
    }
    const o = presetRecord(t.options, "apply.target.options", [
      "targetDuration",
      "maxDuration",
      "transition",
    ]);
    if (o.targetDuration !== undefined)
      presetNumber(
        o.targetDuration,
        "options.targetDuration",
        Number.MIN_VALUE,
        3600,
      );
    if (o.maxDuration !== undefined)
      presetNumber(
        o.maxDuration,
        "options.maxDuration",
        Number.MIN_VALUE,
        10800,
      );
    if (
      o.transition !== undefined &&
      o.transition !== "cut" &&
      o.transition !== "crossfade"
    )
      presetInvalid("options.transition", "unsupported transition");
  } else {
    presetText(t.compositionId, "apply.target.compositionId");
    if (t.kind === "title") {
      presetRecord(t, "apply.target", ["kind", "compositionId", "clipId"]);
      presetText(t.clipId, "apply.target.clipId");
    } else if (t.kind === "film-look") {
      const fields = ["kind", "compositionId", "scope", "strength"];
      if (t.scope === "clip") {
        fields.push("clipId");
        presetText(t.clipId, "target.clipId");
      } else if (t.scope === "beat") {
        fields.push("beatId");
        presetText(t.beatId, "target.beatId");
      } else if (t.scope !== "film")
        presetInvalid("target.scope", "unsupported look scope");
      presetRecord(t, "target", fields);
      if (t.strength !== undefined)
        presetNumber(t.strength, "target.strength", 0, 1);
    } else presetInvalid("target.kind", "unsupported preset kind");
  }
  return copyValidatedPresetData(value) as PresetApplyInput;
}
export function validatePresetReceipts(
  value: unknown,
  projectId: string,
): PresetApplicationReceipt[] {
  assertPresetJsonData(value, { tokens: 20000, text: 500000 });
  if (!Array.isArray(value) || value.length > PRESET_LIMITS.receipts)
    presetInvalid("receipts", "receipt budget exceeded");
  const seen = new Set<string>();
  for (const v of value) {
    const r = presetRecord(v, "receipt", [
      "version",
      "projectId",
      "requestId",
      "requestSha256",
      "reviewSha256",
      "kind",
      "canonicalId",
      "packageSha256",
      "snapshotSha256",
      "result",
      "acceptedRevision",
      "acceptedAt",
    ]);
    if (
      r.version !== 1 ||
      r.projectId !== projectId ||
      !PRESET_KINDS.includes(r.kind as PresetKind)
    )
      presetInvalid("receipt", "unsupported receipt identity/version");
    const id = presetText(r.requestId, "receipt.requestId");
    if (seen.has(id)) presetInvalid("receipt.requestId", "duplicate receipt");
    seen.add(id);
    for (const k of [
      "requestSha256",
      "reviewSha256",
      "packageSha256",
      "snapshotSha256",
      "acceptedRevision",
    ])
      presetHash(r[k], `receipt.${k}`);
    presetText(r.canonicalId, "receipt.canonicalId");
    const result = presetRecord(r.result, "receipt.result", [
      "storyId",
      "compositionId",
    ]);
    presetText(result.storyId, "receipt.result.storyId");
    presetText(result.compositionId, "receipt.result.compositionId");
    if (
      typeof r.acceptedAt !== "string" ||
      !Number.isFinite(Date.parse(r.acceptedAt)) ||
      new Date(r.acceptedAt).toISOString() !== r.acceptedAt
    )
      presetInvalid("receipt.acceptedAt", "expected ISO timestamp");
  }
  return copyValidatedPresetData(value) as PresetApplicationReceipt[];
}
export function validatePresetStoryPlanContext(
  value: unknown,
): PresetStoryPlanContext {
  assertPresetJsonData(value);
  const r = presetRecord(value, "presetContext", [
    "version",
    "snapshot",
    "bindings",
    "baseProjectRevision",
    "sourceGuardSha256",
  ]);
  if (r.version !== 1)
    presetInvalid("presetContext.version", "unsupported preset context");
  const snapshot = validatePresetSnapshot(r.snapshot, "story");
  presetHash(r.baseProjectRevision, "presetContext.baseProjectRevision");
  presetHash(r.sourceGuardSha256, "presetContext.sourceGuardSha256");
  if (
    !Array.isArray(r.bindings) ||
    r.bindings.length !== snapshot.recipe.beats.length
  )
    presetInvalid("presetContext.bindings", "incomplete preset bindings");
  const seen = new Set<string>();
  for (const value of r.bindings) {
    const b = presetRecord(value, "binding", ["recipeBeatKey", "beatId"]);
    presetId(b.recipeBeatKey, "binding.recipeBeatKey");
    presetText(b.beatId, "binding.beatId");
    if (seen.has(String(b.beatId)))
      presetInvalid("binding", "duplicate source beat");
    seen.add(String(b.beatId));
  }
  return copyValidatedPresetData(value) as PresetStoryPlanContext;
}
export function validatePresetPlanSource(value: unknown): PresetPlanSource {
  assertPresetJsonData(value);
  const r = presetRecord(value, "presetPlanSource", [
    "version",
    "storyId",
    "planId",
    "sourceGuardSha256",
    "bindings",
  ]);
  if (r.version !== 1)
    presetInvalid(
      "presetPlanSource.version",
      "unsupported plan-source version",
    );
  presetText(r.storyId, "presetPlanSource.storyId");
  presetText(r.planId, "presetPlanSource.planId");
  presetHash(r.sourceGuardSha256, "presetPlanSource.sourceGuardSha256");
  if (
    !Array.isArray(r.bindings) ||
    !r.bindings.length ||
    r.bindings.length > 12
  )
    presetInvalid("presetPlanSource.bindings", "invalid plan-source mapping");
  for (const v of r.bindings) {
    const b = presetRecord(v, "binding", [
      "recipeBeatKey",
      "sourceBeatId",
      "beatId",
    ]);
    presetId(b.recipeBeatKey, "binding.recipeBeatKey");
    presetText(b.sourceBeatId, "binding.sourceBeatId");
    presetText(b.beatId, "binding.beatId");
  }
  return copyValidatedPresetData(value) as PresetPlanSource;
}
