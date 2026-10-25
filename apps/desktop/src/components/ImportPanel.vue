<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { SourceDraft, SourceSelection } from "@openfilm/core";
import type { SourceSelectionInput } from "@openfilm/application";
import type { BrowserSourceAvailability } from "../browserSourceAccess";
import { api } from "../api";
import {
  classifyNativeDrop,
  browserFilesForSelections,
  clearBrowserEphemeral,
  listenForNativeDrop,
  pickBrowserFallbackFolders,
  pickBrowserFiles,
  pickBrowserFolder,
  pickNativeFiles,
  pickNativeFolders,
  releaseBrowserSources,
  sourcesFromBrowserDrop,
  sourceAvailability,
  type PickedSources,
} from "../sourcePicker";
import Icon from "./Icon.vue";

const props = defineProps<{
  projectId: string;
  native: boolean;
  busy: boolean;
  expert: boolean;
  progress?: {
    completed: number;
    total: number;
    bytesUploaded: number;
    totalBytes: number;
  };
}>();
const emit = defineEmits<{
  error: [error: unknown];
  close: [];
  cancel: [];
  folder: [path: string];
  files: [paths: string[]];
  upload: [files: File[]];
}>();
const { t } = useI18n();
const draft = ref<SourceDraft>();
const loading = ref(false);
const mutating = ref(false);
const dragging = ref(false);
const rejected = ref<PickedSources["rejected"]>([]);
const access = ref<Record<string, BrowserSourceAvailability>>({});
const fileInput = ref<HTMLInputElement | null>(null);
const folderInput = ref<HTMLInputElement | null>(null);
const serverPath = ref("");
const serverPathOpen = ref(false);
let generation = 0;
let draftReadSequence = 0;
let removeNativeDrop: (() => void) | undefined;

const blocked = computed(() => props.busy || loading.value || mutating.value);
const folderCount = computed(
  () =>
    draft.value?.selections.filter((source) => source.kind === "folder")
      .length ?? 0,
);
const fileCount = computed(
  () =>
    draft.value?.selections.filter((source) => source.kind === "file").length ??
    0,
);
const compatibleStart = computed(() => {
  const selections = draft.value?.selections ?? [];
  if (!selections.length) return false;
  if (
    selections.length === 1 &&
    selections[0]!.kind === "folder" &&
    selections[0]!.accessClass === "native-path" &&
    selections[0]!.recursive
  )
    return true;
  if (
    selections.every(
      (source) =>
        source.kind === "file" && source.accessClass === "native-path",
    )
  )
    return true;
  return selections.every(
    (source) =>
      source.kind === "file" &&
      source.accessClass === "ephemeral-browser-file" &&
      access.value[source.id] === "available",
  );
});

function requestId(): string {
  return crypto.randomUUID();
}

async function refreshAvailability(
  snapshot: SourceDraft,
  owner: string,
  token: number,
): Promise<void> {
  const entries = await Promise.all(
    snapshot.selections.map(
      async (source) =>
        [source.id, await sourceAvailability(owner, source)] as const,
    ),
  );
  if (
    token !== generation ||
    owner !== props.projectId ||
    draft.value?.revision !== snapshot.revision
  )
    return;
  access.value = Object.fromEntries(entries);
}

function acceptDraft(next: SourceDraft, owner: string, token: number): void {
  if (token !== generation || owner !== props.projectId) return;
  draft.value = next;
  access.value = {};
  void refreshAvailability(next, owner, token).catch((error) => {
    if (token === generation && owner === props.projectId) emit("error", error);
  });
}

async function loadDraft(): Promise<SourceDraft | undefined> {
  const owner = props.projectId;
  const token = generation;
  const readSequence = ++draftReadSequence;
  loading.value = true;
  try {
    const result = await api.sourceDraft();
    if (result.draft.projectId !== owner) return undefined;
    if (token === generation && readSequence === draftReadSequence)
      acceptDraft(result.draft, owner, token);
    return result.draft;
  } catch (error) {
    if (
      token === generation &&
      readSequence === draftReadSequence &&
      owner === props.projectId
    )
      emit("error", error);
    return undefined;
  } finally {
    if (token === generation && readSequence === draftReadSequence)
      loading.value = false;
  }
}

