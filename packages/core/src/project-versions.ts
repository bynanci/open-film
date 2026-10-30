// Modified by OpenFilm contributors on 2026-10-20. See LICENSE and NOTICE.
import type { MediaType, OpenFilmProject } from "./models.js";
import { ProjectValidationError } from "./validation.js";

export const PROJECT_VERSION_RECORD_VERSION = 1 as const;
export const PROJECT_VERSION_LIMITS = Object.freeze({
  nameCharacters: 128,
  descriptionCharacters: 2048,
  sourceReferences: 50_000,
  count: 50,
  totalBytes: 2 * 1024 * 1024 * 1024,
});

/** Source identity only; filesystem paths are private to the project adapter. */
export interface ProjectVersionSourceReference {
  assetId: string;
  sha256: string;
  sizeBytes: number;
  mediaType: MediaType;
  kind: "managed" | "external";
}

/** Mutable label metadata is stored in the index; snapshot payloads stay immutable. */
export interface ProjectVersionRecord {
  version: typeof PROJECT_VERSION_RECORD_VERSION;
  id: string;
  projectId: string;
  name: string;
  description?: string;
  createdAt: string;
  parentVersionId?: string;
  requestId: string;
  projectRevision: string;
  projectHash: string;
  catalogHash: string;
  catalogSchemaVersion: number;
  softwareVersion: string;
  sourceReferences: ProjectVersionSourceReference[];
}

export type ProjectVersionDiffCategory =
  | "project"
  | "story"
  | "composition"
  | "captions"
  | "graphicScenes"
  | "templates"
  | "audio"
  | "sources";

export interface ProjectVersionDiffEntry {
  category: ProjectVersionDiffCategory;
  key: string;
  change: "added" | "removed" | "changed";
  before?: unknown;
  after?: unknown;
}

export interface ProjectVersionDiff {
  pinChangedCount?: number;
  beforeVersionId: string;
  afterVersionId: string;
  entries: ProjectVersionDiffEntry[];
  summary: Record<
    ProjectVersionDiffCategory,
    { added: number; removed: number; changed: number }
  >;
}

export interface ProjectVersionDiffInput {
  versionId: string;
  project: OpenFilmProject;
  sourceReferences: ProjectVersionSourceReference[];
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

type Data = Record<string, unknown>;

function fail(path: string, message: string): never {
  throw new ProjectValidationError(path, message);
}

function object(value: unknown, path: string, fields: readonly string[]): Data {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Object.getOwnPropertySymbols(value).length
  )
    fail(path, "expected a plain JSON object");
  for (const [key, descriptor] of Object.entries(
    Object.getOwnPropertyDescriptors(value),
  )) {
    if (!fields.includes(key)) fail(`${path}.${key}`, "unknown field");
    if (!descriptor.enumerable || !("value" in descriptor))
      fail(`${path}.${key}`, "expected JSON data, not an accessor");
  }
  return value as Data;
}

function text(value: unknown, path: string, maximum = 256): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum)
    fail(path, `expected non-empty text of at most ${maximum} characters`);
  for (const character of value) {
    const point = character.codePointAt(0)!;
    if (point < 32 || point === 127 || (point >= 0xd800 && point <= 0xdfff))
      fail(path, "expected well-formed Unicode without control characters");
  }
  return value;
}

function uuid(value: unknown, path: string): string {
  const result = text(value, path, 36);
  if (!UUID_PATTERN.test(result)) fail(path, "expected a UUID");
  return result.toLowerCase();
}

function sha256(value: unknown, path: string): string {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value))
    fail(path, "expected a lowercase SHA-256 digest");
  return value;
}

function isoDate(value: unknown, path: string): string {
  const result = text(value, path, 40);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u.test(result) ||
    !Number.isFinite(Date.parse(result))
  )
    fail(path, "expected an ISO-8601 UTC timestamp");
  return result;
}

function validateSourceReference(
  value: unknown,
  path: string,
): ProjectVersionSourceReference {
  const data = object(value, path, [
    "assetId",
    "sha256",
    "sizeBytes",
    "mediaType",
    "kind",
  ]);
  const assetId = text(data.assetId, `${path}.assetId`);
  const sizeBytes = data.sizeBytes;
  if (
    typeof sizeBytes !== "number" ||
    !Number.isSafeInteger(sizeBytes) ||
    sizeBytes < 0
  )
    fail(`${path}.sizeBytes`, "expected a nonnegative safe integer");
  if (
    !["image", "video", "audio", "360-video"].includes(data.mediaType as string)
  )
    fail(`${path}.mediaType`, "unsupported media type");
  if (data.kind !== "managed" && data.kind !== "external")
    fail(`${path}.kind`, "expected managed or external source kind");
  return {
    assetId,
    sha256: sha256(data.sha256, `${path}.sha256`),
    sizeBytes,
    mediaType: data.mediaType as MediaType,
    kind: data.kind,
  };
}

