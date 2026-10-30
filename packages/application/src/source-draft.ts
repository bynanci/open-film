// Modified by OpenFilm contributors on 2026-10-25. See LICENSE and NOTICE.
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import {
  ApplicationError,
  SOURCE_DRAFT_LIMITS,
  type SourceAccessClass,
  type SourceDraft,
  type SourceSelection,
  type SourceSelectionKind,
} from "@openfilm/core";

const MAX_RECEIPTS = 512;

export interface SourceSelectionInput {
  kind: SourceSelectionKind;
  displayName: string;
  accessClass: SourceAccessClass;
  accessRef: string;
  recursive?: boolean;
}

export interface AddSourceSelectionsInput {
  projectId: string;
  baseRevision: number;
  requestId: string;
  sources: SourceSelectionInput[];
}

export interface RemoveSourceSelectionInput {
  projectId: string;
  baseRevision: number;
  requestId: string;
  selectionId: string;
}

export interface UpdateSourceSelectionInput extends RemoveSourceSelectionInput {
  recursive: boolean;
}

interface MutationReceipt {
  requestId: string;
  fingerprint: string;
}

interface StoredSourceDraft extends SourceDraft {
  receipts: MutationReceipt[];
}

function fail(
  code: ConstructorParameters<typeof ApplicationError>[0],
  message: string,
  status = 400,
): never {
  throw new ApplicationError(code, message, status);
}

function validRevision(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function validateRequest(
  projectId: string,
  baseRevision: number,
  requestId: string,
): void {
  if (!projectId.trim() || projectId.length > 512)
    fail("request.invalid", "A project identifier is required.");
  if (!validRevision(baseRevision))
    fail("request.invalid", "A nonnegative source draft revision is required.");
  if (!requestId.trim() || requestId.length > 512 || requestId.includes("\0"))
    fail("request.invalid", "A bounded request identifier is required.");
}

function cleanText(value: string, label: string, maximum: number): string {
  const clean = value.trim();
  if (
    !clean ||
    [...clean].length > maximum ||
    [...clean].some((character) => character.charCodeAt(0) < 32)
  )
    fail("request.invalid", `${label} is invalid.`);
  return clean;
}

function validateSource(
  value: SourceSelectionInput,
): SourceSelectionInput & { recursive: boolean } {
  if (value.kind !== "file" && value.kind !== "folder")
    fail("request.invalid", "Choose a file or folder source.");
  if (
    ![
      "native-path",
      "persistent-browser-handle",
      "ephemeral-browser-file",
      "staged-content",
    ].includes(value.accessClass)
  )
    fail("request.invalid", "Choose a supported source access class.");
  const displayName = cleanText(value.displayName, "Source name", 512);
  const accessRef = cleanText(value.accessRef, "Source reference", 4096);
  if (value.accessClass === "native-path" && !isAbsolute(accessRef))
    fail("request.invalid", "Native source references must be absolute paths.");
  if (value.recursive !== undefined && typeof value.recursive !== "boolean")
    fail("request.invalid", "Source recursion policy must be a boolean.");
  return {
    kind: value.kind,
    displayName,
    accessClass: value.accessClass,
    accessRef,
    recursive: value.kind === "folder" ? (value.recursive ?? true) : false,
  };
}

function fingerprint(kind: string, value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify({ kind, value }))
    .digest("hex");
}

function publicDraft(value: StoredSourceDraft): SourceDraft {
  return structuredClone({
    schemaVersion: 1 as const,
    projectId: value.projectId,
    revision: value.revision,
    selections: value.selections,
  });
}

