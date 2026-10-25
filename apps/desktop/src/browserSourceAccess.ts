// Modified by OpenFilm contributors on 2026-10-25. See LICENSE and NOTICE.
import type { SourceSelection } from "@openfilm/core";

export type BrowserSourceAvailability =
  "available" | "needs-permission" | "needs-reselection";

export interface BrowserHandleLike {
  readonly kind: "file" | "directory";
  readonly name: string;
  isSameEntry?: (other: BrowserHandleLike) => Promise<boolean>;
  queryPermission?: (options?: { mode?: "read" }) => Promise<PermissionState>;
  requestPermission?: (options?: { mode?: "read" }) => Promise<PermissionState>;
}

export interface StoredBrowserHandle {
  key: string;
  projectId: string;
  kind: BrowserHandleLike["kind"];
  name: string;
  handle: BrowserHandleLike;
}

export interface BrowserHandleBackend {
  list(projectId: string): Promise<StoredBrowserHandle[]>;
  putMany(records: readonly StoredBrowserHandle[]): Promise<void>;
  removeMany(keys: readonly string[]): Promise<void>;
}

const DATABASE_NAME = "openfilm-source-access";
const STORE_NAME = "handles";

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Browser source storage failed."));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = transaction.onerror = () =>
      reject(transaction.error ?? new Error("Browser source storage failed."));
  });
}

export class IndexedDbBrowserHandleBackend implements BrowserHandleBackend {
  private database?: Promise<IDBDatabase>;

  private open(): Promise<IDBDatabase> {
    if (typeof indexedDB === "undefined")
      return Promise.reject(
        new Error("Persistent browser source storage is unavailable."),
      );
    this.database ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME))
          request.result.createObjectStore(STORE_NAME, { keyPath: "key" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error("Browser source storage failed."));
      request.onblocked = () =>
        reject(new Error("Browser source storage is blocked by another tab."));
    });
    return this.database;
  }

  async list(projectId: string): Promise<StoredBrowserHandle[]> {
    const database = await this.open();
    const transaction = database.transaction(STORE_NAME, "readonly");
    const completed = transactionDone(transaction);
    const values = await requestResult<StoredBrowserHandle[]>(
      transaction.objectStore(STORE_NAME).getAll(),
    );
    await completed;
    return values.filter((record) => record.projectId === projectId);
  }

  async putMany(records: readonly StoredBrowserHandle[]): Promise<void> {
    if (!records.length) return;
    const database = await this.open();
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const completed = transactionDone(transaction);
    const store = transaction.objectStore(STORE_NAME);
    for (const record of records) store.put(record);
    await completed;
  }

  async removeMany(keys: readonly string[]): Promise<void> {
    if (!keys.length) return;
    const database = await this.open();
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const completed = transactionDone(transaction);
    const store = transaction.objectStore(STORE_NAME);
    for (const key of keys) store.delete(key);
    await completed;
  }
}

interface EphemeralFiles {
  projectId: string;
  files: File[];
}

export class BrowserSourceAccessRegistry {
  private readonly ephemeral = new Map<string, EphemeralFiles>();

  constructor(
    private readonly backend: BrowserHandleBackend = new IndexedDbBrowserHandleBackend(),
    private readonly createId: () => string = () => crypto.randomUUID(),
  ) {}

  async rememberHandle(
    projectId: string,
    handle: BrowserHandleLike,
  ): Promise<string> {
    return (await this.rememberHandles(projectId, [handle]))[0]!;
  }

  async rememberHandles(
    projectId: string,
    handles: readonly BrowserHandleLike[],
  ): Promise<string[]> {
    if (
      !projectId ||
      handles.some(
        (handle) =>
          !handle.name || !["file", "directory"].includes(handle.kind),
      )
    )
      throw new Error("Browser source handle is invalid.");
    if (!handles.length) return [];

    const known = await this.backend.list(projectId);
    const created: StoredBrowserHandle[] = [];
    const keys: string[] = [];
    for (const handle of handles) {
      let matching: StoredBrowserHandle | undefined;
      for (const record of known) {
        if (record.kind !== handle.kind || record.name !== handle.name)
          continue;
        try {
          if (
            (await handle.isSameEntry?.(record.handle)) ||
            (await record.handle.isSameEntry?.(handle))
          ) {
            matching = record;
            break;
          }
        } catch {
          // A revoked handle is not evidence that two entries are identical.
        }
      }
      if (matching) {
        keys.push(matching.key);
        continue;
      }
      const record: StoredBrowserHandle = {
        key: `browser-handle:${this.createId()}`,
        projectId,
        kind: handle.kind,
        name: handle.name,
        handle,
      };
      known.push(record);
      created.push(record);
      keys.push(record.key);
    }
    await this.backend.putMany(created);
    return keys;
  }

  rememberFiles(projectId: string, files: readonly File[]): string {
    if (!projectId || !files.length)
      throw new Error("Choose at least one browser file.");
    const key = `browser-file:${this.createId()}`;
    this.ephemeral.set(key, { projectId, files: [...files] });
    return key;
  }

  files(projectId: string, key: string): File[] | undefined {
    const value = this.ephemeral.get(key);
    return value?.projectId === projectId ? [...value.files] : undefined;
  }

  releaseFiles(projectId: string, key: string): void {
    const value = this.ephemeral.get(key);
    if (value?.projectId === projectId) this.ephemeral.delete(key);
  }

  async availability(
    projectId: string,
    source: Pick<SourceSelection, "accessClass" | "accessRef">,
  ): Promise<BrowserSourceAvailability> {
    if (source.accessClass === "ephemeral-browser-file")
      return this.files(projectId, source.accessRef)
        ? "available"
        : "needs-reselection";
    if (source.accessClass !== "persistent-browser-handle") return "available";
    const record = (await this.backend.list(projectId)).find(
      (value) => value.key === source.accessRef,
    );
    if (!record) return "needs-reselection";
    try {
      return (await record.handle.queryPermission?.({ mode: "read" })) ===
        "granted"
        ? "available"
        : "needs-permission";
    } catch {
      return "needs-permission";
    }
  }

  clearEphemeral(projectId: string): void {
    for (const [key, value] of this.ephemeral)
      if (value.projectId === projectId) this.ephemeral.delete(key);
  }

  async removeHandle(projectId: string, key: string): Promise<void> {
    await this.removeHandles(projectId, [key]);
  }

  async removeHandles(
    projectId: string,
    keys: readonly string[],
  ): Promise<void> {
    const candidates = new Set(keys);
    if (!projectId || !candidates.size) return;
    const owned = (await this.backend.list(projectId))
      .filter((record) => candidates.has(record.key))
      .map((record) => record.key);
    await this.backend.removeMany(owned);
  }
}

export const browserSourceAccess = new BrowserSourceAccessRegistry();
