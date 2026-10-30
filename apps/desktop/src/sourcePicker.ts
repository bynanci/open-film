// Modified by OpenFilm contributors on 2026-10-25. See LICENSE and NOTICE.
import type { SourceSelectionInput } from "@openfilm/application";
import {
  estimateSourceDraftBytes,
  SOURCE_DISCOVERY_LIMITS,
  SOURCE_DRAFT_LIMITS,
  type SourceSelection,
} from "@openfilm/core";
import {
  browserSourceAccess,
  type BrowserDirectoryHandleLike,
  type BrowserFileHandleLike,
  type BrowserSourceAccessRegistry,
  type BrowserSourceAvailability,
  type BrowserHandleLike,
} from "./browserSourceAccess";

export type RejectedSourceKind =
  "symlink" | "unsupported" | "unreadable" | "directory-unsupported";

export interface RejectedSource {
  label: string;
  kind: RejectedSourceKind;
}

export interface PickedSources {
  sources: SourceSelectionInput[];
  rejected: RejectedSource[];
}

export interface BrowserMediaFile {
  relativePath: string;
  file: File;
  modifiedAt: string;
}

interface NativeDroppedPath {
  path: string;
  kind: "file" | "folder" | "symlink" | "unsupported" | "unreadable";
}

interface BrowserDataTransferItem extends DataTransferItem {
  getAsFileSystemHandle?: () => Promise<BrowserHandleLike | null>;
}

function assertBoundedSelection(count: number): void {
  if (count > SOURCE_DRAFT_LIMITS.selections)
    throw new Error("Choose no more than 10,000 source items at a time.");
}

function assertDraftStorageBudget(
  projectId: string,
  sources: readonly SourceSelectionInput[],
): void {
  if (estimateSourceDraftBytes(projectId, sources) > SOURCE_DRAFT_LIMITS.bytes)
    throw new Error(
      "The selected source details exceed the source draft storage limit.",
    );
}

function sourceName(path: string): string {
  return path.split(/[\\/]/u).filter(Boolean).at(-1) ?? path;
}

function nativeSource(
  path: string,
  kind: "file" | "folder",
): SourceSelectionInput {
  return {
    kind,
    displayName: sourceName(path),
    accessClass: "native-path",
    accessRef: path,
    recursive: kind === "folder",
  };
}

async function invoke<T>(command: string, args?: Record<string, unknown>) {
  const tauri = await import("@tauri-apps/api/core");
  return tauri.invoke<T>(command, args);
}

export async function pickNativeFiles(): Promise<PickedSources> {
  const paths = await invoke<string[]>("pick_files");
  return {
    sources: paths.map((path) => nativeSource(path, "file")),
    rejected: [],
  };
}

export async function pickNativeFolders(): Promise<PickedSources> {
  const paths = await invoke<string[]>("pick_folders");
  return {
    sources: paths.map((path) => nativeSource(path, "folder")),
    rejected: [],
  };
}

export async function classifyNativeDrop(
  paths: string[],
): Promise<PickedSources> {
  if (!paths.length) return { sources: [], rejected: [] };
  const entries = await invoke<NativeDroppedPath[]>("classify_dropped_paths", {
    paths,
  });
  return {
    sources: entries.flatMap((entry) =>
      entry.kind === "file" || entry.kind === "folder"
        ? [nativeSource(entry.path, entry.kind)]
        : [],
    ),
    rejected: entries.flatMap((entry) =>
      entry.kind === "file" || entry.kind === "folder"
        ? []
        : [{ label: sourceName(entry.path), kind: entry.kind }],
    ),
  };
}

export async function listenForNativeDrop(
  listener: (event: {
    type: "enter" | "over" | "drop" | "leave";
    paths: string[];
  }) => void,
): Promise<() => void> {
  const { getCurrentWebviewWindow } =
    await import("@tauri-apps/api/webviewWindow");
  return getCurrentWebviewWindow().onDragDropEvent((event) => {
    const payload = event.payload;
    listener({
      type: payload.type,
      paths: payload.type === "drop" ? payload.paths : [],
    });
  });
}

