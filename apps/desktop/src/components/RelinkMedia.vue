<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { errorDetail, formatNumber, localizeError } from "../i18n";
import { compactPath } from "../sourcePresentation";
const { t } = useI18n();
type Message = {
  key: string;
  params?: Record<string, string | number>;
  count?: number;
};
function message(value: Message) {
  return value.count === undefined
    ? t(value.key, value.params ?? {})
    : t(
        value.key,
        { ...value.params, count: formatNumber(value.count) },
        value.count,
      );
}
function isMessage(value: unknown): value is Message {
  return !!value && typeof value === "object" && "key" in value;
}
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
const error = ref<unknown>(null);
const notice = ref<Message[]>([]);
const errorMessage = computed(() =>
  !error.value
    ? ""
    : isMessage(error.value)
      ? message(error.value)
      : localizeError(error.value),
);
const technicalError = computed(() =>
  error.value && !isMessage(error.value) ? errorDetail(error.value) : "",
);
const noticeMessage = computed(() => notice.value.map(message).join(" "));
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
      ? t("media.relink.selectedName", { name: assetName(singleAssetId.value) })
      : t("media.relink.chooseOriginal");
  if (scope.value === "selected")
    return message({
      key: "media.relink.selectedCount",
      count: selectedIds.value.length,
    });
  if (scope.value === "library")
    return currentLibrary.value
      ? `${currentLibrary.value.name} · ${libraryStatus(currentLibrary.value.status)}`
      : t("media.relink.chooseLibraryHelp");
  return t("media.relink.allHelp");
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
  return t(`media.relink.${status}`);
}
function matchLabel(candidate: RelinkCandidate) {
  if (candidate.match === "content-hash" && !candidate.automatic)
    return t("media.relink.matchCopy");
  return t(
    `media.relink.${
      {
        "content-hash": "matchContent",
        "relative-path": "matchRelative",
        "filename-size": "matchNameSize",
        manual: "matchManual",
      }[candidate.match]
    }`,
  );
}
function fileSize(bytes: number) {
  if (bytes < 1024) return `${formatNumber(bytes)} B`;
  if (bytes < 1024 * 1024)
    return `${formatNumber(bytes / 1024, { maximumFractionDigits: 1 })} KB`;
  return `${formatNumber(bytes / (1024 * 1024), { maximumFractionDigits: 1 })} MB`;
}
function resetPlan() {
  plan.value = null;
  choices.value = {};
  confirmations.value = {};
  error.value = null;
  notice.value = [];
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
    error.value = { key: "media.relink.saveFirst" };
    return false;
  }
  if (props.blocked) {
    error.value = { key: "media.relink.busy" };
    return false;
  }
  return true;
}
async function browse() {
  if (disabled.value) return;
  operation.value = "picking";
  error.value = null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const path = await invoke<string | null>(
      mode.value === "folder" ? "pick_folder" : "pick_file",
    );
    if (path) location.value = path;
  } catch {
    error.value = { key: "media.relink.pickerUnavailable" };
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
    notice.value = [
      {
        key: result.matches.length
          ? "media.relink.searchComplete"
          : "media.relink.emptyScope",
      },
    ];
  } catch (cause) {
    error.value = cause;
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
  error.value = null;
  notice.value = [];
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
    notice.value = [
      { key: "media.relink.reconnected", count: result.assets.length },
      ...(untouched
        ? [{ key: "media.relink.unchanged", count: untouched }]
        : []),
    ];
    emit("applied", result.assets);
  } catch (cause) {
    error.value = cause;
    notice.value = [{ key: "media.relink.retry" }];
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
    :aria-label="t('media.relink.region')"
    :aria-busy="!!operation"
  >
    <header class="relink-heading">
      <div>
        <span class="relink-kicker">{{ t("media.relink.kicker") }}</span>
        <h2>{{ t("media.relink.title") }}</h2>
        <p>{{ t("media.relink.intro") }}</p>
      </div>
      <button
        class="relink-close"
        :aria-label="t('media.relink.close')"
        :disabled="!!operation"
        @click="emit('close')"
      >
        <Icon name="reject" :size="18" />
      </button>
    </header>
    <p v-if="blocked" class="relink-message caution" role="status">
      {{ t("media.relink.busy") }}
    </p>
    <p v-if="errorMessage" class="relink-message error" role="alert">
      {{ errorMessage }}
    </p>
    <details v-if="technicalError" class="relink-help">
      <summary>{{ t("media.relink.technical") }}</summary>
      <p>{{ technicalError }}</p>
    </details>
    <p v-if="noticeMessage" class="relink-message success" role="status">
      {{ noticeMessage }}
    </p>
    <form class="relink-search" @submit.prevent="findMatches">
      <fieldset :disabled="disabled">
        <legend class="relink-legend">{{ t("media.relink.where") }}</legend>
        <div
          class="relink-modes"
          role="group"
          :aria-label="t('media.relink.method')"
        >
          <button
            type="button"
            :class="{ selected: mode === 'folder' }"
            :aria-pressed="mode === 'folder'"
            @click="mode = 'folder'"
          >
            {{ t("media.relink.folder") }}
          </button>
          <button
            type="button"
            :class="{ selected: mode === 'file' }"
            :aria-pressed="mode === 'file'"
            @click="mode = 'file'"
          >
            {{ t("media.relink.file") }}
          </button>
        </div>
        <div class="relink-search-fields">
          <label v-if="mode === 'folder'" class="relink-field"
            >{{ t("media.relink.scope")
            }}<select v-model="scope" :aria-label="t('media.relink.scope')">
              <option value="all">{{ t("media.relink.all") }}</option>
              <option value="selected" :disabled="!selectedIds.length">
                {{ t("media.relink.selected") }}
              </option>
              <option value="library" :disabled="!libraries?.length">
                {{ t("media.relink.oneLibrary") }}
              </option>
            </select></label
          >
          <label
            v-if="mode === 'folder' && scope === 'library'"
            class="relink-field"
            >{{ t("media.relink.library")
            }}<select
              v-model="selectedLibraryId"
              :aria-label="t('media.relink.library')"
              required
            >
              <option value="" disabled>
                {{ t("media.relink.chooseLibrary") }}
              </option>
              <option
                v-for="library in libraries"
                :key="library.id"
                :value="library.id"
              >
                {{ library.name }} · {{ libraryStatus(library.status) }}
              </option>
            </select></label
          >
          <label v-if="mode === 'file'" class="relink-field"
            >{{ t("media.relink.mediaToFind")
            }}<select
              v-model="singleAssetId"
              :aria-label="t('media.relink.mediaToFind')"
              required
            >
              <option value="" disabled>
                {{ t("media.relink.chooseMedia") }}
              </option>
              <option
                v-for="asset in fileAssets"
                :key="asset.id"
                :value="asset.id"
              >
                {{ asset.name }}
              </option>
            </select></label
          >
          <label class="relink-field relink-location"
            >{{
              t(
                `media.relink.${mode === "folder" ? "folderPath" : "filePath"}`,
              )
            }}<span class="relink-path-input"
              ><input
                v-model="location"
                :aria-label="
                  t(
                    `media.relink.${mode === 'folder' ? 'folderPath' : 'filePath'}`,
                  )
                "
                :placeholder="
                  mode === 'folder'
                    ? '/Volumes/Media/Family'
                    : '/Volumes/Media/Family/clip.mov'
                "
                type="text"
                spellcheck="false"
                required
              /><button
                v-if="native"
                type="button"
                class="relink-button"
                :aria-label="
                  t(`media.relink.${mode === 'folder' ? 'folder' : 'file'}`)
                "
                @click="browse"
              >
                <Icon name="folder" :size="15" />{{ t("media.relink.browse") }}
              </button></span
            ></label
          >
          <button
            type="submit"
            class="relink-button primary"
            :disabled="!canPlan"
          >
            {{
              t(
                `media.relink.${operation === "planning" ? "finding" : operation === "checking" ? "saving" : "findMatches"}`,
              )
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
          {{ t("media.relink.previous")
          }}<span
            v-for="root in currentLibrary.roots"
            :key="root"
            :title="root"
            >{{ compactPath(root) }}</span
          >
        </p>
        <p v-if="mode === 'file' && !fileAssets.length" class="relink-help">
          {{ t("media.relink.chooseFirst") }}
        </p>
      </fieldset>
    </form>
    <section
      v-if="plan?.matches.length"
      class="relink-review"
      :aria-label="t('media.relink.review')"
    >
      <div class="relink-review-heading">
        <h3>{{ t("media.relink.review") }}</h3>
        <span>{{
          t("media.relink.selectionSummary", {
            selected: formatNumber(selections.length),
            total: formatNumber(plan.matches.length),
          })
        }}</span>
      </div>
      <p class="relink-help">{{ t("media.relink.reviewHelp") }}</p>
      <fieldset
        v-for="match in plan.matches"
        :key="match.assetId"
        class="relink-match"
        :disabled="disabled"
      >
        <legend>{{ assetName(match.assetId) }}</legend>
        <div class="relink-original">
          <span>{{ t("media.relink.previous") }}</span
          ><code :title="originalPath(match.assetId)">{{
            originalPath(match.assetId)
              ? compactPath(originalPath(match.assetId)!)
              : t("media.relink.detailsUnavailable")
          }}</code
          ><template
            v-if="
              assetsById.get(match.assetId)?.uri &&
              assetsById.get(match.assetId)?.uri !== originalPath(match.assetId)
            "
            ><span>{{ t("media.relink.current") }}</span
            ><code :title="assetsById.get(match.assetId)?.uri">{{
              compactPath(assetsById.get(match.assetId)!.uri)
            }}</code></template
          >
        </div>
        <details v-if="match.reason" class="relink-help">
          <summary>{{ t("media.relink.technical") }}</summary>
          <p>{{ match.reason }}</p>
        </details>
        <p v-if="!match.candidates.length" class="relink-no-match">
          {{ t("media.relink.noMatch") }}
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
              :aria-label="
                t('media.relink.useCandidate', {
                  path: candidate.path,
                  name: assetName(match.assetId),
                })
              "
              @change="choose(match.assetId, candidate.id)"
            />
            <span class="relink-candidate-copy"
              ><span class="relink-evidence"
                ><strong>{{ matchLabel(candidate) }}</strong
                ><span
                  :class="{ verified: candidate.match === 'content-hash' }"
                  >{{
                    t(
                      `media.relink.${candidate.automatic ? "verified" : candidate.match === "content-hash" ? "chooseCopy" : "confirmNeeded"}`,
                    )
                  }}</span
                ><small>{{ fileSize(candidate.fileSize) }}</small></span
              ><code :title="candidate.path">{{
                compactPath(candidate.path)
              }}</code></span
            >
          </label>
          <label class="relink-skip"
            ><input
              type="radio"
              :name="`relink-${plan.id}-${match.assetId}`"
              value=""
              :checked="!choices[match.assetId]"
              :aria-label="
                t('media.relink.leaveNamed', { name: assetName(match.assetId) })
              "
              @change="choose(match.assetId, '')"
            />{{ t("media.relink.leave") }}</label
          >
        </div>
        <details v-if="match.candidates.length" class="relink-help">
          <summary>{{ t("media.relink.technical") }}</summary>
          <p v-for="candidate in match.candidates" :key="candidate.id">
            <code>{{ candidate.path }}</code> — {{ candidate.reason }}
          </p>
        </details>
        <label
          v-if="
            chosenCandidate(match.assetId) &&
            !chosenCandidate(match.assetId)?.automatic
          "
          class="relink-confirm"
          ><input
            v-model="confirmations[match.assetId]"
            type="checkbox"
            :aria-label="
              t('media.relink.confirmNamed', { name: assetName(match.assetId) })
            "
          /><span
            >{{
              t("media.relink.checkedNamed", { name: assetName(match.assetId) })
            }}
            {{
              t(
                `media.relink.${chosenCandidate(match.assetId)?.match === "content-hash" ? "confirmCopy" : "confirmWeak"}`,
              )
            }}</span
          ></label
        >
      </fieldset>
      <footer class="relink-apply">
        <div>
          <strong>{{
            message({
              key: "media.relink.matchesSelected",
              count: selections.length,
            })
          }}</strong>
          <p v-if="unselected">
            {{ message({ key: "media.relink.unchanged", count: unselected }) }}
          </p>
          <p v-if="unconfirmed" class="relink-confirm-needed">
            {{
              message({ key: "media.relink.confirmCount", count: unconfirmed })
            }}
          </p>
        </div>
        <button
          type="button"
          class="relink-button primary"
          :disabled="disabled || !selections.length || !!unconfirmed"
          @click="applyMatches"
        >
          {{
            t(
              `media.relink.${operation === "applying" ? "applying" : "apply"}`,
            )
          }}<Icon name="check" :size="15" />
        </button>
      </footer>
    </section>
  </section>
</template>
