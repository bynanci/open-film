// Modified by OpenFilm contributors on 2026-10-18. Preexisting portions retain
// Apache-2.0 grants; current OpenFilm first-party code is Apache-2.0. See LICENSE/NOTICE.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ApplicationError,
  validateProject,
  validatePhotoLayout,
  validatePhotoMotion,
  validateTitleStyle,
  resolveTitleStyle,
  validateAudioAutomation,
  validateFilmLook,
  MAX_TITLE_LENGTH,
  MAX_SCENE_DIRECTION_RECEIPTS,
  isCaptionTextValid,
  assetDisplayDimensions,
  resolvePhotoPlan,
  type MediaAsset,
  type SceneDirectionReceipt,
  type SceneDirectionReceiptAction,
} from "@openfilm/core";
import {
  applyTimelineCommand,
  prepareSceneDirection,
  type EditorDocument,
  type SceneDirectionOptions,
  type TimelineCommand,
} from "@openfilm/solver";
import type { OpenFilmApplication } from "./index.js";
import type {
  DirectionAcceptanceInput,
  DirectionReviewPlan,
} from "./scene-direction.js";

export type {
  DirectionAcceptanceInput,
  DirectionReviewAcceptance,
  DirectionReviewPlan,
  SceneDirectionOptions,
} from "./scene-direction.js";

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
  if (type === "look") {
    const scope = data.scope;
    if (scope !== "film" && scope !== "beat" && scope !== "clip")
      invalid(`${path}.scope`, "expected film, beat or clip");
    const allowed = ["type", "scope", "look"];
    if (scope === "beat" || scope === "clip") {
      const identity = scope === "beat" ? "beatId" : "clipId";
      nonempty(data[identity], `${path}.${identity}`);
      allowed.push(identity);
    }
    keys(data, allowed, path);
    if (data.look !== null) nested(data.look, `${path}.look`, validateFilmLook);
    return structuredClone(data) as TimelineCommand;
  }
  if (type.startsWith("caption.")) {
    switch (type) {
      case "caption.track.add":
        keys(data, ["type", "track"], path);
        record(data.track, `${path}.track`);
        break;
      case "caption.track.remove":
        keys(data, ["type", "trackId"], path);
        nonempty(data.trackId, `${path}.trackId`);
        break;
      case "caption.track.style": {
        keys(data, ["type", "trackId", "style"], path);
        nonempty(data.trackId, `${path}.trackId`);
        nested(data.style, `${path}.style`, validateTitleStyle);
        if ((data.style as RecordValue).role !== "subtitle")
          invalid(
            `${path}.style.role`,
            "caption tracks require the subtitle role",
          );
        break;
      }
      case "caption.cue.add":
        keys(data, ["type", "trackId", "cue"], path);
        nonempty(data.trackId, `${path}.trackId`);
        record(data.cue, `${path}.cue`);
        break;
      case "caption.cue.update": {
        keys(data, ["type", "trackId", "cueId", "patch"], path);
        nonempty(data.trackId, `${path}.trackId`);
        nonempty(data.cueId, `${path}.cueId`);
        const patch = record(data.patch, `${path}.patch`);
        keys(patch, ["text", "startMs", "endMs"], `${path}.patch`);
        if (!Object.keys(patch).length)
          invalid(`${path}.patch`, "provide text, startMs or endMs");
        if (
          Object.hasOwn(patch, "text") &&
          (typeof patch.text !== "string" ||
            !patch.text.trim() ||
            !isCaptionTextValid(patch.text))
        )
          invalid(`${path}.patch.text`, "expected safe non-empty caption text");
        for (const field of ["startMs", "endMs"])
          if (
            Object.hasOwn(patch, field) &&
            !Number.isSafeInteger(
              finite(patch[field], `${path}.patch.${field}`, 0),
            )
          )
            invalid(`${path}.patch.${field}`, "expected integer milliseconds");
        break;
      }
      case "caption.cue.delete":
        keys(data, ["type", "trackId", "cueId"], path);
        nonempty(data.trackId, `${path}.trackId`);
        nonempty(data.cueId, `${path}.cueId`);
        break;
      default:
        invalid(`${path}.type`, `unknown command ${type}`);
    }
    return structuredClone(data) as TimelineCommand;
  }
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