export function pickBrowserFiles(
  projectId: string,
  files: readonly File[],
  access: BrowserSourceAccessRegistry = browserSourceAccess,
): PickedSources {
  assertBoundedSelection(files.length);
  const predicted = files.map((file, index): SourceSelectionInput => ({
    kind: "file",
    displayName: file.name,
    accessClass: "ephemeral-browser-file",
    accessRef: `browser-file:00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    recursive: false,
  }));
  assertDraftStorageBudget(projectId, predicted);
  return {
    sources: files.map((file) => ({
      kind: "file",
      displayName: file.name,
      accessClass: "ephemeral-browser-file",
      accessRef: access.rememberFiles(projectId, [file]),
      recursive: false,
    })),
    rejected: [],
  };
}

function fallbackDirectorySources(
  projectId: string,
  files: readonly File[],
  access: BrowserSourceAccessRegistry,
): PickedSources {
  assertBoundedSelection(files.length);
  const groups = new Map<string, File[]>();
  for (const file of files) {
    const relative = file.webkitRelativePath;
    const root = relative.split("/").filter(Boolean)[0];
    if (!root) continue;
    const group = groups.get(root);
    if (group) group.push(file);
    else groups.set(root, [file]);
  }
  if (!groups.size) return pickBrowserFiles(projectId, files, access);
  const predicted = [...groups].map(
    ([displayName], index): SourceSelectionInput => ({
      kind: "folder",
      displayName,
      accessClass: "ephemeral-browser-file",
      accessRef: `browser-file:00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      recursive: true,
    }),
  );
  assertDraftStorageBudget(projectId, predicted);
  return {
    sources: [...groups].map(([displayName, members]) => ({
      kind: "folder",
      displayName,
      accessClass: "ephemeral-browser-file",
      accessRef: access.rememberFiles(projectId, members),
      recursive: true,
    })),
    rejected: [],
  };
}

export function pickBrowserFallbackFolders(
  projectId: string,
  files: readonly File[],
  access: BrowserSourceAccessRegistry = browserSourceAccess,
): PickedSources {
  return fallbackDirectorySources(projectId, files, access);
}

