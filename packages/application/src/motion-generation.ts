// SPDX-License-Identifier: Apache-2.0
import { randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  writeFile,
  rename,
  rm,
  readdir,
  realpath,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type {
  Clip,
  GraphicScene,
  GraphicSceneTemplateRecord,
  MediaAsset,
} from "@openfilm/core";
import { graphicSceneAssetIds } from "@openfilm/core";
import { ProviderRegistry } from "@openfilm/analysis";
import type { MotionGenerationProvider } from "@openfilm/plugin-sdk";
import {
  applyTimelineCommand,
  type TimelineCommand,
  type EditorDocument,
} from "@openfilm/solver";
import { checkAbort, hashFile, safeProjectCachePath } from "@openfilm/media";
import type { OpenFilmApplication } from "./index.js";
import {
  TimelineEditor,
  TimelineEditorError,
  type TimelineEditorState,
} from "./editor.js";
import { cancellableProviderResult } from "./cancellable-provider-result.js";
import { localMotionFixture, localMotionImport } from "./motion-provider.js";
import {
  MOTION_BYTES,
  motionDigest,
  bytesHash,
  readMotionAsset,
  validateMotionPhoto,
  normalizeMotion,
  type MotionOutputProof,
} from "./motion-media.js";
const uuid =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
function fail(message: string, status = 409): never {
  throw new TimelineEditorError(message, status);
}
const document = (state: TimelineEditorState): EditorDocument => ({
  composition: state.composition,
  story: state.story,
});
const docHash = (state: EditorDocument) =>
  motionDigest(document(state as TimelineEditorState));
export interface MotionRequest {
  requestId: string;
  projectId: string;
  compositionId: string;
  clipId: string;
  sceneId?: string | null;
  baseRevision: string;
  providerId: string;
  count?: number;
  candidateAssetIds?: string[];
  prompt: string;
  negativeConstraints: string;
  consent: boolean;
  containsPeople: boolean;
}
export interface MotionGenerationReceipt {
  version: 1;
  id: string;
  requestId: string;
  projectId: string;
  compositionId: string;
  clipId: string;
  sceneId: string | null;
  assetId: string;
  sourceSha256: string;
  baseRevision: string;
  promptSha256: string;
  negativeConstraintsSha256: string;
  providerId: string;
  model: string;
  mock: boolean;
  origin: "fixture" | "external-import";
  sourceRelation: "camera-derived-original" | "user-declared-external";
  estimatedCostUsd: number | null;
  costStatus: "free-fixture" | "external-cost-unknown";
  outputSha256: string;
  output: MotionOutputProof;
  inputAssetId?: string;
  inputSha256?: string;
  state:
    "preview" | "accepted" | "prepared" | "imported" | "restored" | "revoked";
  consentAt: string;
  createdAt: string;
  containsPeople: boolean;
  deformationCheck: "manual-required" | "user-reviewed-not-guaranteed";
}
interface RecordData {
  version: 1;
  receipt: MotionGenerationReceipt;
  settings: string;
  sourceLocation: string;
  inputLocation?: string;
  originalClip: Clip;
  originalScene?: GraphicScene;
  originalTemplate?: GraphicSceneTemplateRecord;
  commands?: TimelineCommand[];
  importRevision?: string;
  expectedDocument?: string;
  importedAssetId?: string;
  restoredDocument?: string;
}
interface Batch {
  version: 1;
  projectId: string;
  fingerprint: string;
  status: "pending" | "ready" | "revoked" | "cancelled";
  ids: string[];
}
export class MotionGenerationService {
  private registry = new ProviderRegistry();
  private running = new Map<
    string,
    {
      fingerprint: string;
      controller: AbortController;
      work: Promise<MotionGenerationReceipt[]>;
    }
  >();
  private owned = new Set<string>();
  private closed = false;
  private disposal?: Promise<void>;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly app: OpenFilmApplication,
    provider?: MotionGenerationProvider,
    private readonly timeoutMs = 300000,
  ) {
    this.registry.register(localMotionFixture);
    this.registry.register(localMotionImport);
    if (provider) this.registry.register(provider);
  }
  hasRequest(id: string) {
    return this.running.has(id);
  }
  list() {
    return this.registry
      .list()
      .filter((p) => p.kind === "motion-generation")
      .map((p) => ({
        ...p,
        ...(p.endpoint
          ? {
              endpoint:
                new URL(p.endpoint).origin + new URL(p.endpoint).pathname,
            }
          : {}),
        available: p.execution === "local",
        disabledReason:
          p.execution === "remote" ? "unverified-remote-adapter" : null,
        estimatedCostUsd: p.id === localMotionFixture.id ? 0 : null,
        retention:
          p.execution === "local"
            ? "project-private; previews expire after 24 hours or explicit revoke"
            : "unknown; disabled",
      }));
  }
  private async path(
    kind: "motion-candidates" | "motion-receipts" | "motion-batches",
    id: string,
    filename?: string,
  ) {
    if (!uuid.test(id)) fail("Invalid motion identity.", 400);
    const path = await safeProjectCachePath(
      this.app.directory,
      kind,
      ...(filename ? [id, filename] : [`${id}.json`]),
    );
    await chmod(dirname(path), 0o700);
    return path;
  }
  private async read<T>(path: string, limit = 262144): Promise<T> {
    const info = await lstat(path);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.nlink !== 1 ||
      info.size > limit
    )
      fail("Unsafe motion record.");
    return JSON.parse(await readFile(path, "utf8")) as T;
  }
  private async write(path: string, data: unknown) {
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(data), {
        flag: "wx",
        mode: 0o600,
      });
      await rename(temporary, path);
    } finally {
      await rm(temporary, { force: true });
    }
  }
  private async record(id: string): Promise<RecordData> {
    const value = await this.read<RecordData>(
      await this.path("motion-receipts", id),
    );
    if (
      value.version !== 1 ||
      value.receipt?.version !== 1 ||
      value.receipt.id !== id ||
      value.receipt.projectId !== this.app.project.id ||
      value.originalClip?.id !== value.receipt.clipId
    )
      fail("Motion receipt does not belong to this target.");
    return value;
  }
  async receipt(id: string) {
    return structuredClone((await this.record(id)).receipt);
  }
  private async saved(
    compositionId: string,
    revision: string,
    settings: string,
  ) {
    if (this.closed) fail("Motion owner closed.");
    const state = new TimelineEditor(this.app).get(compositionId);
    const diskPath = join(this.app.directory, "project.json");
    const info = await lstat(diskPath);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 16 * 1024 * 1024)
      fail("Unsafe saved motion owner.");
    const disk = JSON.parse(await readFile(diskPath, "utf8"));
    if (
      this.closed ||
      state.revision !== revision ||
      disk.id !== this.app.project.id ||
      JSON.stringify(this.app.project.settings) !== settings ||
      JSON.stringify(disk.settings) !== settings ||
      JSON.stringify(
        disk.timelines.find((c: { id: string }) => c.id === compositionId),
      ) !== JSON.stringify(state.composition) ||
      JSON.stringify(
        disk.stories.find((s: { id: string }) => s.id === state.story.id),
      ) !== JSON.stringify(state.story)
    )
      fail("Motion candidate is stale. Save and review again.");
    return state;
  }
  private target(
    state: TimelineEditorState,
    clipId: string,
    sceneId?: string | null,
  ) {
    const track = state.composition.tracks.find((t) =>
      t.clips.some((c) => c.id === clipId),
    );
    const clip = track?.clips.find((c) => c.id === clipId);
    const asset = this.app.getSourceAsset(clip?.assetId ?? "");
    if (
      !clip ||
      !track ||
      !["video", "overlay"].includes(track.type) ||
      asset?.mediaType !== "image" ||
      !asset.contentHash ||
      clip.locked ||
      asset.state.locked ||
      asset.state.rejected ||
      clip.layout?.preset === "diptych" ||
      (clip.transform?.speed ?? 1) !== 1 ||
      (clip.sourceIn ?? 0) !== 0 ||
      clip.timelineDuration < 2 ||
      clip.timelineDuration > 6
    )
      fail(
        "Choose an unlocked, non-required single photo clip, 2–6 seconds at 1x.",
      );
    const overlapping = (state.composition.graphicScenes ?? []).filter(
      (s) =>
        s.start < clip.timelineStart + clip.timelineDuration &&
        s.start + s.duration > clip.timelineStart &&
        graphicSceneAssetIds([s]).includes(asset.id),
    );
    if (overlapping.some((s) => s.id !== sceneId))
      fail(
        "Explicitly link the matching PhotoDepth scene before replacing this photo; other overlapping photo scenes are unsupported.",
      );
    const scene = sceneId
      ? state.composition.graphicScenes?.find((s) => s.id === sceneId)
      : undefined;
    if (
      sceneId &&
      (!scene ||
        !scene.photoDepth ||
        scene.nodes.length !== 1 ||
        scene.nodes[0]?.type !== "image" ||
        scene.nodes[0].assetId !== asset.id ||
        scene.start !== clip.timelineStart ||
        scene.duration !== clip.timelineDuration)
    )
      fail("Only the matching single-photo depth scene can be replaced.");
    const fake: MediaAsset = {
      id: `motion-admission-${randomUUID()}`,
      uri: "file:///motion-admission.mp4",
      name: "Motion",
      mediaType: "video",
      duration: clip.timelineDuration,
      tags: [],
      state: {},
      metadata: {},
    };
    this.simulate(
      state,
      [...state.assets, fake],
      this.commands(clip.id, fake.id, scene?.id),
    );
    return { clip, asset, scene };
  }
  private commands(
    clipId: string,
    assetId: string,
    sceneId?: string,
  ): TimelineCommand[] {
    return [
      ...(sceneId ? [{ type: "graphic.scene.remove" as const, sceneId }] : []),
      { type: "replace", clipId, assetId },
    ];
  }
  private simulate(
    before: TimelineEditorState,
    assets: MediaAsset[],
    commands: TimelineCommand[],
  ) {
    let next = document(before);
    try {
      for (const command of commands)
        next = applyTimelineCommand(next, assets, command);
    } catch {
      fail(
        "Motion replacement conflicts with source/scene locks or required selection.",
      );
    }
    if (next.composition.duration !== before.composition.duration)
      fail("Motion cannot change film duration.");
    return next;
  }
  private async source(record: RecordData, signal?: AbortSignal) {
    const asset = this.app.getSourceAsset(record.receipt.assetId);
    if (
      !asset ||
      asset.contentHash !== record.receipt.sourceSha256 ||
      motionDigest(asset.uri) !== record.sourceLocation
    )
      fail("Motion original source changed.");
    await readMotionAsset(asset, 16 * 1024 * 1024, signal);
    if (record.receipt.inputAssetId) {
      const input = this.app.getSourceAsset(record.receipt.inputAssetId);
      if (
        !input ||
        input.contentHash !== record.receipt.inputSha256 ||
        motionDigest(input.uri) !== record.inputLocation
      )
        fail("External motion input changed.");
      await readMotionAsset(input, MOTION_BYTES, signal);
    }
    for (const id of graphicSceneAssetIds(
      record.originalScene ? [record.originalScene] : [],
    )) {
      const dependency = this.app.getSourceAsset(id);
      if (!dependency) fail("Motion scene dependency is missing.");
      await readMotionAsset(dependency, MOTION_BYTES, signal);
    }
  }
  async preview(
    input: MotionRequest,
    signal?: AbortSignal,
  ): Promise<MotionGenerationReceipt[]> {
    if (
      !uuid.test(input.requestId) ||
      input.projectId !== this.app.project.id ||
      input.consent !== true ||
      typeof input.containsPeople !== "boolean" ||
      typeof input.prompt !== "string" ||
      !input.prompt.trim() ||
      input.prompt.length > 1000 ||
      typeof input.negativeConstraints !== "string" ||
      !input.negativeConstraints.trim() ||
      input.negativeConstraints.length > 1000
    )
      fail(
        "Explicit motion consent, target and bounded prompt/constraints are required.",
        400,
      );
    const fingerprint = motionDigest(input),
      running = this.running.get(input.requestId);
    if (running) {
      if (running.fingerprint !== fingerprint)
        fail("Motion request ID was reused.");
      return running.work;
    }
    if (this.running.size) fail("Wait for the active motion request.");
    const provider = this.list().find((p) => p.id === input.providerId);
    if (!provider?.available)
      fail(
        "Remote motion is unverified and disabled; use local fixture or import.",
        400,
      );
    const videoIds = input.candidateAssetIds ?? [];
    const count =
      provider.id === localMotionImport.id
        ? videoIds.length
        : (input.count ?? 2);
    if (
      !Number.isInteger(count) ||
      count < (provider.id === localMotionImport.id ? 1 : 2) ||
      count > 3 ||
      (provider.id !== localMotionImport.id && videoIds.length) ||
      new Set(videoIds).size !== videoIds.length
    )
      fail("Select 1–3 external videos or 2–3 fixture candidates.", 400);
    const settings = this.app.project.settings;
    if (
      ![settings.width, settings.height].every(
        (n) => Number.isInteger(n) && n > 0 && n % 2 === 0 && n <= 1920,
      ) ||
      settings.width * settings.height > 1920 * 1080 ||
      !Number.isFinite(settings.frameRate) ||
      settings.frameRate < 1 ||
      settings.frameRate > 60
    )
      fail("Motion requires bounded even output dimensions and 1–60 fps.", 400);
    const controller = new AbortController();
    const ownedSignal = AbortSignal.any([
      controller.signal,
      signal ?? new AbortController().signal,
      AbortSignal.timeout(this.timeoutMs),
    ]);
    const generation = this.app.projectGeneration;
    const work = this.generate(
      input,
      fingerprint,
      count,
      videoIds,
      generation,
      ownedSignal,
    );
    this.running.set(input.requestId, { fingerprint, controller, work });
    try {
      return await work;
    } finally {
      this.running.delete(input.requestId);
    }
  }
  private async generate(
    input: MotionRequest,
    fingerprint: string,
    count: number,
    videoIds: string[],
    generation: number,
    signal: AbortSignal,
  ) {
    const batchPath = await this.path("motion-batches", input.requestId);
    let previous: Batch | undefined;
    try {
      previous = await this.read<Batch>(batchPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (previous) {
      if (
        previous.version !== 1 ||
        previous.projectId !== this.app.project.id ||
        previous.fingerprint !== fingerprint ||
        previous.status !== "ready" ||
        !Array.isArray(previous.ids) ||
        previous.ids.length < 1 ||
        previous.ids.length > 3
      )
        fail(
          "Motion request is already used, revoked or interrupted. Use a new request ID.",
        );
      const records = await Promise.all(
        previous.ids.map((id) => this.record(id)),
      );
      for (const record of records) await this.media(record.receipt.id);
      return records.map((record) => record.receipt);
    }
    await this.expirePreviews();
    const previewRoot = dirname(
      await safeProjectCachePath(
        this.app.directory,
        "motion-candidates",
        ".limit",
      ),
    );
    await chmod(previewRoot, 0o700);
    if ((await readdir(previewRoot)).length + count > 24)
      fail("Motion preview limit reached. Revoke old previews first.");
    const settings = JSON.stringify(this.app.project.settings);
    const state = await this.saved(
      input.compositionId,
      input.baseRevision,
      settings,
    );
    const target = this.target(state, input.clipId, input.sceneId);
    if (
      Math.abs(
        target.clip.timelineDuration * this.app.project.settings.frameRate -
          Math.round(
            target.clip.timelineDuration * this.app.project.settings.frameRate,
          ),
      ) > 1e-6
    )
      fail("Motion duration must align to output frames.");
    const image = await readMotionAsset(target.asset, 16 * 1024 * 1024, signal);
    const pending: Batch = {
      version: 1,
      projectId: input.projectId,
      fingerprint,
      status: "pending",
      ids: [],
    };
    try {
      await writeFile(batchPath, JSON.stringify(pending), {
        flag: "wx",
        mode: 0o600,
      });
    } catch {
      fail(
        "Motion request was claimed by another owner. Retry with its result or a new request ID.",
      );
    }
    const consentAt = new Date().toISOString();
    const ids: string[] = [];
    try {
      for (let variant = 0; variant < count; variant++) {
        checkAbort(signal);
        const id = randomUUID();
        ids.push(id);
        pending.ids = [...ids];
        await this.write(batchPath, pending);
        this.owned.add(id);
        const path = await this.path("motion-candidates", id, "preview.mp4"),
          directory = dirname(path);
        await validateMotionPhoto(image, directory, signal);
        const external = videoIds[variant]
          ? this.app.getSourceAsset(videoIds[variant]!)
          : undefined;
        if (
          videoIds[variant] &&
          (external?.mediaType !== "video" ||
            external.state.locked ||
            external.state.rejected)
        )
          fail("Select an existing local video source.", 400);
        const video = external
          ? await readMotionAsset(external, MOTION_BYTES, signal)
          : undefined;
        let result;
        try {
          result = await cancellableProviderResult(
            this.registry.generateMotion(
              input.providerId,
              {
                ...(video ? { video } : { image }),
                ...this.app.project.settings,
                duration: target.clip.timelineDuration,
                variant,
                prompt: input.prompt,
                negativeConstraints: input.negativeConstraints,
              },
              { signal },
            ),
            signal,
          );
        } catch (error) {
          checkAbort(signal);
          const status = (error as { status?: number })?.status;
          fail(
            status === 429
              ? "Motion provider rate limited; retry explicitly."
              : "Motion provider failed; retry explicitly.",
            status === 429 ? 429 : 502,
          );
        }
        checkAbort(signal);
        if ((await this.read<Batch>(batchPath)).status !== "pending")
          fail("Motion consent was revoked.");
        if (!result) fail("Invalid motion provider result.", 400);
        if (
          typeof result.model !== "string" ||
          !/^[a-zA-Z0-9._-]{1,80}$/.test(result.model) ||
          typeof result.mock !== "boolean"
        )
          fail("Invalid motion provider identity.", 400);
        const output = await normalizeMotion(
          result.bytes,
          directory,
          this.app.project.settings,
          target.clip.timelineDuration,
          signal,
        );
        await rm(join(directory, "input.mp4"), { force: true });
        const receipt: MotionGenerationReceipt = {
          version: 1,
          id,
          requestId: input.requestId,
          projectId: input.projectId,
          compositionId: input.compositionId,
          clipId: input.clipId,
          sceneId: target.scene?.id ?? null,
          assetId: target.asset.id,
          sourceSha256: target.asset.contentHash!,
          baseRevision: input.baseRevision,
          promptSha256: bytesHash(Buffer.from(input.prompt)),
          negativeConstraintsSha256: bytesHash(
            Buffer.from(input.negativeConstraints),
          ),
          providerId: input.providerId,
          model: result.model,
          mock: result.mock,
          origin:
            input.providerId === localMotionImport.id
              ? "external-import"
              : "fixture",
          sourceRelation:
            input.providerId === localMotionImport.id
              ? "user-declared-external"
              : "camera-derived-original",
          estimatedCostUsd:
            input.providerId === localMotionFixture.id ? 0 : null,
          costStatus:
            input.providerId === localMotionFixture.id
              ? "free-fixture"
              : "external-cost-unknown",
          outputSha256: await hashFile(path, signal),
          output,
          ...(external
            ? { inputAssetId: external.id, inputSha256: external.contentHash! }
            : {}),
          state: "preview",
          consentAt,
          createdAt: new Date().toISOString(),
          containsPeople: input.containsPeople,
          deformationCheck: "manual-required",
        };
        const record: RecordData = {
          version: 1,
          receipt,
          settings,
          sourceLocation: motionDigest(target.asset.uri),
          ...(external ? { inputLocation: motionDigest(external.uri) } : {}),
          originalClip: target.clip,
          ...(target.scene
            ? {
                originalScene: target.scene,
                originalTemplate: state.composition.graphicSceneTemplates?.find(
                  (t) => t.sceneId === target.scene!.id,
                ),
              }
            : {}),
        };
        await this.source(record, signal);
        await this.saved(input.compositionId, input.baseRevision, settings);
        if (this.app.projectGeneration !== generation || this.closed)
          fail("Motion project changed.");
        checkAbort(signal);
        await this.write(await this.path("motion-receipts", id), record);
      }
      checkAbort(signal);
      if ((await this.read<Batch>(batchPath)).status !== "pending")
        fail("Motion consent was revoked.");
      await this.write(batchPath, { ...pending, status: "ready" });
      const receipts = await Promise.all(ids.map((id) => this.receipt(id)));
      checkAbort(signal);
      return receipts;
    } catch (error) {
      for (const id of ids) {
        await rm(
          dirname(await this.path("motion-candidates", id, "preview.mp4")),
          { recursive: true, force: true },
        );
        await rm(await this.path("motion-receipts", id), { force: true });
        this.owned.delete(id);
      }
      const current = await this.read<Batch>(batchPath).catch(() => undefined);
      if (current?.status !== "revoked")
        await this.write(batchPath, { ...pending, status: "cancelled" }).catch(
          () => undefined,
        );
      throw error;
    }
  }
  async expirePreviews() {
    const root = dirname(
      await safeProjectCachePath(
        this.app.directory,
        "motion-candidates",
        ".limit",
      ),
    );
    await chmod(root, 0o700);
    for (const id of await readdir(root)) {
      if (!uuid.test(id)) continue;
      let record: RecordData;
      try {
        record = await this.record(id);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      if (!["preview", "accepted"].includes(record.receipt.state)) continue;
      const created = Date.parse(record.receipt.createdAt);
      if (Number.isFinite(created) && Date.now() - created <= 86400000)
        continue;
      record.receipt.state = "revoked";
      await this.write(await this.path("motion-receipts", id), record);
      await rm(
        dirname(await this.path("motion-candidates", id, "preview.mp4")),
        { recursive: true, force: true },
      );
      this.owned.delete(id);
    }
  }
  async media(id: string) {
    const record = await this.record(id);
    if (
      !Number.isFinite(Date.parse(record.receipt.createdAt)) ||
      Date.now() - Date.parse(record.receipt.createdAt) > 86400000
    ) {
      await this.expirePreviews();
      fail("Motion preview expired; generate a new request.", 410);
    }
    if (!["preview", "accepted"].includes(record.receipt.state))
      fail("Motion preview expired or was imported.");
    await this.saved(
      record.receipt.compositionId,
      record.receipt.baseRevision,
      record.settings,
    );
    const state = new TimelineEditor(this.app).get(
      record.receipt.compositionId,
    );
    this.target(state, record.receipt.clipId, record.receipt.sceneId);
    await this.source(record);
    const path = await this.path("motion-candidates", id, "preview.mp4");
    const info = await lstat(path);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.nlink !== 1 ||
      info.size > MOTION_BYTES ||
      (await hashFile(path)) !== record.receipt.outputSha256
    )
      fail("Motion preview bytes changed.");
    await this.saved(
      record.receipt.compositionId,
      record.receipt.baseRevision,
      record.settings,
    );
    return path;
  }
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.catch(() => undefined);
    return result;
  }
  async accept(id: string, reviewed: boolean) {
    return this.serial(async () => {
      if (reviewed !== true)
        fail("Explicit manual identity/detail review is required.", 400);
      await this.media(id);
      const record = await this.record(id);
      record.receipt.state = "accepted";
      record.receipt.deformationCheck = "user-reviewed-not-guaranteed";
      await this.write(await this.path("motion-receipts", id), record);
      return record.receipt;
    });
  }
  async importCandidate(id: string, editor: TimelineEditor) {
    return this.serial(async () => {
      const record = await this.record(id),
        receipt = record.receipt;
      const current = editor.get(receipt.compositionId);
      if (
        ["prepared", "imported"].includes(receipt.state) &&
        record.expectedDocument === docHash(current)
      ) {
        await this.source(record);
        await this.managed(record);
        return this.finishImport(record, current);
      }
      if (
        receipt.state === "prepared" &&
        current.revision === record.importRevision
      ) {
        await this.saved(
          receipt.compositionId,
          current.revision,
          record.settings,
        );
        this.target(current, receipt.clipId, receipt.sceneId);
        await this.source(record);
        const asset = await this.managed(record);
        const commands = this.commands(
          receipt.clipId,
          asset.id,
          receipt.sceneId ?? undefined,
        );
        const expected = this.simulate(
          current,
          [...current.assets.filter((a) => a.id !== asset.id), asset],
          commands,
        );
        if (docHash(expected) !== record.expectedDocument)
          fail(
            "Prepared motion replacement conflicts with the saved document.",
          );
        const after = await editor.edit(receipt.compositionId, {
          baseRevision: current.revision,
          requestId: `motion-import-${id}`,
          commands,
        });
        return this.finishImport(record, after);
      }
      if (receipt.state !== "accepted")
        fail("Preview and accept first, or recover the committed replacement.");
      const path = await this.media(id),
        before = editor.get(receipt.compositionId);
      const sources = join(this.app.directory, "sources");
      await mkdir(sources, { recursive: true, mode: 0o700 });
      if (
        (await lstat(sources)).isSymbolicLink() ||
        (await realpath(sources)) !==
          join(await realpath(this.app.directory), "sources")
      )
        fail("Unsafe managed motion sources.");
      const destination = join(sources, `motion-${id}.mp4`);
      const bytes = await readFile(path);
      if (bytesHash(bytes) !== receipt.outputSha256)
        fail("Motion preview changed before import.");
      try {
        await writeFile(destination, bytes, { flag: "wx", mode: 0o600 });
      } catch (error) {
        if (
          (error as NodeJS.ErrnoException).code !== "EEXIST" ||
          (await lstat(destination)).isSymbolicLink() ||
          (await hashFile(destination)) !== receipt.outputSha256
        )
          throw error;
      }
      await this.app.importManagedSources([destination]);
      const asset = this.app.catalog.getAssetByUri(
        pathToFileURL(destination).href,
      );
      if (!asset) fail("Managed motion source could not be imported.");
      const full = this.app.catalog.getAsset(asset.id)!;
      if (full.state.locked || full.state.rejected)
        fail("Managed motion source is protected.");
      full.metadata["openfilm.motionGeneration"] = structuredClone(receipt);
      this.app.catalog.upsertAsset(full);
      const adopted = editor.adoptImportedVisualSource(before, full.id);
      await this.source(record);
      const commands = this.commands(
        receipt.clipId,
        full.id,
        receipt.sceneId ?? undefined,
      );
      const expected = this.simulate(adopted, adopted.assets, commands);
      if (
        expected.composition.tracks
          .flatMap((t) => t.clips)
          .find((c) => c.id === receipt.clipId)?.timelineDuration !==
        record.originalClip.timelineDuration
      )
        fail("Motion replacement changed narration timing.");
      record.receipt.state = "prepared";
      record.commands = commands;
      record.importRevision = adopted.revision;
      record.expectedDocument = docHash(expected);
      record.importedAssetId = full.id;
      await this.write(await this.path("motion-receipts", id), record);
      const after = await editor.edit(receipt.compositionId, {
        baseRevision: adopted.revision,
        requestId: `motion-import-${id}`,
        commands,
      });
      if (docHash(after) !== record.expectedDocument)
        fail("Motion replacement outcome changed.");
      return this.finishImport(record, after);
    });
  }
  private async finishImport(record: RecordData, state: TimelineEditorState) {
    record.receipt.state = "imported";
    await this.write(
      await this.path("motion-receipts", record.receipt.id),
      record,
    );
    await rm(
      dirname(
        await this.path("motion-candidates", record.receipt.id, "preview.mp4"),
      ),
      { recursive: true, force: true },
    );
    this.owned.delete(record.receipt.id);
    return state;
  }
  private async managed(record: RecordData) {
    const asset = this.app.getSourceAsset(record.importedAssetId ?? "");
    const metadata = asset?.metadata["openfilm.managedSource"] as
      { relativePath?: string } | undefined;
    const expected = join(
      this.app.directory,
      "sources",
      `motion-${record.receipt.id}.mp4`,
    );
    if (
      !asset ||
      metadata?.relativePath !== `sources/motion-${record.receipt.id}.mp4` ||
      asset.uri !== pathToFileURL(expected).href ||
      asset.contentHash !== record.receipt.outputSha256
    )
      fail("Accepted motion source mapping changed.");
    await readMotionAsset(asset, MOTION_BYTES);
    return asset;
  }
  async restore(id: string, editor: TimelineEditor) {
    return this.serial(async () => {
      const record = await this.record(id),
        receipt = record.receipt,
        state = editor.get(receipt.compositionId);
      if (
        receipt.state === "restored" &&
        docHash(state) === record.restoredDocument
      )
        return state;
      if (
        receipt.state === "imported" &&
        record.restoredDocument &&
        docHash(state) === record.restoredDocument
      ) {
        await this.source(record);
        await this.managed(record);
        record.receipt.state = "restored";
        await this.write(await this.path("motion-receipts", id), record);
        return state;
      }
      if (
        receipt.state !== "imported" ||
        docHash(state) !== record.expectedDocument
      )
        fail(
          "Motion restore conflicts with later edits. Use normal history or Named Versions.",
        );
      await this.source(record);
      await this.managed(record);
      const commands: TimelineCommand[] = [
        { type: "replace", clipId: receipt.clipId, assetId: receipt.assetId },
        {
          type: "presentation",
          clipId: receipt.clipId,
          layout: record.originalClip.layout ?? null,
          motion: record.originalClip.motion ?? null,
        },
        ...(record.originalScene
          ? [
              {
                type: "graphic.scene.upsert" as const,
                scene: record.originalScene,
                ...(record.originalTemplate
                  ? { templateRecord: record.originalTemplate }
                  : {}),
              },
            ]
          : []),
      ];
      const expected = this.simulate(state, state.assets, commands);
      record.restoredDocument = docHash(expected);
      await this.write(await this.path("motion-receipts", id), record);
      const after = await editor.edit(receipt.compositionId, {
        baseRevision: state.revision,
        requestId: `motion-restore-${id}`,
        commands,
      });
      record.receipt.state = "restored";
      await this.write(await this.path("motion-receipts", id), record);
      return after;
    });
  }
  async revoke(requestId: string) {
    if (!uuid.test(requestId)) fail("Invalid motion request.", 400);
    const running = this.running.get(requestId);
    running?.controller.abort();
    if (running) await running.work.catch(() => undefined);
    return this.serial(async () => {
      const path = await this.path("motion-batches", requestId);
      let batch: Batch;
      try {
        batch = await this.read<Batch>(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
        throw error;
      }
      if (batch.projectId !== this.app.project.id || batch.version !== 1)
        fail("Motion batch owner changed.");
      await this.write(path, { ...batch, status: "revoked" });
      for (const id of batch.ids) {
        let record: RecordData | undefined;
        try {
          record = await this.record(id);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        if (
          record &&
          ["imported", "restored", "prepared"].includes(record.receipt.state)
        )
          continue;
        if (record) {
          record.receipt.state = "revoked";
          await this.write(await this.path("motion-receipts", id), record);
        }
        await rm(
          dirname(await this.path("motion-candidates", id, "preview.mp4")),
          { recursive: true, force: true },
        );
        this.owned.delete(id);
      }
    });
  }
  /** Explicitly discard preview media, retaining adopted sources and recovery journals. */
  async clearPreviews() {
    const sample = await this.path("motion-batches", randomUUID());
    for (const name of await readdir(dirname(sample))) {
      const id = name.replace(/\.json$/, "");
      if (name === `${id}.json` && uuid.test(id)) await this.revoke(id);
    }
    const candidates = dirname(
      await safeProjectCachePath(
        this.app.directory,
        "motion-candidates",
        ".limit",
      ),
    );
    for (const id of await readdir(candidates)) {
      if (!uuid.test(id)) continue;
      let record: RecordData | undefined;
      try {
        record = await this.record(id);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      if (
        record &&
        ["prepared", "imported", "restored"].includes(record.receipt.state)
      )
        continue;
      await rm(
        dirname(await this.path("motion-candidates", id, "preview.mp4")),
        { recursive: true, force: true },
      );
      this.owned.delete(id);
    }
  }
  dispose(purgePreviews = false): Promise<void> {
    this.closed = true;
    return (this.disposal ??= this.cleanup(purgePreviews));
  }
  private async cleanup(purgePreviews: boolean) {
    const running = [...this.running.values()];
    running.forEach((r) => r.controller.abort());
    await Promise.allSettled(running.map((r) => r.work));
    if (!purgePreviews) return;
    for (const id of this.owned) {
      try {
        await rm(
          dirname(await this.path("motion-candidates", id, "preview.mp4")),
          { recursive: true, force: true },
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    this.owned.clear();
  }
}
