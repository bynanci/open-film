// SPDX-License-Identifier: Apache-2.0
import {
  ApplicationError,
  PRESET_LIMITS,
  assertPresetJsonData,
  canonicalPresetJson,
  presetHash,
  presetRecord,
  presetText,
  resolveTitleStyle,
  validatePresetApplyInput,
  validatePresetSnapshot,
  type Composition,
  type OpenFilmProject,
  type PresetAcceptInput,
  type PresetApplicationReceipt,
  type PresetApplyInput,
  type PresetSelection,
  type PresetSnapshot,
  type StoryPlan,
} from "@openfilm/core";
import {
  applyTimelineCommand,
  type EditorDocument,
  type TimelineCommand,
} from "@openfilm/solver";
import type { OpenFilmApplication } from "./index.js";
import type { TimelineEditor, TimelineEditorState } from "./editor.js";
import { LocalPresetRegistry } from "./local-preset-registry.js";
import {
  assertPresetSnapshotIntegrity,
  assertProjectPresetIntegrity,
  hashPresetData,
} from "./preset-integrity.js";
export interface PresetApplyReview {
  version: 1;
  request: PresetApplyInput;
  snapshot: PresetSnapshot;
  reviewSha256: string;
  commands: TimelineCommand[];
  document?: EditorDocument;
  plan?: StoryPlan;
  compositionPreview?: Composition;
  warnings: string[];
  conflicts: string[];
}
export interface PresetAcceptance {
  version: 1;
  receipt: PresetApplicationReceipt;
  alreadyAccepted: boolean;
  state?: TimelineEditorState;
  result: { storyId: string; compositionId: string };
}
const canonicalModel = (value: unknown) =>
  canonicalPresetJson(JSON.parse(JSON.stringify(value)));
export const presetRequestHash = (input: PresetApplyInput) =>
  hashPresetData(canonicalPresetJson(input));