async function persistentSources(
  projectId: string,
  handles: readonly BrowserHandleLike[],
  access: BrowserSourceAccessRegistry,
): Promise<PickedSources> {
  assertBoundedSelection(handles.length);
  assertDraftStorageBudget(
    projectId,
    handles.map((handle, index): SourceSelectionInput => ({
      kind: handle.kind === "directory" ? "folder" : "file",
      displayName: handle.name,
      accessClass: "persistent-browser-handle",
      accessRef: `browser-handle:00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      recursive: handle.kind === "directory",
    })),
  );
  const accessRefs = await access.rememberHandles(projectId, handles);
  const sources: SourceSelectionInput[] = handles.map((handle, index) => ({
    kind: handle.kind === "directory" ? "folder" : "file",
    displayName: handle.name,
    accessClass: "persistent-browser-handle",
    accessRef: accessRefs[index]!,
    recursive: handle.kind === "directory",
  }));
  return { sources, rejected: [] };
}

export async function pickBrowserFolder(
  projectId: string,
  access: BrowserSourceAccessRegistry = browserSourceAccess,
): Promise<PickedSources | undefined> {
  const picker = (
    window as Window & {
      showDirectoryPicker?: () => Promise<BrowserHandleLike>;
    }
  ).showDirectoryPicker;
  if (!picker) return undefined;
  try {
    return persistentSources(projectId, [await picker.call(window)], access);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError")
      return { sources: [], rejected: [] };
    throw error;
  }
}

export async function sourcesFromBrowserDrop(
  projectId: string,
  transfer: DataTransfer,
  access: BrowserSourceAccessRegistry = browserSourceAccess,
): Promise<PickedSources> {
  const items = Array.from(transfer.items) as BrowserDataTransferItem[];
  assertBoundedSelection(items.length);
  // Handle promises must be acquired synchronously during the drop event.
  const handlePromises = items.map((item) =>
    typeof item.getAsFileSystemHandle === "function"
      ? item.getAsFileSystemHandle()
      : Promise.resolve(null),
  );
  const handles = (await Promise.all(handlePromises)).filter(
    (handle): handle is BrowserHandleLike => handle !== null,
  );
  if (handles.length) return persistentSources(projectId, handles, access);

  const files = Array.from(transfer.files);
  const legacyDirectory = items.some((item) => {
    const entry = item.webkitGetAsEntry?.();
    return Boolean(entry?.isDirectory);
  });
  if (legacyDirectory && !files.length)
    return {
      sources: [],
      rejected: [
        { label: "directory", kind: "directory-unsupported" as const },
      ],
    };
  return fallbackDirectorySources(projectId, files, access);
}

export function clearBrowserEphemeral(projectId: string): void {
  browserSourceAccess.clearEphemeral(projectId);
}

export async function releaseBrowserSources(
  projectId: string,
  sources: readonly Pick<SourceSelection, "accessClass" | "accessRef">[],
  retainedRefs: ReadonlySet<string> = new Set(),
  access: BrowserSourceAccessRegistry = browserSourceAccess,
): Promise<void> {
  const released = new Set<string>();
  const persistent: string[] = [];
  for (const source of sources) {
    if (retainedRefs.has(source.accessRef) || released.has(source.accessRef))
      continue;
    released.add(source.accessRef);
    if (source.accessClass === "ephemeral-browser-file")
      access.releaseFiles(projectId, source.accessRef);
    else if (source.accessClass === "persistent-browser-handle")
      persistent.push(source.accessRef);
  }
  await access.removeHandles(projectId, persistent);
}

export function browserFilesForSelections(
  projectId: string,
  selections: readonly Pick<SourceSelection, "accessClass" | "accessRef">[],
): File[] | undefined {
  const files: File[] = [];
  for (const selection of selections) {
    if (selection.accessClass !== "ephemeral-browser-file") return undefined;
    const selected = browserSourceAccess.files(projectId, selection.accessRef);
    if (!selected) return undefined;
    files.push(...selected);
  }
  return files;
}

function safeBrowserRelativePath(value: string): string {
  const normalized = value.replaceAll("\\", "/");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    /^[a-z]:/iu.test(normalized) ||
    normalized.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new Error("The browser source returned an unsafe relative path.");
  return normalized;
}

function fileModifiedAt(file: File): string {
  return Number.isFinite(file.lastModified) && file.lastModified > 0
    ? new Date(file.lastModified).toISOString()
    : new Date(0).toISOString();
}

/** Enumerates browser-backed sources lazily so scanning can apply page backpressure. */
export async function* iterateBrowserSelectionFiles(
  projectId: string,
  source: SourceSelection,
  signal?: AbortSignal,
  access: BrowserSourceAccessRegistry = browserSourceAccess,
): AsyncGenerator<BrowserMediaFile> {
  let yielded = 0;
  const emitFile = (file: File, path: string): BrowserMediaFile => ({
    relativePath: safeBrowserRelativePath(path),
    file,
    modifiedAt: fileModifiedAt(file),
  });
  if (source.accessClass === "ephemeral-browser-file") {
    let available = false;
    for (const file of access.fileEntries(projectId, source.accessRef)) {
      available = true;
      signal?.throwIfAborted();
      const raw =
        source.kind === "folder" ? file.webkitRelativePath : file.name;
      const parts = raw.replaceAll("\\", "/").split("/").filter(Boolean);
      if (source.kind === "folder" && parts[0] === source.displayName)
        parts.shift();
      const relativePath = parts.join("/");
      yield emitFile(file, relativePath || file.name);
      yielded++;
      if (yielded > SOURCE_DISCOVERY_LIMITS.maximumCandidatesPerRequest)
        throw new Error(
          "Browser source discovery exceeds the 100,000 item limit.",
        );
    }
    if (!available)
      throw new Error(
        "This browser file selection needs to be selected again.",
      );
    return;
  }
  if (source.accessClass !== "persistent-browser-handle")
    throw new Error(
      "This source is not available through browser file access.",
    );
  const root = await access.persistentHandle(projectId, source.accessRef);
  if (!root || root.kind !== (source.kind === "folder" ? "directory" : "file"))
    throw new Error("This browser source needs to be selected again.");
  const permission = await root.queryPermission?.({ mode: "read" });
  const granted =
    permission === "granted" ||
    (await root.requestPermission?.({ mode: "read" })) === "granted";
  if (!granted)
    throw new Error(
      "Read permission is required to access this browser source.",
    );

  const visit = async function* (
    handle: BrowserHandleLike,
    parent: string,
  ): AsyncGenerator<BrowserMediaFile> {
    signal?.throwIfAborted();
    if (handle.kind === "file") {
      const file = await (handle as BrowserFileHandleLike).getFile?.();
      if (!file)
        throw new Error("The browser file handle is no longer readable.");
      const path = parent ? `${parent}/${handle.name}` : handle.name;
      yield emitFile(file, path);
      yielded++;
      if (yielded > SOURCE_DISCOVERY_LIMITS.maximumCandidatesPerRequest)
        throw new Error(
          "Browser source discovery exceeds the 100,000 item limit.",
        );
      return;
    }
    if (handle.kind !== "directory")
      throw new Error("The browser source handle kind is unsupported.");
    const directory = handle as BrowserDirectoryHandleLike;
    if (!directory.values)
      throw new Error("This browser cannot enumerate the selected folder.");
    for await (const child of directory.values()) {
      signal?.throwIfAborted();
      if (child.kind === "directory" && !source.recursive) continue;
      const childParent =
        child.kind === "directory"
          ? parent
            ? `${parent}/${child.name}`
            : child.name
          : parent;
      yield* visit(child, childParent);
    }
  };
  yield* visit(root, "");
}

export function sourceAvailability(
  projectId: string,
  source: Pick<SourceSelection, "accessClass" | "accessRef">,
): Promise<BrowserSourceAvailability> {
  return browserSourceAccess.availability(projectId, source);
}

export async function sourceAvailabilities(
  projectId: string,
  sources: readonly SourceSelection[],
  access: BrowserSourceAccessRegistry = browserSourceAccess,
): Promise<Record<string, BrowserSourceAvailability>> {
  const statuses = await access.availabilities(projectId, sources);
  return Object.fromEntries(
    sources.map((source, index) => [source.id, statuses[index]!]),
  );
}