/** Validate an index record without admitting local paths or unknown fields. */
export function validateProjectVersionRecord(
  value: unknown,
): ProjectVersionRecord {
  const data = object(value, "version", [
    "version",
    "id",
    "projectId",
    "name",
    "description",
    "createdAt",
    "parentVersionId",
    "requestId",
    "projectRevision",
    "projectHash",
    "catalogHash",
    "catalogSchemaVersion",
    "softwareVersion",
    "sourceReferences",
  ]);
  if (data.version !== PROJECT_VERSION_RECORD_VERSION)
    fail("version.version", "unsupported project version record version");
  const id = uuid(data.id, "version.id");
  const projectId = text(data.projectId, "version.projectId");
  const name = text(
    data.name,
    "version.name",
    PROJECT_VERSION_LIMITS.nameCharacters,
  );
  const description =
    data.description === undefined
      ? undefined
      : text(
          data.description,
          "version.description",
          PROJECT_VERSION_LIMITS.descriptionCharacters,
        );
  const parentVersionId =
    data.parentVersionId === undefined
      ? undefined
      : uuid(data.parentVersionId, "version.parentVersionId");
  if (parentVersionId === id)
    fail("version.parentVersionId", "a version cannot be its own parent");
  if (!Array.isArray(data.sourceReferences))
    fail("version.sourceReferences", "expected an array");
  if (data.sourceReferences.length > PROJECT_VERSION_LIMITS.sourceReferences)
    fail("version.sourceReferences", "too many source references");
  const sourceReferences = data.sourceReferences.map((source, index) =>
    validateSourceReference(source, `version.sourceReferences[${index}]`),
  );
  const ids = sourceReferences.map((source) => source.assetId);
  if (new Set(ids).size !== ids.length)
    fail("version.sourceReferences", "source asset IDs must be unique");
  if (ids.some((value, index) => index > 0 && value < ids[index - 1]!))
    fail(
      "version.sourceReferences",
      "source references must be sorted by asset ID",
    );
  if (
    typeof data.catalogSchemaVersion !== "number" ||
    !Number.isSafeInteger(data.catalogSchemaVersion) ||
    data.catalogSchemaVersion < 1
  )
    fail("version.catalogSchemaVersion", "expected a positive integer");

  return {
    version: PROJECT_VERSION_RECORD_VERSION,
    id,
    projectId,
    name,
    ...(description === undefined ? {} : { description }),
    createdAt: isoDate(data.createdAt, "version.createdAt"),
    ...(parentVersionId === undefined ? {} : { parentVersionId }),
    requestId: uuid(data.requestId, "version.requestId"),
    projectRevision: sha256(data.projectRevision, "version.projectRevision"),
    projectHash: sha256(data.projectHash, "version.projectHash"),
    catalogHash: sha256(data.catalogHash, "version.catalogHash"),
    catalogSchemaVersion: data.catalogSchemaVersion,
    softwareVersion: text(data.softwareVersion, "version.softwareVersion", 128),
    sourceReferences,
  };
}

