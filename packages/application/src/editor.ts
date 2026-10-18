import { createHash } from "node:crypto";
import {
  validateProject,
  validatePhotoLayout,
  validatePhotoMotion,
  validateTitleStyle,
  resolveTitleStyle,
  validateAudioAutomation,
  MAX_TITLE_LENGTH,
  type MediaAsset,
} from "@openfilm/core";
import {
  applyTimelineCommand,
  type EditorDocument,
  type TimelineCommand,
} from "@openfilm/solver";
import type { OpenFilmApplication } from "./index.js";

export interface TimelineEditorState extends EditorDocument {
  assets: MediaAsset[];
  revision: string;
  /** Revision committed by the request ID being replayed, when this is a retry. */
  acknowledgedRevision?: string;
  canUndo: boolean;
  canRedo: boolean;
}

export interface TimelineEditInput {
  baseRevision: string;
  requestId?: string;
  commands: TimelineCommand[];
}

/** Status is usable by HTTP adapters without making the service depend on HTTP. */
export class TimelineEditorError extends Error {
  override name = "TimelineEditorError";

  constructor(
    message: string,
    readonly status: number = 400,
  ) {
    super(message);
  }
}

const HISTORY_LIMIT = 100;
const REQUEST_LIMIT = 200;
const COMMAND_LIMIT = 100;

interface History {
  revision: string;
  undo: EditorDocument[];
  redo: EditorDocument[];
}

type RecordValue = Record<string, unknown>;

function invalid(path: string, message: string): never {
  throw new TimelineEditorError(`${path}: ${message}`);
}

function record(value: unknown, path: string): RecordValue {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null) ||
    Object.getOwnPropertySymbols(value).length
  )
    invalid(path, "expected a JSON object");
  return value as RecordValue;
}

function keys(value: RecordValue, allowed: string[], path: string): void {
  for (const key of Object.keys(value))
    if (!allowed.includes(key)) invalid(`${path}.${key}`, "unknown field");
}

function nonempty(value: unknown, path: string, maximum = 256): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > maximum ||
    [...value].some((character) => character.charCodeAt(0) < 32)
  )
    invalid(
      path,
      `expected a nonempty string of at most ${maximum} characters`,
    );
  return value;
}

function finite(value: unknown, path: string, minimum = -Infinity): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum)
    invalid(path, `expected a finite number >= ${minimum}`);
  return value;
}

function positive(value: unknown, path: string): number {
  const result = finite(value, path, 0);
  if (result === 0) invalid(path, "expected a number greater than zero");
  return result;
}

function nested(
  value: unknown,
  path: string,
  validate: (value: unknown) => unknown,
): void {
  try {
    validate(value);
  } catch (error) {
    invalid(path, error instanceof Error ? error.message : String(error));
  }
}