function revisionFor(state: EditorDocument, assets: MediaAsset[]): string {
  return digest({
    composition: state.composition,
    story: state.story,
    assets: assets.map((asset) => {
      const {
        uri: _uri,
        name: _name,
        thumbnailUri: _thumbnail,
        proxyUri: _proxy,
        metadata,
        ...editing
      } = asset;
      const { "openfilm.reference": _reference, ...contentMetadata } = metadata;
      return { ...editing, metadata: contentMetadata };
    }),
  });
}

function directionOptions(value: unknown): SceneDirectionOptions {
  const data = record(value, "options");
  keys(data, ["beatId", "clipIds", "replaceExisting"], "options");
  if (typeof data.beatId !== "string" || !data.beatId.trim())
    invalid("options.beatId", "expected a nonempty scene ID");
  if (
    !Array.isArray(data.clipIds) ||
    !data.clipIds.length ||
    data.clipIds.length > 50
  )
    invalid("options.clipIds", "expected between 1 and 50 clip IDs");
  const clipIds = new Set<string>();
  for (let index = 0; index < data.clipIds.length; index++) {
    const id = data.clipIds[index];
    if (typeof id !== "string" || !id.trim())
      invalid(`options.clipIds[${index}]`, "expected a nonempty clip ID");
    if (clipIds.has(id)) invalid("options.clipIds", "duplicate clip ID");
    clipIds.add(id);
  }
  if (
    Object.hasOwn(data, "replaceExisting") &&
    typeof data.replaceExisting !== "boolean"
  )
    invalid("options.replaceExisting", "expected a boolean");
  // The compiler also validates target membership and the complete option shape.
  return structuredClone(data) as unknown as SceneDirectionOptions;
}

function directionAcceptance(value: unknown): DirectionAcceptanceInput {
  const data = record(value, "direction");
  keys(
    data,
    [
      "planId",
      "baseRevision",
      "contextSignature",
      "options",
      "actionIds",
      "requestId",
    ],
    "direction",
  );
  for (const field of ["planId", "baseRevision", "contextSignature"])
    if (typeof data[field] !== "string" || !/^[a-f0-9]{64}$/.test(data[field]))
      invalid(field, "expected a SHA-256 signature");
  const requestId = nonempty(data.requestId, "requestId");
  for (const character of requestId) {
    const point = character.codePointAt(0)!;
    if ((point >= 127 && point <= 159) || (point >= 0xd800 && point <= 0xdfff))
      invalid(
        "requestId",
        "expected well-formed Unicode without control characters",
      );
  }
  if (
    !Array.isArray(data.actionIds) ||
    !data.actionIds.length ||
    data.actionIds.length > COMMAND_LIMIT
  )
    invalid("actionIds", `expected between 1 and ${COMMAND_LIMIT} action IDs`);
  const actionIds: string[] = [];
  for (let index = 0; index < data.actionIds.length; index++) {
    const id = data.actionIds[index];
    // Clip IDs are opaque project identities, including in `${clipId}:${kind}`.
    if (typeof id !== "string" || !id.trim())
      invalid(`actionIds[${index}]`, "expected a nonempty action ID");
    if (actionIds.includes(id)) invalid("actionIds", "duplicate action ID");
    actionIds.push(id);
  }
  return {
    planId: data.planId as string,
    baseRevision: data.baseRevision as string,
    contextSignature: data.contextSignature as string,
    options: directionOptions(data.options),
    actionIds,
    requestId,
  };
}