/** Produce stable, privacy-safe source identity differences for the UI/API. */
export function diffProjectVersions(
  before: ProjectVersionDiffInput,
  after: ProjectVersionDiffInput,
): ProjectVersionDiff {
  type Entity = {
    category: ProjectVersionDiffCategory;
    key: string;
    value: unknown;
  };
  const key = (kind: string, ...ids: string[]) =>
    JSON.stringify([kind, ...ids]);
  const collect = (input: ProjectVersionDiffInput): Map<string, Entity> => {
    const entities = new Map<string, Entity>();
    const add = (
      category: ProjectVersionDiffCategory,
      key: string,
      value: unknown,
    ) => {
      entities.set(`${category}\0${key}`, { category, key, value });
    };
    const project = input.project;
    add("project", "project", {
      title: project.title,
      settings: project.settings,
      projectContentLocale: project.projectContentLocale,
      filmSettings: project.filmSettings,
    });
    add(
      "story",
      key("order", "stories"),
      project.stories.map((story) => story.id),
    );
    add(
      "composition",
      key("order", "compositions"),
      project.timelines.map((composition) => composition.id),
    );
    for (const story of project.stories) {
      const { beats, ...storyFields } = story;
      add("story", key("story", story.id), storyFields);
      add(
        "story",
        key("order", "beats", story.id),
        beats.map((beat) => beat.id),
      );
      for (const beat of beats)
        add("story", key("beat", story.id, beat.id), beat);
    }
    for (const composition of project.timelines) {
      const {
        tracks,
        captionTracks,
        graphicScenes,
        graphicSceneTemplates,
        ...compositionFields
      } = composition;
      add("composition", key("composition", composition.id), compositionFields);
      add(
        "composition",
        key("order", "tracks", composition.id),
        tracks.map((track) => track.id),
      );
      add(
        "captions",
        key("order", "captionTracks", composition.id),
        (captionTracks ?? []).map((track) => track.id),
      );
      add(
        "graphicScenes",
        key("order", "scenes", composition.id),
        (graphicScenes ?? []).map((scene) => scene.id),
      );
      add(
        "templates",
        key("order", "templates", composition.id),
        (graphicSceneTemplates ?? []).map((template) => [
          template.sceneId,
          template.templateId,
        ]),
      );
      for (const track of tracks) {
        const { clips, ...trackFields } = track;
        add("composition", key("track", composition.id, track.id), trackFields);
        add(
          track.type === "audio" || track.type === "music"
            ? "audio"
            : "composition",
          key("order", "clips", composition.id, track.id),
          clips.map((clip) => clip.id),
        );
        for (const clip of clips) {
          const clipKey = key("clip", composition.id, track.id, clip.id);
          const { audioAutomation, transform, ...clipFields } = clip;
          if (track.type === "audio" || track.type === "music") {
            add("audio", clipKey, clip);
          } else {
            add("composition", clipKey, {
              ...clipFields,
              ...(transform === undefined
                ? {}
                : {
                    transform: Object.fromEntries(
                      Object.entries(transform).filter(
                        ([field]) => field !== "volume",
                      ),
                    ),
                  }),
            });
            if (
              audioAutomation !== undefined ||
              transform?.volume !== undefined
            )
              add("audio", clipKey, {
                ...(transform?.volume === undefined
                  ? {}
                  : { volume: transform.volume }),
                ...(audioAutomation === undefined ? {} : { audioAutomation }),
              });
          }
        }
      }
      for (const track of captionTracks ?? []) {
        const { cues, ...trackFields } = track;
        add("captions", key("track", composition.id, track.id), trackFields);
        add(
          "captions",
          key("order", "cues", composition.id, track.id),
          cues.map((cue) => cue.id),
        );
        for (const cue of cues)
          add("captions", key("cue", composition.id, track.id, cue.id), cue);
      }
      for (const scene of graphicScenes ?? []) {
        const { nodes, ...sceneFields } = scene;
        add(
          "graphicScenes",
          key("scene", composition.id, scene.id),
          sceneFields,
        );
        add(
          "graphicScenes",
          key("order", "nodes", composition.id, scene.id),
          nodes.map((node) => node.id),
        );
        for (const node of nodes)
          add(
            "graphicScenes",
            key("node", composition.id, scene.id, node.id),
            node,
          );
      }
      for (const template of graphicSceneTemplates ?? [])
        add(
          "templates",
          key(
            "template",
            composition.id,
            template.sceneId,
            template.templateId,
          ),
          template,
        );
    }
    for (const source of input.sourceReferences)
      add("sources", source.assetId, source);
    return entities;
  };
  const canonical = (value: unknown): string => {
    if (value === null || typeof value !== "object")
      return JSON.stringify(value) ?? "null";
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    const data = value as Record<string, unknown>;
    return `{${Object.keys(data)
      .filter((key) => data[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(data[key])}`)
      .join(",")}}`;
  };
  const previous = collect(before);
  const next = collect(after);
  const entries: ProjectVersionDiffEntry[] = [];
  const categories: ProjectVersionDiffCategory[] = [
    "project",
    "story",
    "composition",
    "captions",
    "graphicScenes",
    "templates",
    "audio",
    "sources",
  ];
  const summary = Object.fromEntries(
    categories.map((category) => [
      category,
      { added: 0, removed: 0, changed: 0 },
    ]),
  ) as ProjectVersionDiff["summary"];
  const keys = new Set([...previous.keys(), ...next.keys()]);
  for (const entityKey of keys) {
    const oldValue = previous.get(entityKey);
    const newValue = next.get(entityKey);
    let change: ProjectVersionDiffEntry["change"] | undefined;
    if (!oldValue) change = "added";
    else if (!newValue) change = "removed";
    else if (canonical(oldValue.value) !== canonical(newValue.value))
      change = "changed";
    if (!change) continue;
    const entity = oldValue ?? newValue!;
    summary[entity.category][change] += 1;
    entries.push({
      category: entity.category,
      key: entity.key,
      change,
      ...(oldValue === undefined ? {} : { before: oldValue.value }),
      ...(newValue === undefined ? {} : { after: newValue.value }),
    });
  }
  entries.sort((left, right) => {
    const categoryOrder =
      categories.indexOf(left.category) - categories.indexOf(right.category);
    return (
      categoryOrder ||
      (left.key < right.key ? -1 : left.key > right.key ? 1 : 0)
    );
  });
  const pins = (project: OpenFilmProject) =>
    new Map(
      project.timelines.flatMap((c) => [
        ...c.tracks.flatMap((t) =>
          t.clips.map(
            (clip) =>
              [
                JSON.stringify([c.id, "clip", clip.id]),
                clip.userOverrides,
              ] as const,
          ),
        ),
        ...(c.graphicScenes ?? []).map(
          (scene) =>
            [
              JSON.stringify([c.id, "graphic-scene", scene.id]),
              scene.userOverrides,
            ] as const,
        ),
      ]),
    );
  const beforePins = pins(before.project),
    afterPins = pins(after.project);
  const pinChangedCount = [
    ...new Set([...beforePins.keys(), ...afterPins.keys()]),
  ].filter(
    (key) => canonical(beforePins.get(key)) !== canonical(afterPins.get(key)),
  ).length;
  return {
    pinChangedCount,
    beforeVersionId: before.versionId,
    afterVersionId: after.versionId,
    entries,
    summary,
  };
}