function command(value: unknown, index: number): TimelineCommand {
  const path = `commands[${index}]`;
  const data = record(value, path);
  const type = nonempty(data.type, `${path}.type`);
  if (type === "beat" || type === "regenerate-beat")
    nonempty(data.beatId, `${path}.beatId`);
  else nonempty(data.clipId, `${path}.clipId`);
  const fields = [
    "type",
    type === "beat" || type === "regenerate-beat" ? "beatId" : "clipId",
  ];
  switch (type) {
    case "presentation": {
      const presentationFields = ["layout", "motion", "title", "titleStyle"];
      fields.push(...presentationFields);
      if (!presentationFields.some((field) => Object.hasOwn(data, field)))
        invalid(path, "provide a presentation field to change");
      for (const [field, validator] of [
        ["layout", validatePhotoLayout],
        ["motion", validatePhotoMotion],
        ["titleStyle", validateTitleStyle],
      ] as const)
        if (Object.hasOwn(data, field) && data[field] !== null)
          nested(data[field], `${path}.${field}`, validator);
      if (
        Object.hasOwn(data, "title") &&
        data.title !== null &&
        (typeof data.title !== "string" ||
          !data.title.trim() ||
          data.title.length > MAX_TITLE_LENGTH)
      )
        invalid(
          `${path}.title`,
          `expected nonempty text of at most ${MAX_TITLE_LENGTH} UTF-16 code units, or null to remove`,
        );
      break;
    }
    case "audio.add":
      fields.push(
        "assetId",
        "role",
        "timelineStart",
        "sourceIn",
        "sourceOut",
        "volume",
      );
      nonempty(data.assetId, `${path}.assetId`);
      nested(
        { version: 1, role: data.role },
        `${path}.role`,
        validateAudioAutomation,
      );
      finite(data.timelineStart, `${path}.timelineStart`, 0);
      finite(data.sourceIn, `${path}.sourceIn`, 0);
      if (
        positive(data.sourceOut, `${path}.sourceOut`) <= Number(data.sourceIn)
      )
        invalid(path, "sourceOut must be greater than sourceIn");
      if (
        Object.hasOwn(data, "volume") &&
        finite(data.volume, `${path}.volume`, 0) > 1
      )
        invalid(`${path}.volume`, "must be between 0 and 1");
      break;
    case "audio.configure":
      fields.push("automation");
      nested(data.automation, `${path}.automation`, validateAudioAutomation);
      break;
    case "audio.move":
      fields.push("timelineStart");
      finite(data.timelineStart, `${path}.timelineStart`, 0);
      break;
    case "clip.split":
      fields.push("sourceTime");
      finite(data.sourceTime, `${path}.sourceTime`, 0);
      break;
    case "trim":
      fields.push("sourceIn", "sourceOut");
      finite(data.sourceIn, `${path}.sourceIn`, 0);
      if (
        positive(data.sourceOut, `${path}.sourceOut`) <= Number(data.sourceIn)
      )
        invalid(path, "sourceOut must be greater than sourceIn");
      break;
    case "duration":
    case "speed":
      fields.push(type);
      positive(data[type], `${path}.${type}`);
      break;
    case "volume":
      fields.push("volume");
      if (finite(data.volume, `${path}.volume`, 0) > 1)
        invalid(`${path}.volume`, "must be between 0 and 1");
      break;
    case "transform": {
      const transforms = ["scale", "rotation", "x", "y"];
      fields.push(...transforms);
      if (!transforms.some((field) => Object.hasOwn(data, field)))
        invalid(path, "provide at least one transform field");
      for (const field of transforms)
        if (Object.hasOwn(data, field))
          (field === "scale" ? positive : finite)(
            data[field],
            `${path}.${field}`,
          );
      break;
    }
    case "transition":
      fields.push("transition", "duration");
      if (data.transition !== "cut" && data.transition !== "crossfade")
        invalid(`${path}.transition`, "expected cut or crossfade");
      if (Object.hasOwn(data, "duration"))
        positive(data.duration, `${path}.duration`);
      break;
    case "reorder":
      fields.push("toIndex");
      if (!Number.isInteger(finite(data.toIndex, `${path}.toIndex`, 0)))
        invalid(`${path}.toIndex`, "expected an integer");
      break;
    case "delete":
      break;
    case "replace":
      fields.push("assetId");
      nonempty(data.assetId, `${path}.assetId`);
      break;
    case "lock":
      fields.push("locked");
      if (typeof data.locked !== "boolean")
        invalid(`${path}.locked`, "expected a boolean");
      break;
    case "beat": {
      fields.push("patch");
      const patch = record(data.patch, `${path}.patch`);
      keys(
        patch,
        ["title", "intent", "targetDuration", "minDuration", "maxDuration"],
        `${path}.patch`,
      );
      if (!Object.keys(patch).length)
        invalid(`${path}.patch`, "must not be empty");
      for (const field of ["title", "intent"])
        if (
          Object.hasOwn(patch, field) &&
          (typeof patch[field] !== "string" ||
            (field === "title" && !patch[field].trim()) ||
            patch[field].length > 10000)
        )
          invalid(
            `${path}.patch.${field}`,
            `expected ${field === "title" ? "nonempty " : ""}text of at most 10000 characters`,
          );
      for (const field of ["targetDuration", "maxDuration"])
        if (Object.hasOwn(patch, field))
          positive(patch[field], `${path}.patch.${field}`);
      if (Object.hasOwn(patch, "minDuration"))
        finite(patch.minDuration, `${path}.patch.minDuration`, 0);
      break;
    }
    case "regenerate-beat":
      fields.push("mode");
      if (
        typeof data.mode !== "string" ||
        ![
          "regenerate",
          "shorten",
          "more-video",
          "more-photos",
          "replace-similar",
          "remove-repetition",
        ].includes(data.mode)
      )
        invalid(`${path}.mode`, "unknown regeneration mode");
      break;
    default:
      invalid(`${path}.type`, `unknown command ${type}`);
  }
  keys(data, fields, path);
  return structuredClone(data) as TimelineCommand;
}

function editInput(value: unknown): TimelineEditInput {
  const input = record(value, "edit");
  keys(input, ["baseRevision", "requestId", "commands"], "edit");
  const baseRevision = nonempty(input.baseRevision, "baseRevision");
  const requestId = Object.hasOwn(input, "requestId")
    ? nonempty(input.requestId, "requestId")
    : undefined;
  if (
    !Array.isArray(input.commands) ||
    !input.commands.length ||
    input.commands.length > COMMAND_LIMIT
  )
    invalid("commands", `expected between 1 and ${COMMAND_LIMIT} commands`);
  const commands: TimelineCommand[] = [];
  for (let i = 0; i < input.commands.length; i++)
    commands.push(command(input.commands[i], i));
  return {
    baseRevision,
    ...(requestId !== undefined ? { requestId } : {}),
    commands,
  };
}

