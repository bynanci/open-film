<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { MediaAsset } from "@openfilm/core";
import { api, type RelinkCandidate, type RelinkPlan } from "../api";
import Icon from "./Icon.vue";

const props = defineProps<{
  assets: MediaAsset[];
  assetIds?: string[];
  libraryId?: string;
  libraries?: {
    id: string;
    name: string;
    status: "online" | "offline" | "partial";
    roots: string[];
  }[];
  blocked?: boolean;
  beforeAction: () => Promise<boolean>;
}>();
const emit = defineEmits<{
  close: [];
  applied: [assets: MediaAsset[]];
  working: [active: boolean];
}>();
const mode = ref<"folder" | "file">("folder");
const scope = ref<"all" | "selected" | "library">(
  props.assetIds?.length ? "selected" : props.libraryId ? "library" : "all",
);
const selectedLibraryId = ref(props.libraryId ?? "");
const singleAssetId = ref(
  props.assetIds?.length === 1 ? props.assetIds[0]! : "",
);
const folderPath = ref("");
const filePath = ref("");
const location = computed({
  get: () => (mode.value === "folder" ? folderPath.value : filePath.value),
  set: (value: string) => {
    if (mode.value === "folder") folderPath.value = value;
    else filePath.value = value;
  },
});
const operation = ref<"" | "checking" | "planning" | "applying" | "picking">(
  "",
);
const disabled = computed(() => !!props.blocked || !!operation.value);
const error = ref("");
const notice = ref("");
const plan = ref<RelinkPlan | null>(null);
const choices = ref<Record<string, string>>({});
const confirmations = ref<Record<string, boolean>>({});
const reviewAssets = ref<Record<string, MediaAsset>>({});
const native = !!window.__TAURI_INTERNALS__;
const assetsById = computed(
  () =>
    new Map(
      [...Object.values(reviewAssets.value), ...props.assets].map((asset) => [
        asset.id,
        asset,
      ]),
    ),
);
const selectedIds = computed(() => [...new Set(props.assetIds ?? [])]);
const fileAssets = computed(() => {
  const entries = new Map(
    props.assets.map((asset) => [asset.id, { id: asset.id, name: asset.name }]),
  );
  for (const id of selectedIds.value)
    if (!entries.has(id)) entries.set(id, { id, name: id });
  return [...entries.values()].sort((a, b) => a.name.localeCompare(b.name));
});
const currentLibrary = computed(() =>
  props.libraries?.find((library) => library.id === selectedLibraryId.value),
);
const scopeLabel = computed(() => {
  if (mode.value === "file")
    return singleAssetId.value
      ? `Selected media · ${assetName(singleAssetId.value)}`
      : "Choose the original media to reconnect.";
  if (scope.value === "selected")
    return `Selected media · ${selectedIds.value.length} ${selectedIds.value.length === 1 ? "item" : "items"}`;
  if (scope.value === "library")
    return currentLibrary.value
      ? `${currentLibrary.value.name} · ${libraryStatus(currentLibrary.value.status)}`
      : "Choose a media library to reconnect.";
  return "All project media, including items outside the current Library page.";
});
const canPlan = computed(
  () =>
    !disabled.value &&
    !!location.value.trim() &&
    (mode.value === "file"
      ? !!singleAssetId.value
      : scope.value === "selected"
        ? selectedIds.value.length > 0
        : scope.value !== "library" || !!selectedLibraryId.value),
);
const selections = computed(() =>
  (plan.value?.matches ?? []).flatMap((match) => {
    const candidate = match.candidates.find(
      (item) => item.id === choices.value[match.assetId],
    );
    return candidate
      ? [
          {
            assetId: match.assetId,
            candidate,
            confirmed: !!confirmations.value[match.assetId],
          },
        ]
      : [];
  }),
);
const unconfirmed = computed(
  () =>
    selections.value.filter(
      (item) => !item.candidate.automatic && !item.confirmed,
    ).length,
);
const unselected = computed(
  () => (plan.value?.matches.length ?? 0) - selections.value.length,
);

