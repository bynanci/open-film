// Modified by OpenFilm contributors on 2026-10-25. See LICENSE and NOTICE.
import type { SourceSelectionInput } from "@openfilm/application";
import type { SourceSelection } from "@openfilm/core";
import {
  browserSourceAccess,
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

interface NativeDroppedPath {
  path: string;
  kind: "file" | "folder" | "symlink" | "unsupported" | "unreadable";
}

interface BrowserDataTransferItem extends DataTransferItem {
  getAsFileSystemHandle?: () => Promise<BrowserHandleLike | null>;
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
  const groups = new Map<string, File[]>();
  for (const file of files) {
    const relative = file.webkitRelativePath;
    const root = relative.split("/").filter(Boolean)[0];
    if (!root) continue;
    groups.set(root, [...(groups.get(root) ?? []), file]);
  }
  if (!groups.size) return pickBrowserFiles(projectId, files, access);
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
  const sources: SourceSelectionInput[] = [];
  for (const handle of handles) {
    sources.push({
      kind: handle.kind === "directory" ? "folder" : "file",
      displayName: handle.name,
      accessClass: "persistent-browser-handle",
      accessRef: await access.rememberHandle(projectId, handle),
      recursive: handle.kind === "directory",
    });
  }
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

export function sourceAvailability(
  projectId: string,
  source: Pick<SourceSelection, "accessClass" | "accessRef">,
): Promise<BrowserSourceAvailability> {
  return browserSourceAccess.availability(projectId, source);
}