function digest(value: unknown): string {
  const canonical = (entry: unknown): unknown => {
    if (Array.isArray(entry)) return entry.map(canonical);
    if (entry !== null && typeof entry === "object")
      return Object.fromEntries(
        Object.entries(entry)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, item]) => [key, canonical(item)]),
      );
    return entry;
  };
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}

function document(state: EditorDocument): EditorDocument {
  return structuredClone({
    composition: state.composition,
    story: state.story,
  });
}

/** One service per open project; history and retry records deliberately stay in memory. */
export class TimelineEditor {
  private readonly histories = new Map<string, History>();
  private readonly requests = new Map<
    string,
    { fingerprint: string; revision: string }
  >();
  private pending: Promise<void> = Promise.resolve();

  constructor(private readonly application: OpenFilmApplication) {}

  get(compositionId: string): TimelineEditorState {
    nonempty(compositionId, "compositionId");
    const composition = this.application.project.timelines.find(
      (item) => item.id === compositionId,
    );
    if (!composition)
      throw new TimelineEditorError(
        `Timeline not found: ${compositionId}`,
        404,
      );
    const story = this.application.project.stories.find(
      (item) => item.id === composition.storyId,
    );
    if (!story)
      throw new TimelineEditorError(
        `Timeline story not found: ${composition.storyId}`,
        404,
      );
    const ids = new Set([
      ...composition.tracks
        .filter((track) => track.type !== "titles")
        .flatMap((track) =>
          track.clips.flatMap((clip) => [
            clip.assetId,
            ...(clip.layout?.secondary ? [clip.layout.secondary.assetId] : []),
          ]),
        ),
      ...story.beats.flatMap((beat) => [
        ...(beat.candidateAssetIds ?? []),
        ...(beat.selectedAssetIds ?? []),
        ...(beat.constraints ?? []).flatMap((constraint) =>
          "assetIds" in constraint ? constraint.assetIds : [],
        ),
      ]),
    ]);
    const implicitPool = story.beats.some(
      (beat) => beat.candidateAssetIds === undefined,
    );
    for (const asset of this.application.catalog.iterateAssetSummaries())
      if (implicitPool || asset.state.locked || asset.mediaType === "audio")
        ids.add(asset.id);
    const assets = [...ids].sort().map((id) => {
      const asset = this.application.catalog.getAsset(id);
      if (!asset)
        throw new TimelineEditorError(
          `Timeline or story asset not found: ${id}`,
          404,
        );
      return asset;
    });
    const revision = digest({
      composition,
      story,
      assets: assets.map((asset) => {
        const {
          uri: _uri,
          name: _name,
          thumbnailUri: _thumbnail,
          proxyUri: _proxy,
          metadata,
          ...editing
        } = asset;
        const { "openfilm.reference": _reference, ...contentMetadata } =
          metadata;
        return { ...editing, metadata: contentMetadata };
      }),
    });
    const history = this.histories.get(compositionId);
    return structuredClone({
      composition,
      story,
      assets,
      revision,
      canUndo: history?.revision === revision && history.undo.length > 0,
      canRedo: history?.revision === revision && history.redo.length > 0,
    });
  }