function validateStoredDraft(
  value: unknown,
  projectId: string,
): StoredSourceDraft {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("request.invalid", "The saved source draft is invalid.");
  const draft = value as Partial<StoredSourceDraft>;
  if (
    draft.schemaVersion !== 1 ||
    draft.projectId !== projectId ||
    !validRevision(draft.revision ?? -1) ||
    !Array.isArray(draft.selections) ||
    draft.selections.length > SOURCE_DRAFT_LIMITS.selections ||
    !Array.isArray(draft.receipts) ||
    draft.receipts.length > MAX_RECEIPTS
  )
    fail("request.invalid", "The saved source draft is invalid.");
  const ids = new Set<string>();
  const selections = draft.selections.map((selection) => {
    if (
      !selection ||
      typeof selection !== "object" ||
      typeof selection.id !== "string" ||
      !selection.id ||
      selection.projectId !== projectId ||
      !validRevision(selection.selectionRevision)
    )
      fail(
        "request.invalid",
        "The saved source draft contains an invalid source.",
      );
    if (ids.has(selection.id))
      fail("request.invalid", "The saved source draft contains duplicate IDs.");
    ids.add(selection.id);
    const clean = validateSource(selection);
    return {
      ...clean,
      id: selection.id,
      projectId,
      selectionRevision: selection.selectionRevision,
    };
  });
  const receipts = draft.receipts.map((receipt) => {
    if (
      !receipt ||
      typeof receipt.requestId !== "string" ||
      !receipt.requestId ||
      typeof receipt.fingerprint !== "string" ||
      !/^[a-f0-9]{64}$/u.test(receipt.fingerprint)
    )
      fail(
        "request.invalid",
        "The saved source draft contains an invalid receipt.",
      );
    return { requestId: receipt.requestId, fingerprint: receipt.fingerprint };
  });
  return {
    schemaVersion: 1,
    projectId,
    revision: draft.revision!,
    selections,
    receipts,
  };
}

export class SourceDraftService {
  private readonly path: string;

  constructor(
    private readonly directory: string,
    private readonly projectId: string,
  ) {
    this.path = join(directory, "analysis", "source-draft.json");
  }

  /** Private workspace directory for operational receipts; never serialized in the draft. */
  get operationalDirectory(): string {
    return this.directory;
  }

  private empty(): StoredSourceDraft {
    return {
      schemaVersion: 1,
      projectId: this.projectId,
      revision: 0,
      selections: [],
      receipts: [],
    };
  }

  private read(): StoredSourceDraft {
    if (!existsSync(this.path)) return this.empty();
    const info = lstatSync(this.path);
    if (
      info.isSymbolicLink() ||
      !info.isFile() ||
      info.size > SOURCE_DRAFT_LIMITS.bytes
    )
      fail("request.invalid", "The saved source draft is unsafe or too large.");
    try {
      return validateStoredDraft(
        JSON.parse(readFileSync(this.path, "utf8")),
        this.projectId,
      );
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      fail("request.invalid", "The saved source draft is invalid.");
    }
  }