function applicationErrorCode(error: unknown): string | undefined {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  )
    return error.code;
  return undefined;
}

function mutationFailureIsAmbiguous(error: unknown): boolean {
  const code = applicationErrorCode(error);
  if (code === "workspace.unavailable" || code === "workspace.invalidResponse")
    return true;
  if (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof error.status === "number"
  )
    return error.status === 0;
  return code === undefined;
}

async function handleMutationError(
  error: unknown,
  owner: string,
  token: number,
): Promise<SourceDraft | undefined> {
  if (token !== generation || owner !== props.projectId) return undefined;
  emit("error", error);
  if (applicationErrorCode(error) !== "import.draftStale") return undefined;
  mutating.value = false;
  return loadDraft();
}

type MutationAttempt<T> =
  { ok: true; value: T } | { ok: false; error: unknown; ambiguous: boolean };

async function reconcileMutationFailure(
  attempted: Extract<MutationAttempt<unknown>, { ok: false }>,
  owner: string,
  token: number,
): Promise<SourceDraft | undefined> {
  const staleDraft = await handleMutationError(attempted.error, owner, token);
  if (
    staleDraft ||
    !attempted.ambiguous ||
    token !== generation ||
    owner !== props.projectId
  )
    return staleDraft;
  mutating.value = false;
  return loadDraft();
}

async function attemptMutation<T>(
  action: () => Promise<T>,
): Promise<MutationAttempt<T>> {
  try {
    return { ok: true, value: await action() };
  } catch (error) {
    if (!mutationFailureIsAmbiguous(error))
      return { ok: false, error, ambiguous: false };
    try {
      return { ok: true, value: await action() };
    } catch (retryError) {
      return { ok: false, error: retryError, ambiguous: true };
    }
  }
}

interface AddSourcesOutcome {
  saved: boolean;
  cleanupSafe: boolean;
  authoritative?: SourceDraft;
}

async function addSources(
  sources: SourceSelectionInput[],
): Promise<AddSourcesOutcome> {
  if (!sources.length)
    return { saved: true, cleanupSafe: true, authoritative: draft.value };
  if (blocked.value || !draft.value) return { saved: false, cleanupSafe: true };
  const owner = props.projectId;
  const token = generation;
  const mutationRequestId = requestId();
  const baseRevision = draft.value.revision;
  mutating.value = true;
  try {
    const attempted = await attemptMutation(() =>
      api.addSourceSelections({
        projectId: owner,
        baseRevision,
        requestId: mutationRequestId,
        sources,
      }),
    );
    if (!attempted.ok) {
      const authoritative = await reconcileMutationFailure(
        attempted,
        owner,
        token,
      );
      return {
        saved: false,
        cleanupSafe:
          authoritative !== undefined ||
          (!attempted.ambiguous &&
            applicationErrorCode(attempted.error) !== undefined),
        authoritative,
      };
    }
    const result = attempted.value;
    acceptDraft(result.draft, owner, token);
    return {
      saved: true,
      cleanupSafe: true,
      authoritative: result.draft,
    };
  } finally {
    if (token === generation) mutating.value = false;
  }
}

function retainedAccessRefs(
  owner: string,
  authoritative?: SourceDraft,
): Set<string> {
  const snapshot = authoritative ?? draft.value;
  if (snapshot?.projectId !== owner) return new Set();
  return new Set(snapshot.selections.map((source) => source.accessRef));
}

async function releaseSources(
  owner: string,
  sources: readonly Pick<SourceSelectionInput, "accessClass" | "accessRef">[],
  token: number,
  authoritative?: SourceDraft,
): Promise<void> {
  try {
    await releaseBrowserSources(
      owner,
      sources,
      retainedAccessRefs(owner, authoritative),
    );
  } catch (error) {
    if (token === generation && owner === props.projectId) emit("error", error);
  }
}