function assetName(id: string) {
  return assetsById.value.get(id)?.name ?? id;
}
function originalPath(id: string) {
  const asset = assetsById.value.get(id);
  const reference = asset?.metadata["openfilm.reference"];
  if (
    typeof reference === "object" &&
    reference !== null &&
    "originalUri" in reference &&
    typeof reference.originalUri === "string"
  )
    return reference.originalUri;
  return asset?.uri;
}
function libraryStatus(status: "online" | "offline" | "partial") {
  return {
    online: "Online",
    offline: "Library offline",
    partial: "Some media missing",
  }[status];
}
function matchLabel(candidate: RelinkCandidate) {
  if (candidate.match === "content-hash" && !candidate.automatic)
    return "Content verified; choose the intended copy/location";
  return {
    "content-hash": "Verified content match",
    "relative-path": "Same relative path",
    "filename-size": "Same filename and size",
    manual: "Manually chosen file",
  }[candidate.match];
}
function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function resetPlan() {
  plan.value = null;
  choices.value = {};
  confirmations.value = {};
  error.value = "";
  notice.value = "";
}
function choose(assetId: string, candidateId: string) {
  choices.value = { ...choices.value, [assetId]: candidateId };
  confirmations.value = { ...confirmations.value, [assetId]: false };
}
function chosenCandidate(assetId: string) {
  return plan.value?.matches
    .find((match) => match.assetId === assetId)
    ?.candidates.find((candidate) => candidate.id === choices.value[assetId]);
}
async function prepareAction() {
  operation.value = "checking";
  if (!(await props.beforeAction())) {
    error.value =
      "Save your timeline edits before reconnecting media. Return to Timeline to resolve any unsaved changes.";
    return false;
  }
  if (props.blocked) {
    error.value =
      "Wait for the current import or render to finish before reconnecting media.";
    return false;
  }
  return true;
}
async function browse() {
  if (disabled.value) return;
  operation.value = "picking";
  error.value = "";
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const path = await invoke<string | null>(
      mode.value === "folder" ? "pick_folder" : "pick_file",
    );
    if (path) location.value = path;
  } catch {
    error.value = `The ${mode.value === "folder" ? "folder" : "file"} picker is unavailable. Enter the full path in the field below.`;
  } finally {
    operation.value = "";
  }
}
async function findMatches() {
  if (!canPlan.value) return;
  resetPlan();
  try {
    if (!(await prepareAction())) return;
    operation.value = "planning";
    const result = await api.relinkPlan(
      mode.value === "file"
        ? { assetIds: [singleAssetId.value], file: location.value.trim() }
        : {
            folder: location.value.trim(),
            ...(scope.value === "selected"
              ? { assetIds: selectedIds.value }
              : {}),
            ...(scope.value === "library"
              ? { libraryId: selectedLibraryId.value }
              : {}),
          },
    );
    const missingIds = result.matches
      .map((match) => match.assetId)
      .filter((id) => !assetsById.value.has(id));
    for (let index = 0; index < missingIds.length; index += 60) {
      const ids = missingIds.slice(index, index + 60);
      const result = await api.assets(
        new URLSearchParams({ ids: ids.join(","), limit: String(ids.length) }),
      );
      for (const asset of result.assets) reviewAssets.value[asset.id] = asset;
    }
    choices.value = Object.fromEntries(
      result.matches.map((match) => {
        const candidate =
          match.candidates.length === 1 ? match.candidates[0] : undefined;
        return [
          match.assetId,
          candidate?.automatic && match.suggestedId === candidate.id
            ? candidate.id
            : "",
        ];
      }),
    );
    plan.value = result;
    notice.value = result.matches.length
      ? "Search complete. Review the file matches before applying them."
      : "No media was found in this scope. Choose another scope or a selected media item.";
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    operation.value = "";
  }
}
async function applyMatches() {
  if (
    disabled.value ||
    !plan.value ||
    !selections.value.length ||
    unconfirmed.value
  )
    return;
  error.value = "";
  notice.value = "";
  try {
    if (!(await prepareAction())) return;
    operation.value = "applying";
    const result = await api.relinkApply({
      planId: plan.value.id,
      selections: selections.value.map(({ assetId, candidate, confirmed }) => ({
        assetId,
        candidateId: candidate.id,
        ...(!candidate.automatic ? { confirm: confirmed } : {}),
      })),
    });
    const untouched = unselected.value;
    resetPlan();
    notice.value = `${result.assets.length} ${result.assets.length === 1 ? "media item reconnected" : "media items reconnected"}.${untouched ? ` ${untouched} unselected ${untouched === 1 ? "item was" : "items were"} left unchanged.` : ""}`;
    emit("applied", result.assets);
  } catch (cause) {
    error.value = `${cause instanceof Error ? cause.message : String(cause)} Review your choices or find matches again to refresh the search.`;
  } finally {
    operation.value = "";
  }
}

