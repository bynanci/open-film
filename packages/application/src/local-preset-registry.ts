// SPDX-License-Identifier: Apache-2.0
import { resolve } from "node:path";
import {
  ApplicationError,
  PRESET_LIMITS,
  assertPresetJsonData,
  canonicalPresetId,
  canonicalPresetJson,
  parsePresetPackage,
  parsePresetJson,
  presetHash,
  presetId,
  presetRecord,
  presetVersion,
  validatePresetPackage,
  type PresetPackageV1,
  type PresetEntry,
} from "@openfilm/core";
import {
  checkPresetAbort,
  LocalPresetStorage,
  presetStorageFailure,
  readPresetFile,
} from "./local-preset-storage.js";
import { hashPresetData, createPresetSnapshot } from "./preset-integrity.js";
interface RegistryFile {
  version: 1;
  packages: PresetPackageV1[];
}
export interface PresetRegistryPackage extends PresetPackageV1 {
  packageSha256: string;
  entrySummaries: {
    id: string;
    kind: PresetEntry["kind"];
    name: string;
    canonicalId: string;
  }[];
}
export interface PresetRegistryView {
  version: 1;
  revision: string;
  packages: PresetRegistryPackage[];
}
export interface PresetImportReview {
  version: 1;
  packageSha256: string;
  registryRevision: string;
  reviewSha256: string;
  package: PresetPackageV1;
  alreadyInstalled: boolean;
}
export interface PresetInstallInput {
  document: string;
  packageSha256: string;
  baseRegistryRevision: string;
  reviewSha256: string;
  acknowledgeLicense: true;
}
export interface PresetRemoveInput {
  packageId: string;
  packageVersion: string;
  packageSha256: string;
  baseRegistryRevision: string;
}
export interface PresetRecoveryReview {
  version: 1;
  primarySha256: string;
  backupSha256: string;
  reviewSha256: string;
  packages: number;
  entries: number;
}
export interface PresetRecoveryInput extends PresetRecoveryReview {
  acknowledgeRecovery: true;
}
const hash = (v: unknown) => hashPresetData(canonicalPresetJson(v));
export class LocalPresetRegistry {
  private readonly storage: LocalPresetStorage;
  constructor(userDataDirectory: string) {
    this.storage = new LocalPresetStorage(resolve(userDataDirectory));
  }
  private parse(text: string): RegistryFile {
    let value: unknown;
    try {
      value = parsePresetJson(text, {
        bytes: PRESET_LIMITS.registryBytes,
        depth: 16,
        tokens: 1000000,
      });
    } catch {
      throw presetStorageFailure(
        "Local preset registry is malformed; review its backup recovery.",
      );
    }
    assertPresetJsonData(value, { depth: 16, tokens: 1000000, text: 8388608 });
    const d = presetRecord(value, "registry", ["version", "packages"]);
    if (d.version !== 1)
      throw new ApplicationError(
        "presets.unsupported",
        "Unsupported preset registry version; no downgrade was attempted.",
        422,
      );
    if (
      !Array.isArray(d.packages) ||
      d.packages.length > PRESET_LIMITS.packages
    )
      throw presetStorageFailure();
    const packages = d.packages.map(validatePresetPackage),
      seen = new Set<string>();
    let entries = 0;
    for (const p of packages) {
      const key = `${p.id}@${p.version}`;
      if (seen.has(key)) throw presetStorageFailure();
      seen.add(key);
      entries += p.entries.length;
    }
    if (entries > PRESET_LIMITS.installedEntries) throw presetStorageFailure();
    return {
      version: 1,
      packages: packages.sort((a, b) =>
        `${a.id}@${a.version}` < `${b.id}@${b.version}` ? -1 : 1,
      ),
    };
  }
  private read(): RegistryFile {
    const f = this.storage.read();
    return f ? this.parse(f.text) : { version: 1, packages: [] };
  }
  private view(file: RegistryFile): PresetRegistryView {
    return {
      version: 1,
      revision: hash(file),
      packages: file.packages.map((p) => ({
        ...structuredClone(p),
        packageSha256: hash(p),
        entrySummaries: p.entries.map((e) => ({
          id: e.id,
          kind: e.kind,
          name: e.name,
          canonicalId: canonicalPresetId(p.id, p.version, e.kind, e.id),
        })),
      })),
    };
  }
  list(): PresetRegistryView {
    return this.view(this.read());
  }
  reviewImport(document: string): PresetImportReview {
    const p = parsePresetPackage(document),
      view = this.list(),
      packageSha256 = hash(p),
      installed = view.packages.find(
        (x) => x.id === p.id && x.version === p.version,
      );
    return {
      version: 1,
      package: p,
      packageSha256,
      registryRevision: view.revision,
      reviewSha256: hash({ packageSha256, registryRevision: view.revision }),
      alreadyInstalled: installed?.packageSha256 === packageSha256,
    };
  }
  async install(
    value: PresetInstallInput,
    signal?: AbortSignal,
  ): Promise<PresetRegistryView> {
    checkPresetAbort(signal);
    assertPresetJsonData(value, { text: 500000, tokens: 20000 });
    const d = presetRecord(value, "install", [
      "document",
      "packageSha256",
      "baseRegistryRevision",
      "reviewSha256",
      "acknowledgeLicense",
    ]);
    if (d.acknowledgeLicense !== true || typeof d.document !== "string")
      throw new ApplicationError(
        "presets.invalid",
        "Review and acknowledge the declared license before installation.",
      );
    for (const k of ["packageSha256", "baseRegistryRevision", "reviewSha256"])
      presetHash(d[k], `install.${k}`);
    const p = parsePresetPackage(d.document),
      packageSha = hash(p);
    if (
      packageSha !== d.packageSha256 ||
      hash({
        packageSha256: packageSha,
        registryRevision: d.baseRegistryRevision,
      }) !== d.reviewSha256
    )
      throw new ApplicationError(
        "presets.stale",
        "Package or review changed; review it again.",
        409,
      );
    checkPresetAbort(signal);
    return this.storage.withLock(() => {
      const previous = this.storage.read(),
        file = previous
          ? this.parse(previous.text)
          : { version: 1 as const, packages: [] };
      const old = file.packages.find(
        (x) => x.id === p.id && x.version === p.version,
      );
      if (old) {
        if (hash(old) === packageSha) return this.view(file);
        throw new ApplicationError(
          "presets.conflict",
          "Another recipe is already installed at this package ID and version.",
          409,
        );
      }
      if (hash(file) !== d.baseRegistryRevision)
        throw new ApplicationError(
          "presets.stale",
          "Preset registry changed; review it again.",
          409,
        );
      file.packages.push(p);
      if (
        file.packages.length > PRESET_LIMITS.packages ||
        file.packages.reduce((n, p) => n + p.entries.length, 0) >
          PRESET_LIMITS.installedEntries
      )
        throw new ApplicationError(
          "request.tooLarge",
          "Local preset registry capacity was reached.",
          413,
        );
      file.packages.sort((a, b) =>
        `${a.id}@${a.version}` < `${b.id}@${b.version}` ? -1 : 1,
      );
      this.storage.publish(canonicalPresetJson(file), previous, signal);
      return this.view(file);
    });
  }
  async remove(
    value: PresetRemoveInput,
    signal?: AbortSignal,
  ): Promise<PresetRegistryView> {
    checkPresetAbort(signal);
    assertPresetJsonData(value);
    const d = presetRecord(value, "remove", [
      "packageId",
      "packageVersion",
      "packageSha256",
      "baseRegistryRevision",
    ]);
    presetId(d.packageId, "packageId", 96);
    presetVersion(d.packageVersion);
    presetHash(d.packageSha256, "packageSha256");
    presetHash(d.baseRegistryRevision, "baseRegistryRevision");
    return this.storage.withLock(() => {
      const previous = this.storage.read(),
        file = previous
          ? this.parse(previous.text)
          : { version: 1 as const, packages: [] };
      if (hash(file) !== d.baseRegistryRevision)
        throw new ApplicationError(
          "presets.stale",
          "Preset registry changed before removal.",
          409,
        );
      const p = file.packages.find(
        (p) => p.id === d.packageId && p.version === d.packageVersion,
      );
      if (!p || hash(p) !== d.packageSha256)
        throw new ApplicationError(
          "presets.stale",
          "The exact package is no longer installed.",
          409,
        );
      file.packages = file.packages.filter(
        (p) => p.id !== d.packageId || p.version !== d.packageVersion,
      );
      this.storage.publish(canonicalPresetJson(file), previous, signal);
      return this.view(file);
    });
  }
  snapshot(selection: {
    canonicalId: string;
    packageSha256: string;
    registryRevision: string;
  }) {
    const view = this.list();
    if (view.revision !== selection.registryRevision)
      throw new ApplicationError(
        "presets.stale",
        "Preset registry changed since review.",
        409,
      );
    for (const p of view.packages) {
      if (p.packageSha256 !== selection.packageSha256) continue;
      const entry = p.entries.find(
        (e) =>
          canonicalPresetId(p.id, p.version, e.kind, e.id) ===
          selection.canonicalId,
      );
      if (entry) {
        const {
          packageSha256: _hash,
          entrySummaries: _summaries,
          ...document
        } = p;
        return createPresetSnapshot(document, entry);
      }
    }
    throw new ApplicationError(
      "presets.stale",
      "The exact local preset is not installed.",
      409,
    );
  }
  reviewRecovery(): PresetRecoveryReview {
    this.storage.ensure();
    const primary = this.storage.read();
    if (!primary)
      throw new ApplicationError(
        "presets.recoveryUnavailable",
        "No corrupt registry was found.",
        409,
      );
    try {
      this.parse(primary.text);
      throw new ApplicationError(
        "presets.recoveryUnavailable",
        "The current registry is valid; recovery is unnecessary.",
        409,
      );
    } catch (e) {
      if (
        e instanceof ApplicationError &&
        (e.code === "presets.unsupported" ||
          e.code === "presets.recoveryUnavailable")
      )
        throw e;
    }
    const backup = readPresetFile(
      this.storage.backupPath,
      PRESET_LIMITS.registryBytes,
    );
    if (!backup)
      throw new ApplicationError(
        "presets.recoveryUnavailable",
        "No verified registry backup is available.",
        409,
      );
    const file = this.parse(backup.text),
      primarySha256 = hashPresetData(primary.text),
      backupSha256 = hashPresetData(backup.text);
    return {
      version: 1,
      primarySha256,
      backupSha256,
      reviewSha256: hash({ primarySha256, backupSha256 }),
      packages: file.packages.length,
      entries: file.packages.reduce((n, p) => n + p.entries.length, 0),
    };
  }
  async recover(
    value: PresetRecoveryInput,
    signal?: AbortSignal,
  ): Promise<PresetRegistryView> {
    checkPresetAbort(signal);
    assertPresetJsonData(value);
    const d = presetRecord(value, "recovery", [
      "version",
      "primarySha256",
      "backupSha256",
      "reviewSha256",
      "packages",
      "entries",
      "acknowledgeRecovery",
    ]);
    if (d.acknowledgeRecovery !== true)
      throw new ApplicationError(
        "presets.invalid",
        "Acknowledge the reviewed backup recovery.",
      );
    return this.storage.withLock(() => {
      const review = this.reviewRecovery();
      const { acknowledgeRecovery: _ack, ...input } = value;
      if (canonicalPresetJson(review) !== canonicalPresetJson(input))
        throw new ApplicationError(
          "presets.stale",
          "Registry recovery changed; review it again.",
          409,
        );
      const previous = this.storage.read()!,
        backup = readPresetFile(
          this.storage.backupPath,
          PRESET_LIMITS.registryBytes,
        )!,
        file = this.parse(backup.text);
      const discardCopy = this.storage.preserveCorrupt(previous);
      let committed = false;
      try {
        this.storage.publish(canonicalPresetJson(file), previous, signal, true);
        committed = true;
        return this.view(file);
      } finally {
        if (!committed) discardCopy();
      }
    });
  }
}
