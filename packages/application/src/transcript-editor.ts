import {
  ApplicationError,
  validateTranscriptCommand,
  createTranscriptRippleProposal,
  validateTranscriptRippleProposal,
  type TranscriptCommand,
  type TranscriptRippleProposal,
  type TranscriptRippleMode,
} from "@openfilm/core";
import type {
  TranscriptEditMetadata,
  TranscriptEditorPageOptions,
  TranscriptHistoryInput,
  TranscriptMutationInput,
  TranscriptSearchOptions,
} from "@openfilm/catalog";
import type { OpenFilmApplication } from "./index.js";
import { TimelineEditor } from "./editor.js";

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
  async createRippleProposal(
    compositionId: string,
    assetId: string,
    options: {
      mode?: TranscriptRippleMode;
      segmentIds?: readonly string[];
      sourceRange?: { start: number; end: number };
    },
  ): Promise<TranscriptRippleProposal> {
    const page = await this.get(assetId);
    if (!page.document) {
      throw new ApplicationError(
        "request.notFound",
        `No transcript found for asset "${assetId}".`,
        404,
      );
    }
    const asset = this.application.catalog.getAsset(assetId);
    const editor = new TimelineEditor(this.application);
    const timeline = editor.get(compositionId);
    const proposal = createTranscriptRippleProposal(timeline.composition, page.document, {
      assetId,
      mode: options.mode,
      segmentIds: options.segmentIds,
      sourceRange: options.sourceRange,
      assets: asset ? [asset] : undefined,
    });
    proposal.transcriptRevision = page.revision;
    proposal.sourceHash = page.sourceHash;
    return proposal;
  }
  async applyRipple(
    compositionId: string,
    assetId: string,
    options: {
      baseRevision: string;
      requestId?: string;
      proposal?: TranscriptRippleProposal;
      transcriptRevision?: string;
      sourceHash?: string;
      mode?: TranscriptRippleMode;
      segmentIds?: readonly string[];
      sourceRange?: { start: number; end: number };
      editor?: TimelineEditor;
    },
  ) {
    const editor = options.editor ?? new TimelineEditor(this.application);
    const page = await this.get(assetId);
    if (!page.document) {
      throw new ApplicationError(
        "request.notFound",
        `No transcript found for asset "${assetId}".`,
        404,
      );
    }
    const expectedRevision =
      options.proposal?.transcriptRevision ?? options.transcriptRevision;
    if (expectedRevision && page.revision !== expectedRevision) {
      throw new ApplicationError(
        "transcript.staleProposal",
        "The transcript has been modified since this proposal was reviewed. Please generate a new proposal.",
        409,
      );
    }
    const expectedSourceHash =
      options.proposal?.sourceHash ?? options.sourceHash;
    if (expectedSourceHash && page.sourceHash !== expectedSourceHash) {
      throw new ApplicationError(
        "transcript.sourceMismatch",
        "The asset source has changed since this proposal was reviewed.",
        409,
      );
    }
    const proposal =
      options.proposal !== undefined
        ? validateTranscriptRippleProposal(options.proposal)
        : await this.createRippleProposal(compositionId, assetId, options);
    return editor.edit(compositionId, {
      baseRevision: options.baseRevision,
      ...(options.requestId ? { requestId: options.requestId } : {}),
      commands: [{ type: "transcript.ripple", proposal }],
    });
  }
}