  async edit(
    compositionId: string,
    input: TimelineEditInput,
  ): Promise<TimelineEditorState> {
    const parsed = editInput(input);
    nonempty(compositionId, "compositionId");
    return this.serialize(async () => {
      const fingerprint = digest({ compositionId, input: parsed });
      const receipt = parsed.requestId
        ? this.requests.get(parsed.requestId)
        : undefined;
      if (receipt) {
        if (receipt.fingerprint !== fingerprint)
          throw new TimelineEditorError(
            "requestId was already used for a different edit",
            409,
          );
        return {
          ...this.get(compositionId),
          acknowledgedRevision: receipt.revision,
        };
      }
      const before = this.current(compositionId, parsed.baseRevision);
      let next = document(before);
      const assets = [...before.assets];
      // Explicit edits may reference source media outside this story's candidate pool.
      for (const item of parsed.commands) {
        // Implicit font size depends on this composition's actual frame and
        // title role. Reject styles the shared resolver cannot consume before
        // applying any command in the batch; no font loading is necessary.
        if (item.type === "presentation" && item.titleStyle) {
          try {
            resolveTitleStyle(
              item.titleStyle,
              this.application.project.settings,
            );
          } catch (error) {
            throw new TimelineEditorError(
              error instanceof Error ? error.message : String(error),
            );
          }
        }
        // PhotoLayout's portable shape has no output dimensions. Validate its
        // effective gap against this project before any command is applied.
        if (
          item.type === "presentation" &&
          item.layout?.preset === "diptych" &&
          (item.layout.gap ?? 32) >= this.application.project.settings.width
        )
          throw new TimelineEditorError(
            "Photo diptych gap must be smaller than the composition width",
          );
        const referenced =
          item.type === "replace" || item.type === "audio.add"
            ? [item.assetId]
            : item.type === "presentation" && item.layout?.secondary
              ? [item.layout.secondary.assetId]
              : [];
        for (const assetId of referenced) {
          if (assets.some((asset) => asset.id === assetId)) continue;
          const source = this.application.catalog.getAsset(assetId);
          if (!source)
            throw new TimelineEditorError(
              `Edit source asset not found: ${assetId}`,
              404,
            );
          assets.push(source);
        }
      }
      try {
        for (const item of parsed.commands)
          next = applyTimelineCommand(next, assets, item);
      } catch (error) {
        throw new TimelineEditorError(
          error instanceof Error ? error.message : String(error),
        );
      }
      const history = this.history(compositionId, before.revision);
      const saved = await this.persist(compositionId, before, next, {
        undo: [...history.undo, document(before)].slice(-HISTORY_LIMIT),
        redo: [],
      });
      if (parsed.requestId) {
        this.requests.set(parsed.requestId, {
          fingerprint,
          revision: saved.revision,
        });
        if (this.requests.size > REQUEST_LIMIT)
          this.requests.delete(this.requests.keys().next().value!);
      }
      return saved;
    });
  }

  async undo(
    compositionId: string,
    baseRevision: string,
  ): Promise<TimelineEditorState> {
    return this.travel(compositionId, baseRevision, "undo");
  }

  async redo(
    compositionId: string,
    baseRevision: string,
  ): Promise<TimelineEditorState> {
    return this.travel(compositionId, baseRevision, "redo");
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(operation);
    this.pending = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private current(
    compositionId: string,
    baseRevision: string,
  ): TimelineEditorState {
    nonempty(baseRevision, "baseRevision");
    const state = this.get(compositionId);
    if (state.revision !== baseRevision)
      throw new TimelineEditorError(
        "Timeline changed since this edit began. Reload the saved timeline and reapply your changes.",
        409,
      );
    return state;
  }

  private history(compositionId: string, revision: string): History {
    const history = this.histories.get(compositionId);
    return history?.revision === revision
      ? history
      : { revision, undo: [], redo: [] };
  }

  private travel(
    compositionId: string,
    baseRevision: string,
    direction: "undo" | "redo",
  ): Promise<TimelineEditorState> {
    return this.serialize(async () => {
      const before = this.current(compositionId, baseRevision);
      const history = this.history(compositionId, before.revision);
      const next = history[direction].at(-1);
      if (!next) throw new TimelineEditorError(`Nothing to ${direction}`, 409);
      const opposite = direction === "undo" ? "redo" : "undo";
      return this.persist(compositionId, before, next, {
        ...history,
        [direction]: history[direction].slice(0, -1),
        [opposite]: [...history[opposite], document(before)].slice(
          -HISTORY_LIMIT,
        ),
      });
    });
  }

  private async persist(
    compositionId: string,
    before: TimelineEditorState,
    next: EditorDocument,
    history: Pick<History, "undo" | "redo">,
  ): Promise<TimelineEditorState> {
    if (
      next.composition.id !== compositionId ||
      next.story.id !== before.story.id ||
      next.composition.storyId !== before.story.id
    )
      throw new TimelineEditorError(
        "An edit cannot replace the selected timeline or story identity",
      );
    const previousProject = this.application.project;
    let candidate;
    try {
      candidate = validateProject({
        ...previousProject,
        stories: previousProject.stories.map((story) =>
          story.id === before.story.id ? next.story : story,
        ),
        timelines: previousProject.timelines.map((composition) =>
          composition.id === compositionId ? next.composition : composition,
        ),
      });
    } catch (error) {
      throw new TimelineEditorError(
        error instanceof Error ? error.message : String(error),
      );
    }
    this.application.project = candidate;
    try {
      await this.application.save();
    } catch (error) {
      this.application.project = previousProject;
      throw error;
    }
    const saved = this.get(compositionId);
    this.histories.set(compositionId, { ...history, revision: saved.revision });
    return {
      ...saved,
      canUndo: history.undo.length > 0,
      canRedo: history.redo.length > 0,
    };
  }
}
