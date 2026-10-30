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

export interface BrowserFileHandleLike extends BrowserHandleLike {
  getFile?: () => Promise<File>;
}

export interface BrowserDirectoryHandleLike extends BrowserHandleLike {
  values?: () => AsyncIterable<BrowserHandleLike>;
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
  getMany(
    projectId: string,
    keys: readonly string[],
  ): Promise<StoredBrowserHandle[]>;
  putMany(records: readonly StoredBrowserHandle[]): Promise<void>;
  removeMany(keys: readonly string[]): Promise<void>;
}

const DATABASE_NAME = "openfilm-source-access";
const STORE_NAME = "handles";
const PROJECT_INDEX = "projectId";
const DATABASE_VERSION = 2;
const MAX_PERMISSION_CHECKS = 16;
const MAX_IDENTITY_COMPARISONS = 32;

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
  private connection?: IDBDatabase;

  private open(): Promise<IDBDatabase> {
    if (typeof indexedDB === "undefined")
      return Promise.reject(
        new Error("Persistent browser source storage is unavailable."),
      );
    if (this.database) return this.database;
    const opening = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      let settled = false;
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        if (this.database === opening) this.database = undefined;
        reject(error);
      };
      request.onupgradeneeded = () => {
        const store = request.result.objectStoreNames.contains(STORE_NAME)
          ? request.transaction!.objectStore(STORE_NAME)
          : request.result.createObjectStore(STORE_NAME, { keyPath: "key" });
        if (!store.indexNames.contains(PROJECT_INDEX))
          store.createIndex(PROJECT_INDEX, "projectId", { unique: false });
      };
      request.onsuccess = () => {
        const database = request.result;
        if (settled) {
          database.close();
          return;
        }
        settled = true;
        this.connection = database;
        database.onversionchange = () => {
          database.close();
          if (this.connection === database) this.connection = undefined;
          if (this.database === opening) this.database = undefined;
        };
        resolve(database);
      };
      request.onerror = () =>
        fail(request.error ?? new Error("Browser source storage failed."));
      request.onblocked = () =>
        fail(new Error("Browser source storage is blocked by another tab."));
    });
    this.database = opening;
    return opening;
  }

  async list(projectId: string): Promise<StoredBrowserHandle[]> {
    const database = await this.open();
    const transaction = database.transaction(STORE_NAME, "readonly");
    const completed = transactionDone(transaction);
    const values = await requestResult<StoredBrowserHandle[]>(
      transaction
        .objectStore(STORE_NAME)
        .index(PROJECT_INDEX)
        .getAll(projectId),
    );
    await completed;
    return values;
  }

  async getMany(
    projectId: string,
    keys: readonly string[],
  ): Promise<StoredBrowserHandle[]> {
    const uniqueKeys = [...new Set(keys)];
    if (!uniqueKeys.length) return [];
    const database = await this.open();
    const transaction = database.transaction(STORE_NAME, "readonly");
    const completed = transactionDone(transaction);
    const store = transaction.objectStore(STORE_NAME);
    const values = await Promise.all(
      uniqueKeys.map((key) =>
        requestResult<StoredBrowserHandle | undefined>(store.get(key)),
      ),
    );
    await completed;
    return values.filter(
      (record): record is StoredBrowserHandle =>
        record !== undefined && record.projectId === projectId,
    );
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
    const candidates = new Map<string, StoredBrowserHandle[]>();
    for (const record of known) {
      const key = `${record.kind}:${record.name.length}:${record.name}`;
      const matches = candidates.get(key);
      if (matches) matches.push(record);
      else candidates.set(key, [record]);
    }
    const created: StoredBrowserHandle[] = [];
    const keys: string[] = [];
    for (const handle of handles) {
      let matching: StoredBrowserHandle | undefined;
      const candidateKey = `${handle.kind}:${handle.name.length}:${handle.name}`;
      const matches = candidates.get(candidateKey) ?? [];
      const firstCandidate = Math.max(
        0,
        matches.length - MAX_IDENTITY_COMPARISONS,
      );
      for (let index = matches.length - 1; index >= firstCandidate; index--) {
        const record = matches[index]!;
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
      if (matches.length >= MAX_IDENTITY_COMPARISONS)
        throw new Error(
          "This source is ambiguous because too many saved sources share its name. Remove an existing same-name source before adding it again.",
        );
      const record: StoredBrowserHandle = {
        key: `browser-handle:${this.createId()}`,
        projectId,
        kind: handle.kind,
        name: handle.name,
        handle,
      };
      known.push(record);
      const existing = candidates.get(candidateKey);
      if (existing) existing.push(record);
      else candidates.set(candidateKey, [record]);
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

  *fileEntries(projectId: string, key: string): Iterable<File> {
    const value = this.ephemeral.get(key);
    if (value?.projectId !== projectId) return;
    yield* value.files;
  }

  async persistentHandle(
    projectId: string,
    key: string,
  ): Promise<BrowserHandleLike | undefined> {
    const record = (await this.backend.getMany(projectId, [key]))[0];
    return record?.handle;
  }

  releaseFiles(projectId: string, key: string): void {
    const value = this.ephemeral.get(key);
    if (value?.projectId === projectId) this.ephemeral.delete(key);
  }

  async availability(
    projectId: string,
    source: Pick<SourceSelection, "accessClass" | "accessRef">,
  ): Promise<BrowserSourceAvailability> {
    return (await this.availabilities(projectId, [source]))[0]!;
  }

  async availabilities(
    projectId: string,
    sources: readonly Pick<SourceSelection, "accessClass" | "accessRef">[],
  ): Promise<BrowserSourceAvailability[]> {
    const pendingRefs = [
      ...new Set(
        sources
          .filter(
            (source) => source.accessClass === "persistent-browser-handle",
          )
          .map((source) => source.accessRef),
      ),
    ];
    const persistent = new Map(
      (await this.backend.getMany(projectId, pendingRefs)).map((record) => [
        record.key,
        record,
      ]),
    );
    const permissionResults = new Map<string, BrowserSourceAvailability>();
    let nextRef = 0;
    const worker = async () => {
      while (nextRef < pendingRefs.length) {
        const accessRef = pendingRefs[nextRef++]!;
        const record = persistent.get(accessRef);
        if (!record) {
          permissionResults.set(accessRef, "needs-reselection");
          continue;
        }
        try {
          permissionResults.set(
            accessRef,
            (await record.handle.queryPermission?.({ mode: "read" })) ===
              "granted"
              ? "available"
              : "needs-permission",
          );
        } catch {
          permissionResults.set(accessRef, "needs-permission");
        }
      }
    };
    await Promise.all(
      Array.from(
        { length: Math.min(MAX_PERMISSION_CHECKS, pendingRefs.length) },
        worker,
      ),
    );
    return sources.map((source): BrowserSourceAvailability => {
      if (source.accessClass === "ephemeral-browser-file")
        return this.files(projectId, source.accessRef)
          ? "available"
          : "needs-reselection";
      if (source.accessClass !== "persistent-browser-handle")
        return "available";
      return permissionResults.get(source.accessRef) ?? "needs-reselection";
    });
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
    const owned = (await this.backend.getMany(projectId, [...candidates])).map(
      (record) => record.key,
    );
    await this.backend.removeMany(owned);
  }
}

export const browserSourceAccess = new BrowserSourceAccessRegistry();