export function validatePresetAcceptance(value: unknown): PresetAcceptInput {
  assertPresetJsonData(value);
  const r = presetRecord(value, "accept", [
    "request",
    "reviewSha256",
    "requestId",
  ]);
  presetHash(r.reviewSha256, "accept.reviewSha256");
  presetText(r.requestId, "accept.requestId");
  return {
    request: validatePresetApplyInput(r.request),
    reviewSha256: r.reviewSha256 as string,
    requestId: r.requestId as string,
  };
}
export class PresetApplicationService {
  constructor(
    private readonly app: OpenFilmApplication,
    readonly registry: LocalPresetRegistry,
    private readonly publishProject: (next: OpenFilmProject) => void,
  ) {}
  accepted(
    input: PresetAcceptInput,
    editor: TimelineEditor,
  ): PresetAcceptance | undefined {
    const prior = this.app.project.presetApplicationReceipts?.find(
      (r) => r.requestId === input.requestId,
    );
    if (!prior) return undefined;
    if (
      prior.projectId !== this.app.project.id ||
      prior.requestSha256 !== presetRequestHash(input.request) ||
      prior.reviewSha256 !== input.reviewSha256
    )
      throw new ApplicationError(
        "presets.conflict",
        "This preset request ID was already used with different content.",
        409,
      );
    const exists = this.app.project.timelines.some(
      (c) => c.id === prior.result.compositionId,
    );
    return {
      version: 1,
      receipt: structuredClone(prior),
      alreadyAccepted: true,
      result: structuredClone(prior.result),
      ...(exists ? { state: editor.get(prior.result.compositionId) } : {}),
    };
  }
  review(value: PresetApplyInput, editor: TimelineEditor): PresetApplyReview {
    const input = validatePresetApplyInput(value);
    if (input.projectId !== this.app.project.id)
      throw new ApplicationError(
        "presets.stale",
        "This review belongs to another project.",
        409,
      );
    const snapshot = this.registry.snapshot(input.selection);
    assertPresetSnapshotIntegrity(snapshot);
    if (snapshot.kind !== input.target.kind)
      throw new ApplicationError(
        "presets.invalid",
        "The preset kind does not match its target.",
      );
    if (input.target.kind === "story")
      return this.reviewStory(input, snapshot as PresetSnapshot<"story">);
    const target = input.target,
      state = editor.get(target.compositionId);
    if (state.revision !== input.baseRevision)
      throw new ApplicationError(
        "presets.stale",
        "The selected film changed; review the preset again.",
        409,
      );
    let commands: TimelineCommand[];
    if (target.kind === "film-look") {
      const look = {
        version: 2 as const,
        preset: "local" as const,
        strength:
          target.strength ??
          (snapshot as PresetSnapshot<"film-look">).recipe.defaultStrength,
        snapshot: validatePresetSnapshot(snapshot, "film-look"),
      };
      commands = [
        target.scope === "film"
          ? { type: "look", scope: "film", look }
          : target.scope === "beat"
            ? { type: "look", scope: "beat", beatId: target.beatId, look }
            : { type: "look", scope: "clip", clipId: target.clipId, look },
      ];
    } else {
      const title = validatePresetSnapshot(snapshot, "title");
      resolveTitleStyle(title.recipe, this.app.project.settings);
      commands = [
        {
          type: "presentation",
          clipId: target.clipId,
          titleStyle: title.recipe,
          titlePresetSnapshot: title,
        },
      ];
    }
    let document: EditorDocument = {
      composition: structuredClone(state.composition),
      story: structuredClone(state.story),
    };
    for (const command of commands)
      document = applyTimelineCommand(document, state.assets, command);
    const reviewSha256 = hashPresetData(
      canonicalModel({
        request: input,
        snapshotSha256: snapshot.snapshotSha256,
        document,
        settings: this.app.project.settings,
      }),
    );
    return {
      version: 1,
      request: input,
      snapshot,
      reviewSha256,
      commands,
      document,
      warnings: [],
      conflicts: [],
    };
  }
  private reviewStory(
    input: PresetApplyInput,
    snapshot: PresetSnapshot<"story">,
  ): PresetApplyReview {
    if (input.target.kind !== "story")
      throw new ApplicationError(
        "presets.invalid",
        "Choose an authored story target.",
      );
    if (input.baseRevision !== this.app.versions.currentRevision())
      throw new ApplicationError(
        "presets.stale",
        "Story sources or project changed; review again.",
        409,
      );
    const { plan, compositionPreview } = this.app.storyPlan.previewPresetPlan(
      input.target.storyId,
      snapshot,
      input.target.bindings,
      input.target.options,
    );
    const reviewSha256 = hashPresetData(
      canonicalModel({ request: input, plan }),
    );
    const locale = this.app.project.projectContentLocale ?? "en-US";
    return {
      version: 1,
      request: input,
      snapshot,
      reviewSha256,
      commands: [],
      plan,
      compositionPreview,
      warnings: snapshot.recipe.beats.some((b) => !b.text[locale])
        ? ["presets.localeFallback"]
        : [],
      conflicts: [],
    };
  }
  async accept(
    value: PresetAcceptInput,
    editor: TimelineEditor,
    signal?: AbortSignal,
  ): Promise<PresetAcceptance> {
    signal?.throwIfAborted();
    const input = validatePresetAcceptance(value);
    const prior = this.accepted(input, editor);
    if (prior) return prior;
    if (input.request.target.kind === "story") {
      const review = this.review(input.request, editor);
      if (
        !review.plan ||
        review.reviewSha256 !== input.reviewSha256 ||
        review.conflicts.length
      )
        throw new ApplicationError(
          "presets.stale",
          "The exact authored preset review changed.",
          409,
        );
      const target = input.request.target;
      this.registry.withSelection(input.request.selection, () => {
        const receipt = this.receipt(
          input,
          review,
          { storyId: target.storyId, compositionId: "pending" },
          "0".repeat(64),
        );
        this.app.storyPlan.acceptPresetPlan(
          target.storyId,
          review.plan!,
          receipt,
        );
      });
      const accepted = this.accepted(input, editor);
      if (!accepted)
        throw new ApplicationError(
          "operation.failed",
          "Preset acceptance did not publish its receipt.",
        );
      return { ...accepted, alreadyAccepted: false };
    }
    return editor.acceptPresetApplication(
      input.request.target.compositionId,
      input,
      signal,
    );
  }
  receipt(
    input: PresetAcceptInput,
    review: PresetApplyReview,
    result: { storyId: string; compositionId: string },
    acceptedRevision: string,
  ): PresetApplicationReceipt {
    return {
      version: 1,
      projectId: this.app.project.id,
      requestId: input.requestId,
      requestSha256: presetRequestHash(input.request),
      reviewSha256: review.reviewSha256,
      kind: review.snapshot.kind,
      canonicalId: review.snapshot.canonicalId,
      packageSha256: review.snapshot.packageSha256,
      snapshotSha256: review.snapshot.snapshotSha256,
      result,
      acceptedRevision,
      acceptedAt: new Date().toISOString(),
    };
  }
  commit(next: OpenFilmProject, selection: PresetSelection): void {
    assertProjectPresetIntegrity(next);
    this.registry.withSelection(selection, () => this.publishProject(next));
  }
  appendReceipt(
    project: OpenFilmProject,
    receipt: PresetApplicationReceipt,
  ): PresetApplicationReceipt[] {
    return [...(project.presetApplicationReceipts ?? []), receipt].slice(
      -PRESET_LIMITS.receipts,
    );
  }
}