async function applyPicked(
  action: () => Promise<PickedSources> | PickedSources,
): Promise<boolean> {
  if (blocked.value) return false;
  const owner = props.projectId;
  const token = generation;
  try {
    const result = await action();
    if (token !== generation || owner !== props.projectId) {
      await releaseSources(owner, result.sources, token);
      return false;
    }
    rejected.value = result.rejected;
    const outcome = await addSources(result.sources);
    if (outcome.cleanupSafe)
      await releaseSources(owner, result.sources, token, outcome.authoritative);
    return outcome.saved;
  } catch (error) {
    if (token === generation && owner === props.projectId) emit("error", error);
    return false;
  }
}

async function chooseFolder() {
  if (props.native) return applyPicked(pickNativeFolders);
  const owner = props.projectId;
  const token = generation;
  try {
    const picked = await pickBrowserFolder(owner);
    if (token !== generation || owner !== props.projectId) {
      if (picked) await releaseSources(owner, picked.sources, token);
      return;
    }
    if (picked === undefined) folderInput.value?.click();
    else await applyPicked(() => picked);
  } catch (error) {
    if (token === generation && owner === props.projectId) emit("error", error);
  }
}

async function chooseFiles() {
  if (props.native) return applyPicked(pickNativeFiles);
  fileInput.value?.click();
}

async function addServerFolder(): Promise<void> {
  const accessRef = serverPath.value.trim();
  if (!accessRef) return;
  const displayName =
    accessRef.split(/[\\/]/u).filter(Boolean).at(-1) ?? accessRef;
  const saved = await applyPicked(() => ({
    sources: [
      {
        kind: "folder",
        displayName,
        accessClass: "native-path",
        accessRef,
        recursive: true,
      },
    ],
    rejected: [],
  }));
  if (saved) {
    serverPath.value = "";
    serverPathOpen.value = false;
  }
}

async function chosen(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = "";
  await applyPicked(() => pickBrowserFiles(props.projectId, files));
}

async function folderChosen(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = "";
  await applyPicked(() => pickBrowserFallbackFolders(props.projectId, files));
}

function startCompatible(): void {
  if (blocked.value || !compatibleStart.value || !draft.value) return;
  const selections = draft.value.selections;
  const folder = selections.length === 1 ? selections[0] : undefined;
  if (folder?.kind === "folder" && folder.accessClass === "native-path") {
    emit("folder", folder.accessRef);
    return;
  }
  if (selections.every((source) => source.accessClass === "native-path")) {
    emit(
      "files",
      selections.map((source) => source.accessRef),
    );
    return;
  }
  const files = browserFilesForSelections(props.projectId, selections);
  if (files?.length) emit("upload", files);
}

async function dropped(event: DragEvent) {
  dragging.value = false;
  if (blocked.value || props.native || !event.dataTransfer) return;
  const transfer = event.dataTransfer;
  await applyPicked(() => sourcesFromBrowserDrop(props.projectId, transfer));
}

async function removeSource(source: SourceSelection) {
  if (blocked.value || !draft.value) return;
  const owner = props.projectId;
  const token = generation;
  const mutationRequestId = requestId();
  const baseRevision = draft.value.revision;
  mutating.value = true;
  try {
    const attempted = await attemptMutation(() =>
      api.removeSourceSelection(source.id, {
        projectId: owner,
        baseRevision,
        requestId: mutationRequestId,
      }),
    );
    if (!attempted.ok) {
      const authoritative = await reconcileMutationFailure(
        attempted,
        owner,
        token,
      );
      if (authoritative)
        await releaseSources(owner, [source], token, authoritative);
      return;
    }
    const result = attempted.value;
    acceptDraft(result.draft, owner, token);
    await releaseSources(owner, [source], token, result.draft);
  } finally {
    if (token === generation) mutating.value = false;
  }
}

