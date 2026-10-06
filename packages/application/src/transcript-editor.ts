import {
  ApplicationError,
  validateTranscriptCommand,
  type TranscriptCommand,
} from "@openfilm/core";
import type {
  TranscriptEditMetadata,
  TranscriptEditorPageOptions,
  TranscriptHistoryInput,
  TranscriptMutationInput,
  TranscriptSearchOptions,
} from "@openfilm/catalog";
import type { OpenFilmApplication } from "./index.js";

export type {
  TranscriptEditMetadata,
  TranscriptEditorPageOptions,
  TranscriptHistoryInput,
  TranscriptMutationInput,
  TranscriptSearchOptions,
} from "@openfilm/catalog";
function object(value: unknown, allowed: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Object.getOwnPropertySymbols(value).length
  )
    throw new ApplicationError(
      "transcript.invalidCommand",
      "Transcript input must be a plain JSON object.",
    );
  for (const key of Object.keys(value))
    if (!allowed.includes(key))
      throw new ApplicationError(
        "transcript.invalidCommand",
        `Unknown transcript input field: ${key}.`,
      );
  return value as Record<string, unknown>;
}
function historyInput(
  value: unknown,
  extra: string[] = [],
): TranscriptHistoryInput {
  const data = object(value, ["baseRevision", "requestId", ...extra]);
  for (const key of ["baseRevision", "requestId"])
    if (
      typeof data[key] !== "string" ||
      !String(data[key]).trim() ||
      String(data[key]).length > 256 ||
      [...String(data[key])].some(
        (character) =>
          character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      )
    )
      throw new ApplicationError(
        "transcript.invalidCommand",
        `${key} must be a nonempty identifier of at most 256 characters.`,
      );
  return {
    baseRevision: data.baseRevision as string,
    requestId: data.requestId as string,
  };
}

/** Source-bound transcript commands and durable history, shared by Desktop and headless adapters. */
export class TranscriptEditor {
  constructor(private readonly application: OpenFilmApplication) {}
  private async source(assetId: string): Promise<string> {
    if (typeof assetId !== "string" || !assetId.trim() || assetId.length > 256)
      throw new ApplicationError(
        "transcript.invalidCommand",
        "Invalid media asset ID.",
      );
    return this.application.intelligence.sourceIdentity(assetId);
  }
  async get(assetId: string, options: TranscriptEditorPageOptions = {}) {
    object(options, ["offset", "limit", "revisionId"]);
    const sourceHash = await this.source(assetId);
    return {
      ...this.application.catalog.transcripts.get(assetId, sourceHash, options),
      sourceHash,
    };
  }
  async edit(
    assetId: string,
    value: TranscriptMutationInput,
    metadata: TranscriptEditMetadata = {},
    commitHook?: () => void,
  ) {
    const input = object(value, ["baseRevision", "requestId", "commands"]),
      base = historyInput(input, ["commands"]);
    if (
      !Array.isArray(input.commands) ||
      !input.commands.length ||
      input.commands.length > 100
    )
      throw new ApplicationError(
        "transcript.invalidCommand",
        "Apply between 1 and 100 transcript commands per request.",
      );
    const commands: TranscriptCommand[] = input.commands.map(
      validateTranscriptCommand,
    );
    object(metadata, ["source", "suggestionId"]);
    const sourceHash = await this.source(assetId);
    return {
      ...this.application.catalog.transcripts.edit(
        assetId,
        sourceHash,
        { ...base, commands },
        metadata,
        commitHook,
      ),
      sourceHash,
    };
  }
  async undo(assetId: string, value: TranscriptHistoryInput) {
    const input = historyInput(value),
      sourceHash = await this.source(assetId);
    return {
      ...this.application.catalog.transcripts.undo(assetId, sourceHash, input),
      sourceHash,
    };
  }
  async redo(assetId: string, value: TranscriptHistoryInput) {
    const input = historyInput(value),
      sourceHash = await this.source(assetId);
    return {
      ...this.application.catalog.transcripts.redo(assetId, sourceHash, input),
      sourceHash,
    };
  }
  async selectRevision(
    assetId: string,
    value: TranscriptHistoryInput & { revisionId: string },
  ) {
    const data = object(value, ["baseRevision", "requestId", "revisionId"]),
      input = historyInput(data, ["revisionId"]),
      sourceHash = await this.source(assetId);
    return {
      ...this.application.catalog.transcripts.selectRevision(
        assetId,
        sourceHash,
        { ...input, revisionId: data.revisionId as string },
      ),
      sourceHash,
    };
  }
  async search(assetId: string, options: TranscriptSearchOptions) {
    object(options, ["query", "caseSensitive", "offset", "limit"]);
    const sourceHash = await this.source(assetId);
    return {
      ...this.application.catalog.transcripts.search(
        assetId,
        sourceHash,
        options,
      ),
      sourceHash,
    };
  }
  async getSegment(assetId: string, segmentId: string) {
    const sourceHash = await this.source(assetId);
    return {
      ...this.application.catalog.transcripts.getSegment(
        assetId,
        sourceHash,
        segmentId,
      ),
      sourceHash,
    };
  }
  async revisions(
    assetId: string,
    options: { offset?: number; limit?: number } = {},
  ) {
    object(options, ["offset", "limit"]);
    const sourceHash = await this.source(assetId);
    return {
      ...this.application.catalog.transcripts.revisions(
        assetId,
        sourceHash,
        options,
      ),
      sourceHash,
    };
  }
}