watch(operation, (value) => emit("working", !!value), { flush: "sync" });
watch(
  [mode, scope, selectedLibraryId, singleAssetId, folderPath, filePath],
  resetPlan,
);
watch(
  () => [props.assetIds, props.libraryId] as const,
  () => {
    scope.value = props.assetIds?.length
      ? "selected"
      : props.libraryId
        ? "library"
        : "all";
    selectedLibraryId.value = props.libraryId ?? "";
    singleAssetId.value =
      props.assetIds?.length === 1 ? props.assetIds[0]! : "";
    resetPlan();
  },
  { deep: true },
);
</script>

<template>
  <section
    class="relink-panel"
    aria-label="Relink media"
    :aria-busy="!!operation"
  >
    <header class="relink-heading">
      <div>
        <span class="relink-kicker">BRING YOUR MOMENTS BACK</span>
        <h2>Reconnect your media.</h2>
        <p>
          Find moved files and review the matches. Your ratings, stories, and
          edits stay with each memory.
        </p>
      </div>
      <button
        class="relink-close"
        aria-label="Close relink media"
        :disabled="!!operation"
        @click="emit('close')"
      >
        <Icon name="reject" :size="18" />
      </button>
    </header>

    <p v-if="blocked" class="relink-message caution" role="status">
      An import or render is active. Reconnect media when it finishes.
    </p>
    <p v-if="error" class="relink-message error" role="alert">{{ error }}</p>
    <p v-if="notice" class="relink-message success" role="status">
      {{ notice }}
    </p>

    <form class="relink-search" @submit.prevent="findMatches">
      <fieldset :disabled="disabled">
        <legend class="relink-legend">Where are the files now?</legend>
        <div
          class="relink-modes"
          role="group"
          aria-label="Relink search method"
        >
          <button
            type="button"
            :class="{ selected: mode === 'folder' }"
            :aria-pressed="mode === 'folder'"
            @click="mode = 'folder'"
          >
            Search a folder
          </button>
          <button
            type="button"
            :class="{ selected: mode === 'file' }"
            :aria-pressed="mode === 'file'"
            @click="mode = 'file'"
          >
            Choose one file
          </button>
        </div>
        <div class="relink-search-fields">
          <label v-if="mode === 'folder'" class="relink-field">
            Media to search for
            <select v-model="scope" aria-label="Media to search for">
              <option value="all">All project media</option>
              <option value="selected" :disabled="!selectedIds.length">
                Selected media
              </option>
              <option value="library" :disabled="!libraries?.length">
                One media library
              </option>
            </select>
          </label>
          <label
            v-if="mode === 'folder' && scope === 'library'"
            class="relink-field"
          >
            Media library
            <select
              v-model="selectedLibraryId"
              aria-label="Media library"
              required
            >
              <option value="" disabled>Choose a library…</option>
              <option
                v-for="library in libraries"
                :key="library.id"
                :value="library.id"
              >
                {{ library.name }} · {{ libraryStatus(library.status) }}
              </option>
            </select>
          </label>
          <label v-if="mode === 'file'" class="relink-field">
            Media to relink
            <select
              v-model="singleAssetId"
              aria-label="Media to relink"
              required
            >
              <option value="" disabled>Choose a media item…</option>
              <option
                v-for="asset in fileAssets"
                :key="asset.id"
                :value="asset.id"
              >
                {{ asset.name }}
              </option>
            </select>
          </label>
          <label class="relink-field relink-location">
            {{
              mode === "folder" ? "Search folder path" : "Replacement file path"
            }}
            <span class="relink-path-input">
              <input
                v-model="location"
                :aria-label="
                  mode === 'folder'
                    ? 'Search folder path'
                    : 'Replacement file path'
                "
                :placeholder="
                  mode === 'folder'
                    ? '/Volumes/My drive/Media'
                    : '/Volumes/My drive/Media/clip.mov'
                "
                type="text"
                spellcheck="false"
                required
              />
              <button
                v-if="native"
                type="button"
                class="relink-button"
                :aria-label="
                  mode === 'folder' ? 'Browse folder' : 'Browse file'
                "
                @click="browse"
              >
                <Icon name="folder" :size="15" />Browse
              </button>
            </span>
          </label>
          <button
            type="submit"
            class="relink-button primary"
            :disabled="!canPlan"
          >
            {{
              operation === "planning"
                ? "Finding matches…"
                : operation === "checking"
                  ? "Saving edits…"
                  : "Find matches"
            }}<Icon name="search" :size="15" />
          </button>
        </div>
        <p class="relink-scope">{{ scopeLabel }}</p>
        <p
          v-if="
            mode === 'folder' &&
            scope === 'library' &&
            currentLibrary?.roots.length
          "
          class="relink-roots"
        >
          Previous locations:
          <span v-for="root in currentLibrary.roots" :key="root">{{
            root
          }}</span>
        </p>
        <p v-if="mode === 'file' && !fileAssets.length" class="relink-help">
          Choose a media item in the Library, then open Relink media from its
          details.
        </p>
      </fieldset>
    </form>

    <section
      v-if="plan?.matches.length"
      class="relink-review"
      aria-label="Review relink matches"
    >
      <div class="relink-review-heading">
        <h3>Review the matches</h3>
        <span
          >{{ selections.length }} of {{ plan.matches.length }} selected</span
        >
      </div>
      <p class="relink-help">
        Content matches are selected when there is one verified file. Choose
        among other candidates and confirm the file and location for each
        selection.
      </p>
      <fieldset
        v-for="match in plan.matches"
        :key="match.assetId"
        class="relink-match"
        :disabled="disabled"
      >
        <legend>{{ assetName(match.assetId) }}</legend>
        <div class="relink-original">
          <span>Original source</span>
          <code>{{
            originalPath(match.assetId) ??
            "Source details unavailable for this media item."
          }}</code>
          <template
            v-if="
              assetsById.get(match.assetId)?.uri &&
              assetsById.get(match.assetId)?.uri !== originalPath(match.assetId)
            "
            ><span>Current source</span
            ><code>{{ assetsById.get(match.assetId)?.uri }}</code></template
          >
        </div>
        <p v-if="match.reason" class="relink-reason">{{ match.reason }}</p>
        <p v-if="!match.candidates.length" class="relink-no-match">
          No matching file found. Check the folder or choose one replacement
          file to review.
        </p>
        <div v-else class="relink-candidates">
          <label
            v-for="candidate in match.candidates"
            :key="candidate.id"
            class="relink-candidate"
            :class="{ selected: choices[match.assetId] === candidate.id }"
          >
            <input
              type="radio"
              :name="`relink-${plan.id}-${match.assetId}`"
              :value="candidate.id"
              :checked="choices[match.assetId] === candidate.id"
              :aria-label="`Use ${candidate.path} for ${assetName(match.assetId)}`"
              @change="choose(match.assetId, candidate.id)"
            />
            <span class="relink-candidate-copy">
              <span class="relink-evidence"
                ><strong>{{ matchLabel(candidate) }}</strong
                ><span
                  :class="{ verified: candidate.match === 'content-hash' }"
                  >{{
                    candidate.automatic
                      ? "Verified"
                      : candidate.match === "content-hash"
                        ? "Choose intended copy"
                        : "Confirmation needed"
                  }}</span
                ><small>{{ fileSize(candidate.fileSize) }}</small></span
              >
              <code>{{ candidate.path }}</code>
              <small>{{ candidate.reason }}</small>
            </span>
          </label>
          <label class="relink-skip"
            ><input
              type="radio"
              :name="`relink-${plan.id}-${match.assetId}`"
              value=""
              :checked="!choices[match.assetId]"
              :aria-label="`Leave ${assetName(match.assetId)} unchanged`"
              @change="choose(match.assetId, '')"
            />Leave this media unchanged</label
          >
        </div>
        <label
          v-if="
            chosenCandidate(match.assetId) &&
            !chosenCandidate(match.assetId)?.automatic
          "
          class="relink-confirm"
        >
          <input
            v-model="confirmations[match.assetId]"
            type="checkbox"
            :aria-label="`Confirm ${assetName(match.assetId)} matches the selected file`"
          />
          <span
            >I checked that this is the correct file for
            <strong>{{ assetName(match.assetId) }}</strong
            >.
            {{
              chosenCandidate(match.assetId)?.match === "content-hash"
                ? "Its content is verified; this is the copy and location I want to use."
                : "This match has not been verified by content hash."
            }}</span
          >
        </label>
      </fieldset>
      <footer class="relink-apply">
        <div>
          <strong
            >{{ selections.length }}
            {{ selections.length === 1 ? "match" : "matches" }} selected</strong
          >
          <p v-if="unselected">
            {{ unselected }} unselected
            {{ unselected === 1 ? "item will" : "items will" }} stay unchanged.
          </p>
          <p v-if="unconfirmed" class="relink-confirm-needed">
            Confirm {{ unconfirmed }}
            {{ unconfirmed === 1 ? "match" : "matches" }} before applying.
          </p>
        </div>
        <button
          type="button"
          class="relink-button primary"
          :disabled="disabled || !selections.length || !!unconfirmed"
          @click="applyMatches"
        >
          {{
            operation === "applying"
              ? "Reconnecting media…"
              : "Apply selected matches"
          }}<Icon name="check" :size="15" />
        </button>
      </footer>
    </section>
  </section>
</template>