async function setRecursive(source: SourceSelection, recursive: boolean) {
  if (blocked.value || !draft.value) return;
  const owner = props.projectId;
  const token = generation;
  const mutationRequestId = requestId();
  const baseRevision = draft.value.revision;
  mutating.value = true;
  try {
    const attempted = await attemptMutation(() =>
      api.updateSourceSelection(source.id, {
        projectId: owner,
        baseRevision,
        requestId: mutationRequestId,
        recursive,
      }),
    );
    if (!attempted.ok) {
      await reconcileMutationFailure(attempted, owner, token);
      return;
    }
    const result = attempted.value;
    acceptDraft(result.draft, owner, token);
  } finally {
    if (token === generation) mutating.value = false;
  }
}

watch(
  () => props.projectId,
  (projectId, previous) => {
    generation++;
    draftReadSequence++;
    draft.value = undefined;
    access.value = {};
    rejected.value = [];
    if (previous && previous !== projectId) clearBrowserEphemeral(previous);
    void loadDraft();
  },
  { immediate: true },
);

onMounted(async () => {
  if (!props.native) return;
  const token = generation;
  const owner = props.projectId;
  try {
    const dispose = await listenForNativeDrop((event) => {
      if (token !== generation || owner !== props.projectId) return;
      dragging.value = event.type === "enter" || event.type === "over";
      if (event.type === "drop" && !blocked.value)
        void applyPicked(() => classifyNativeDrop(event.paths));
    });
    if (token !== generation || owner !== props.projectId) dispose();
    else removeNativeDrop = dispose;
  } catch {
    /* Picker buttons remain usable if native drop events are unavailable. */
  }
});
onBeforeUnmount(() => {
  generation++;
  removeNativeDrop?.();
});
</script>