  private write(value: StoredSourceDraft): void {
    const parent = dirname(this.path);
    if (!existsSync(parent)) mkdirSync(parent, { mode: 0o700 });
    const parentInfo = lstatSync(parent);
    if (!parentInfo.isDirectory() || parentInfo.isSymbolicLink())
      fail("request.invalid", "Source draft storage is unsafe.");
    if (existsSync(this.path)) {
      const info = lstatSync(this.path);
      if (!info.isFile() || info.isSymbolicLink())
        fail("request.invalid", "Source draft storage is unsafe.");
    }
    const { receipts, ...draft } = value;
    const body = JSON.stringify(draft);
    const prefix = `${body.slice(0, -1)},"receipts":[`;
    const suffix = "]}\n";
    const encodedReceipts = receipts.map((receipt) => JSON.stringify(receipt));
    let retainedStart = encodedReceipts.length;
    let bytes = Buffer.byteLength(prefix) + Buffer.byteLength(suffix);
    for (let index = encodedReceipts.length - 1; index >= 0; index--) {
      const added =
        Buffer.byteLength(encodedReceipts[index]!) +
        (retainedStart === encodedReceipts.length ? 0 : 1);
      if (bytes + added > SOURCE_DRAFT_LIMITS.bytes) break;
      bytes += added;
      retainedStart = index;
    }
    if (receipts.length && retainedStart === receipts.length)
      fail(
        "request.tooLarge",
        "The source draft exceeds its storage limit.",
        413,
      );
    value.receipts = receipts.slice(retainedStart);
    const serialized = `${prefix}${encodedReceipts
      .slice(retainedStart)
      .join(",")}${suffix}`;
    if (Buffer.byteLength(serialized) > SOURCE_DRAFT_LIMITS.bytes)
      fail(
        "request.tooLarge",
        "The source draft exceeds its storage limit.",
        413,
      );
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    const descriptor = openSync(temporary, "wx", 0o600);
    try {
      writeFileSync(descriptor, serialized, "utf8");
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    renameSync(temporary, this.path);
  }

  private assertOwner(projectId: string): void {
    if (projectId !== this.projectId)
      fail(
        "request.forbidden",
        "This source draft belongs to another project.",
        403,
      );
  }

  private mutate(
    kind: string,
    input: {
      projectId: string;
      baseRevision: number;
      requestId: string;
    },
    payload: unknown,
    apply: (draft: StoredSourceDraft, nextRevision: number) => boolean,
  ): SourceDraft {
    validateRequest(input.projectId, input.baseRevision, input.requestId);
    this.assertOwner(input.projectId);
    const draft = this.read();
    const digest = fingerprint(kind, payload);
    const receipt = draft.receipts.find(
      (value) => value.requestId === input.requestId,
    );
    if (receipt) {
      if (receipt.fingerprint !== digest)
        fail(
          "request.invalid",
          "This request identifier was already used for another source change.",
          409,
        );
      return publicDraft(draft);
    }
    if (draft.revision !== input.baseRevision)
      fail(
        "import.draftStale",
        "The source draft changed. Refresh it before editing.",
        409,
      );
    const nextRevision = draft.revision + 1;
    const changed = apply(draft, nextRevision);
    if (changed) draft.revision = nextRevision;
    draft.receipts = [
      ...draft.receipts,
      { requestId: input.requestId, fingerprint: digest },
    ].slice(-MAX_RECEIPTS);
    this.write(draft);
    return publicDraft(draft);
  }

  get(): SourceDraft {
    return publicDraft(this.read());
  }

  add(input: AddSourceSelectionsInput): SourceDraft {
    if (!Array.isArray(input.sources) || !input.sources.length)
      fail("request.invalid", "Choose at least one source.");
    if (input.sources.length > SOURCE_DRAFT_LIMITS.selections)
      fail("request.tooLarge", "Too many sources were selected.", 413);
    const sources = input.sources.map(validateSource);
    return this.mutate("add", input, sources, (draft, nextRevision) => {
      const keys = new Set(
        draft.selections.map((source) =>
          JSON.stringify([source.kind, source.accessClass, source.accessRef]),
        ),
      );
      const additions: SourceSelection[] = [];
      for (const source of sources) {
        const key = JSON.stringify([
          source.kind,
          source.accessClass,
          source.accessRef,
        ]);
        if (keys.has(key)) continue;
        keys.add(key);
        additions.push({
          ...source,
          id: randomUUID(),
          projectId: this.projectId,
          selectionRevision: nextRevision,
          recursive: source.recursive ?? source.kind === "folder",
        });
      }
      if (
        draft.selections.length + additions.length >
        SOURCE_DRAFT_LIMITS.selections
      )
        fail(
          "request.tooLarge",
          "The source draft has too many selections.",
          413,
        );
      if (!additions.length) return false;
      draft.selections.push(...additions);
      return true;
    });
  }

  remove(input: RemoveSourceSelectionInput): SourceDraft {
    const selectionId = cleanText(input.selectionId, "Source identifier", 512);
    return this.mutate("remove", input, { selectionId }, (draft) => {
      const index = draft.selections.findIndex(
        (source) => source.id === selectionId,
      );
      if (index < 0)
        fail("request.notFound", "The selected source no longer exists.", 404);
      draft.selections.splice(index, 1);
      return true;
    });
  }

  update(input: UpdateSourceSelectionInput): SourceDraft {
    const selectionId = cleanText(input.selectionId, "Source identifier", 512);
    if (typeof input.recursive !== "boolean")
      fail("request.invalid", "Choose whether to include subfolders.");
    return this.mutate(
      "update",
      input,
      { selectionId, recursive: input.recursive },
      (draft, nextRevision) => {
        const source = draft.selections.find(
          (selection) => selection.id === selectionId,
        );
        if (!source)
          fail(
            "request.notFound",
            "The selected source no longer exists.",
            404,
          );
        if (source.kind !== "folder" && input.recursive)
          fail("request.invalid", "File sources cannot include subfolders.");
        if (source.recursive === input.recursive) return false;
        source.recursive = input.recursive;
        source.selectionRevision = nextRevision;
        return true;
      },
    );
  }
}