/** History and generic edit retries stay in memory; direction receipts are durable. */
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
    const revision = revisionFor({ composition, story }, assets);
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

  previewDirection(
    compositionId: string,
    options: SceneDirectionOptions,
  ): DirectionReviewPlan {
    const state = this.get(compositionId);
    // Passive export sessions resolve moved managed sources without repairing
    // the catalog. Bind the preview to the same source metadata that a later
    // workspace open repairs, while leaving generic editor reads untouched.
    const assets = state.assets.map((asset) => {
      const effective = this.application.getSourceAsset(asset.id);
      if (!effective || effective.uri === asset.uri) return asset;
      return {
        ...asset,
        uri: effective.uri,
        metadata: {
          ...asset.metadata,
          "openfilm.managedSource": {
            ...(asset.metadata["openfilm.managedSource"] as Record<
              string,
              unknown
            >),
            uri: effective.uri,
          },
        },
      };
    });
    const before = { ...state, assets, revision: revisionFor(state, assets) };
    const parsed = directionOptions(options);
    const maximums = [
      before.story.maxDuration,
      this.application.project.filmSettings?.maxDuration,
    ].filter((value): value is number => value !== undefined);
    const maxDuration = maximums.length ? Math.min(...maximums) : undefined;
    let proposal;
    try {
      proposal = prepareSceneDirection(
        document(before),
        before.assets,
        parsed,
        {
          settings: this.application.project.settings,
          ...(maxDuration !== undefined ? { maxDuration } : {}),
        },
      );
    } catch (error) {
      throw new TimelineEditorError(
        error instanceof Error ? error.message : String(error),
      );
    }
    if (proposal.actions.length > COMMAND_LIMIT)
      invalid(
        "actions",
        `at most ${COMMAND_LIMIT} direction actions are supported`,
      );
    const contextSignature = digest({
      recipe: "openfilm.scene-direction-review",
      version: proposal.version,
      projectId: this.application.project.id,
      projectDirectory: digest(this.application.directory),
      compositionId,
      baseRevision: before.revision,
      settings: this.application.project.settings,
      filmSettings: this.application.project.filmSettings,
      maxDuration,
      locale: this.application.project.projectContentLocale ?? "en-US",
      sourceText: proposal.sourceText,
      options: parsed,
    });
    const preview = this.simulateDirection(
      before,
      parsed,
      proposal.actions,
      maxDuration,
    );
    return structuredClone({
      ...proposal,
      id: digest({
        compositionId,
        storyId: before.story.id,
        baseRevision: before.revision,
        contextSignature,
        options: parsed,
        proposal,
      }),
      compositionId,
      storyId: before.story.id,
      baseRevision: before.revision,
      contextSignature,
      options: parsed,
      preview,
    });
  }

  async acceptDirection(
    compositionId: string,
    input: DirectionAcceptanceInput,
  ): Promise<TimelineEditorState> {
    const parsed = directionAcceptance(input);
    nonempty(compositionId, "compositionId");
    return this.serialize(async () => {
      const fingerprint = digest({ compositionId, input: parsed });
      const receipts = this.application.project.sceneDirectionReceipts ?? [];
      const receipt = receipts.find(
        (item) => item.requestId === parsed.requestId,
      );
      if (receipt) {
        if (
          receipt.fingerprint !== fingerprint ||
          receipt.compositionId !== compositionId
        )
          throw new TimelineEditorError(
            "This direction requestId was already accepted with different evidence or actions",
            409,
          );
        return this.application.catalog.withProjectWrite(() => {
          let saved;
          try {
            saved = validateProject(
              JSON.parse(
                readFileSync(
                  join(this.application.directory, "project.json"),
                  "utf8",
                ),
              ),
            );
          } catch {
            throw new ApplicationError(
              "story.planConflict",
              "The saved project could not be verified. Reopen it before retrying direction acceptance.",
              409,
            );
          }
          if (digest(saved) !== digest(this.application.project))
            throw new ApplicationError(
              "story.planConflict",
              "The saved project changed. Reopen it before retrying direction acceptance.",
              409,
            );
          return {
            ...this.get(compositionId),
            acknowledgedRevision: receipt.acceptedRevision,
          };
        });
      }
      const before = this.current(compositionId, parsed.baseRevision);
      let plan: DirectionReviewPlan;
      try {
        plan = this.previewDirection(compositionId, parsed.options);
      } catch (error) {
        throw new TimelineEditorError(
          `The saved direction review can no longer be applied: ${error instanceof Error ? error.message : String(error)}`,
          409,
        );
      }
      if (
        plan.id !== parsed.planId ||
        plan.contextSignature !== parsed.contextSignature
      )
        throw new TimelineEditorError(
          "Scene direction changed since this preview. Prepare a new direction review.",
          409,
        );
      const selected = parsed.actionIds.map((id) => {
        const action = plan.actions.find((item) => item.id === id);
        if (!action)
          throw new TimelineEditorError(
            "The direction review does not contain a selected action",
            409,
          );
        return action;
      });
      if (receipts.length >= MAX_SCENE_DIRECTION_RECEIPTS)
        throw new TimelineEditorError(
          "The project has reached its direction acceptance receipt capacity",
          409,
        );
      const maximums = [
        before.story.maxDuration,
        this.application.project.filmSettings?.maxDuration,
      ].filter((value): value is number => value !== undefined);
      const maxDuration = maximums.length ? Math.min(...maximums) : undefined;
      const next = this.simulateDirection(
        before,
        plan.options,
        selected,
        maxDuration,
      );
      const history = this.history(compositionId, before.revision);
      return this.persist(
        compositionId,
        before,
        next,
        {
          undo: [...history.undo, document(before)].slice(-HISTORY_LIMIT),
          redo: [],
        },
        {
          version: 1,
          planId: plan.id,
          requestId: parsed.requestId,
          fingerprint,
          compositionId,
          storyId: before.story.id,
          beatId: plan.beatId,
          baseRevision: before.revision,
          contextSignature: plan.contextSignature,
          acceptedAt: new Date().toISOString(),
          acceptedRevision: revisionFor(next, before.assets),
          sourceText: plan.sourceText,
          actions: structuredClone(selected) as SceneDirectionReceiptAction[],
        },
      );
    });
  }

  private simulateDirection(
    before: TimelineEditorState,
    options: SceneDirectionOptions,
    actions: DirectionReviewPlan["actions"],
    maxDuration?: number,
  ): EditorDocument {
    let next = document(before);
    const allowed = new Map<string, Set<"layout" | "motion">>();
    try {
      for (let index = 0; index < actions.length; index++) {
        const action = actions[index]!;
        if (!options.clipIds.includes(action.clipId))
          throw new Error(
            "Direction actions must target explicitly selected clips",
          );
        const clip = before.composition.tracks
          .flatMap((track) => track.clips)
          .find((clip) => clip.id === action.clipId);
        if (!clip || clip.beatId !== options.beatId)
          throw new Error("Direction action targets a different scene");
        const compiled = structuredClone(action.command);
        if (
          compiled.type !== "presentation" ||
          compiled.clipId !== action.clipId ||
          Object.keys(compiled).some(
            (key) => !["type", "clipId", action.kind].includes(key),
          ) ||
          !Object.hasOwn(compiled, action.kind) ||
          digest(compiled[action.kind]) !== digest(action.after)
        )
          throw new Error(
            "Direction action must contain only its reviewed presentation field",
          );
        (action.kind === "layout" ? validatePhotoLayout : validatePhotoMotion)(
          compiled[action.kind],
        );
        const fields =
          allowed.get(action.clipId) ?? new Set<"layout" | "motion">();
        fields.add(action.kind);
        allowed.set(action.clipId, fields);
        next = applyTimelineCommand(next, before.assets, compiled);
      }
      const sources = Object.fromEntries(
        before.assets.flatMap((asset) => {
          const dimensions = assetDisplayDimensions(asset);
          return dimensions ? [[asset.id, dimensions]] : [];
        }),
      );
      for (const clip of next.composition.tracks.flatMap(
        (track) => track.clips,
      )) {
        if (!allowed.has(clip.id)) continue;
        const warnings = resolvePhotoPlan(
          clip,
          sources,
          this.application.project.settings,
        ).warnings;
        if (warnings.length)
          throw new Error(
            `The selected direction actions require unsafe presentation fallback: ${warnings.join("; ")}`,
          );
      }
      const invariant = (value: EditorDocument) => ({
        story: value.story,
        composition: {
          ...value.composition,
          tracks: value.composition.tracks.map((track) => ({
            ...track,
            clips: track.clips.map((clip) => {
              const copy = { ...clip };
              for (const field of allowed.get(clip.id) ?? [])
                delete copy[field];
              return copy;
            }),
          })),
        },
      });
      if (digest(invariant(next)) !== digest(invariant(before)))
        throw new Error(
          "Direction changes cannot alter timing, story, or unreviewed clip fields",
        );
      if (
        actions.length &&
        maxDuration !== undefined &&
        next.composition.duration > maxDuration + 1e-7
      )
        throw new Error("Direction changes exceed the film maximum duration");
      return next;
    } catch (error) {
      throw new TimelineEditorError(
        error instanceof Error ? error.message : String(error),
        409,
      );
    }
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
        if (error instanceof ApplicationError) throw error;
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
    directionReceipt?: SceneDirectionReceipt,
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
        ...(directionReceipt
          ? {
              sceneDirectionReceipts: [
                ...(previousProject.sceneDirectionReceipts ?? []),
                directionReceipt,
              ],
            }
          : {}),
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
      // A failure after manifest publication retains the application's old
      // save baseline. Its CAS guard requires reopening; the durable direction
      // receipt then acknowledges an exact retry without applying again.
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