<template>
  <section
    class="import-panel inline-form"
    :class="{ 'is-expert': expert }"
    :aria-label="t('app.import.label')"
  >
    <header class="import-heading">
      <div>
        <span class="eyebrow">{{ t("app.import.eyebrow") }}</span>
        <h2>{{ t("app.import.title") }}</h2>
        <p>{{ t("app.import.description") }}</p>
      </div>
      <button
        class="icon-button"
        :disabled="!!progress"
        :aria-label="t('app.import.close')"
        @click="emit('close')"
      >
        <Icon name="reject" />
      </button>
    </header>

    <div
      class="import-dropzone"
      :class="{ dragging }"
      @dragover.prevent="dragging = true"
      @dragleave.prevent="dragging = false"
      @drop.prevent="dropped"
    >
      <div class="import-dropzone-copy">
        <span class="import-dropzone-icon"
          ><Icon name="folder" :size="28"
        /></span>
        <div>
          <strong>{{ t("app.import.dropTitle") }}</strong>
          <p>{{ t("app.import.drop") }}</p>
        </div>
      </div>
      <div class="import-picker-actions">
        <div class="import-actions">
          <button class="primary" :disabled="blocked" @click="chooseFolder">
            <Icon name="folder" />{{ t("app.import.addFolder") }}</button
          ><button class="secondary" :disabled="blocked" @click="chooseFiles">
            <Icon name="plus" />{{ t("app.import.addFiles") }}
          </button>
        </div>
        <button
          v-if="!native"
          class="text-button import-server-path-toggle"
          :disabled="blocked"
          @click="serverPathOpen = !serverPathOpen"
        >
          {{ t("app.import.addPath") }}
        </button>
      </div>
      <input
        ref="fileInput"
        type="file"
        multiple
        hidden
        :aria-label="t('app.import.addFiles')"
        @change="chosen"
      />
      <input
        ref="folderInput"
        type="file"
        multiple
        webkitdirectory
        hidden
        :aria-label="t('app.import.addFolder')"
        @change="folderChosen"
      />
    </div>

    <form
      v-if="serverPathOpen"
      class="import-folder-form"
      @submit.prevent="addServerFolder"
    >
      <label class="field">
        {{ t("app.import.folder") }}
        <input
          :value="serverPath"
          name="media-folder"
          required
          autocomplete="off"
          @input="serverPath = ($event.target as HTMLInputElement).value"
        />
      </label>
      <button class="secondary" :disabled="blocked || !serverPath.trim()">
        {{ t("app.import.addPathSubmit") }}<Icon name="arrow" />
      </button>
    </form>

    <div class="import-summary" role="status" aria-live="polite">
      <span>{{ t("app.import.folderCount", { count: folderCount }) }}</span>
      <span>{{ t("app.import.fileCount", { count: fileCount }) }}</span>
      <span v-if="draft">{{
        t("app.import.savedRevision", { revision: draft.revision })
      }}</span>
    </div>

    <p v-if="loading" class="muted" role="status">
      {{ t("app.import.loadingDraft") }}
    </p>
    <p v-else-if="!draft?.selections.length" class="import-empty">
      {{ t("app.import.emptyDraft") }}
    </p>
    <ul v-else class="import-source-list" :aria-label="t('app.import.sources')">
      <li
        v-for="source in draft.selections"
        :key="source.id"
        class="import-source-card"
        :data-source-id="source.id"
      >
        <span class="import-source-kind" aria-hidden="true">
          <Icon :name="source.kind === 'folder' ? 'folder' : 'media'" />
        </span>
        <div class="import-source-copy">
          <strong>{{ source.displayName }}</strong>
          <span>{{ t(`app.import.kind.${source.kind}`) }}</span>
          <span
            v-if="access[source.id] && access[source.id] !== 'available'"
            class="import-access-warning"
            role="status"
          >
            {{ t(`app.import.access.${access[source.id]}`) }}
          </span>
          <code v-if="expert">{{ source.accessRef }}</code>
          <small v-if="expert"
            >{{ source.accessClass }} · r{{ source.selectionRevision }}</small
          >
        </div>
        <label v-if="source.kind === 'folder'" class="import-recursive">
          <input
            type="checkbox"
            :checked="source.recursive"
            :disabled="blocked"
            @change="
              setRecursive(source, ($event.target as HTMLInputElement).checked)
            "
          />
          {{ t("app.import.includeSubfolders") }}
        </label>
        <button
          class="icon-button"
          :disabled="blocked"
          :aria-label="
            t('app.import.removeSource', { name: source.displayName })
          "
          @click="removeSource(source)"
        >
          <Icon name="reject" />
        </button>
      </li>
    </ul>

    <p v-if="rejected.length" class="callout warning" role="alert">
      {{ t("app.import.rejected", { count: rejected.length }) }}
    </p>
    <div v-if="progress" class="import-progress" role="status">
      <p>
        {{
          t("app.import.uploading", {
            completed: progress.completed,
            total: progress.total,
          })
        }}
      </p>
      <progress
        :value="progress.bytesUploaded"
        :max="progress.totalBytes || 1"
        :aria-label="t('app.import.uploadProgress')"
      />
      <button class="text-button" @click="emit('cancel')">
        {{ t("app.import.cancelUpload") }}
      </button>
    </div>
    <footer class="import-draft-footer">
      <div>
        <strong>{{ t("app.import.draftSaved") }}</strong>
        <p>{{ t("app.import.draftNext") }}</p>
      </div>
      <div class="import-draft-actions">
        <button
          v-if="draft?.selections.length"
          class="primary"
          :disabled="blocked || !compatibleStart"
          @click="startCompatible"
        >
          {{ t("app.import.startCompatible") }}
        </button>
        <p v-if="draft?.selections.length && !compatibleStart" class="muted">
          {{ t("app.import.startPending") }}
        </p>
        <p class="muted">{{ t("app.import.originals") }}</p>
      </div>
    </footer>
  </section>
</template>
