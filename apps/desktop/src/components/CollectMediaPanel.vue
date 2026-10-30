<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { Composition, OpenFilmProject } from "@openfilm/core";
import type {
  CollectMediaPlan,
  CollectMediaCreateResult,
  CollectMediaVerifyResult,
  CollectPlanInput,
  CollectRightsBasis,
  CollectRightsDeclaration,
  CollectMediaPlanItem,
} from "@openfilm/application";
import { api, exportDownloadUrl } from "../api";
import { localizeError } from "../i18n";
import Icon from "./Icon.vue";
import LocalDownload from "./LocalDownload.vue";
import CollectCoverageReview from "./CollectCoverageReview.vue";

type Scope = CollectPlanInput["scope"];
type Format = "directory" | "zip";
type RightsDraft = {
  confirmed: boolean;
  basis: CollectRightsBasis | "";
  licenseName: string;
  attribution: string;
};

const props = defineProps<{
  project: OpenFilmProject;
  composition?: Composition;
  disabled: boolean;
}>();
const emit = defineEmits<{ busy: [value: boolean] }>();

const { t, locale } = useI18n();
const coverageBusy = ref(false);
const controlsDisabled = computed(() => props.disabled || coverageBusy.value);
function coverageActivity(value: boolean) {
  coverageBusy.value = value;
  emit("busy", value || operation.value !== "");
}
const issueTranslationKeys: Record<string, string> = {
  "source.unsupported-uri": "sourceUnsupportedUri",
  "source.nested-archive": "sourceNestedArchive",
  "source.hash-mismatch": "sourceHashMismatch",
  "source.too-large": "sourceTooLarge",
  "source.changed": "sourceChanged",
  "source.unsafe-or-missing": "sourceUnsafeOrMissing",
  "source.unavailable": "sourceUnavailable",
  "rights.required": "rightsRequired",
  "font.fallback": "fontFallback",
  "font.unavailable": "fontUnavailable",
  "package.too-large": "packageTooLarge",
  "scope.no-media": "scopeNoMedia",
};
const scope = ref<Scope>("current-film");
const compositionId = ref(props.composition?.id ?? "");
const format = ref<Format>("zip");
const rights = reactive<Record<string, RightsDraft>>({});
const planState = ref<{ plan: CollectMediaPlan; signature: string }>();
const created = ref<CollectMediaCreateResult>();
const verified = ref<CollectMediaVerifyResult>();
const operation = ref<"planning" | "creating" | "verifying" | "">("");
const error = ref("");
let controller: AbortController | undefined;
let generation = 0;

const rightsDeclarations = computed<CollectRightsDeclaration[]>(() =>
  Object.entries(rights)
    .filter(([, value]) => value.confirmed && value.basis)
    .map(([resourceId, value]) => ({
      resourceId,
      basis: value.basis as CollectRightsBasis,
      confirmed: true as const,
      ...(value.licenseName.trim()
        ? { licenseName: value.licenseName.trim() }
        : {}),
      ...(value.attribution.trim()
        ? { attribution: value.attribution.trim() }
        : {}),
    }))
    .sort((first, second) => first.resourceId.localeCompare(second.resourceId)),
);
const signature = computed(() =>
  JSON.stringify({
    projectId: props.project.id,
    scope: scope.value,
    compositionId: scope.value === "current-film" ? compositionId.value : "",
    rights: rightsDeclarations.value,
  }),
);
const plan = computed(() => planState.value?.plan);
const planCurrent = computed(
  () => !!planState.value && planState.value.signature === signature.value,
);
const needsRights = computed(() =>
  (plan.value?.items ?? []).filter(
    (item) => !rights[item.resourceId]?.confirmed,
  ),
);
const invalidRights = computed(() =>
  (plan.value?.items ?? []).some((item) => {
    const draft = rights[item.resourceId];
    if (!draft?.confirmed) return false;
    return (
      !draft.basis || (draft.basis !== "owned" && !draft.licenseName.trim())
    );
  }),
);
const canCreate = computed(
  () =>
    !controlsDisabled.value &&
    operation.value === "" &&
    planCurrent.value &&
    !!plan.value?.complete &&
    needsRights.value.length === 0 &&
    !invalidRights.value,
);
const formattedTotal = computed(() => formatBytes(plan.value?.totalBytes ?? 0));
const formattedUnique = computed(() =>
  formatBytes(plan.value?.uniqueMediaBytes ?? 0),
);

function formatBytes(value: number): string {
  const formatter = new Intl.NumberFormat(locale.value, {
    maximumFractionDigits: 1,
  });
  if (value >= 1024 ** 3) return `${formatter.format(value / 1024 ** 3)} GiB`;
  if (value >= 1024 ** 2) return `${formatter.format(value / 1024 ** 2)} MiB`;
  if (value >= 1024) return `${formatter.format(value / 1024)} KiB`;
  return `${formatter.format(value)} B`;
}

function input(): CollectPlanInput {
  return {
    scope: scope.value,
    ...(scope.value === "current-film"
      ? { compositionId: compositionId.value }
      : {}),
    ...(rightsDeclarations.value.length
      ? { rightsDeclarations: rightsDeclarations.value }
      : {}),
  };
}

function issueLabel(code: string): string {
  return t(`app.collect.issues.${issueTranslationKeys[code] ?? "unknown"}`);
}

function setOperation(next: typeof operation.value) {
  operation.value = next;
  emit("busy", next !== "" || coverageBusy.value);
  error.value = "";
}

async function review() {
  controller?.abort();
  const currentGeneration = generation;
  const requestSignature = signature.value;
  const current = new AbortController();
  controller = current;
  setOperation("planning");
  try {
    const response = await api.collectMediaPlan(input(), current.signal);
    if (current.signal.aborted || currentGeneration !== generation) return;
    for (const item of response.plan.items) {
      rights[item.resourceId] ??= {
        confirmed: false,
        basis: "",
        licenseName: "",
        attribution: "",
      };
    }
    planState.value = { plan: response.plan, signature: requestSignature };
    created.value = undefined;
    verified.value = undefined;
  } catch (cause) {
    if (!current.signal.aborted && currentGeneration === generation)
      error.value = localizeError(cause);
  } finally {
    if (controller === current) controller = undefined;
    if (currentGeneration === generation) {
      operation.value = "";
      emit("busy", coverageBusy.value);
    }
  }
}

async function createPackage() {
  if (!canCreate.value || !plan.value) return;
  const currentGeneration = generation;
  const current = new AbortController();
  controller?.abort();
  controller = current;
  setOperation("creating");
  try {
    const response = await api.createCollectedMedia(
      {
        ...input(),
        planId: plan.value.id,
        baseRevision: plan.value.revision,
        format: format.value,
      },
      current.signal,
    );
    if (current.signal.aborted || currentGeneration !== generation) return;
    created.value = response.result;
    verified.value = undefined;
  } catch (cause) {
    if (!current.signal.aborted && currentGeneration === generation)
      error.value = localizeError(cause);
  } finally {
    if (controller === current) controller = undefined;
    if (currentGeneration === generation) {
      operation.value = "";
      emit("busy", coverageBusy.value);
    }
  }
}

async function verifyPackage() {
  if (!created.value || operation.value) return;
  const currentGeneration = generation;
  const current = new AbortController();
  controller?.abort();
  controller = current;
  setOperation("verifying");
  verified.value = undefined;
  try {
    const response = await api.verifyCollectedMedia(
      created.value.fileName,
      current.signal,
    );
    if (current.signal.aborted || currentGeneration !== generation) return;
    verified.value = response.result;
  } catch (cause) {
    if (!current.signal.aborted && currentGeneration === generation)
      error.value = localizeError(cause);
  } finally {
    if (controller === current) controller = undefined;
    if (currentGeneration === generation) {
      operation.value = "";
      emit("busy", coverageBusy.value);
    }
  }
}

function cancel() {
  controller?.abort();
  controller = undefined;
  operation.value = "";
  emit("busy", coverageBusy.value);
}

function ensureDraft(item: CollectMediaPlanItem): RightsDraft {
  return (
    rights[item.resourceId] ??
    (rights[item.resourceId] = reactive({
      confirmed: false,
      basis: "",
      licenseName: "",
      attribution: "",
    }))
  );
}

watch(
  () => [props.project.id, props.composition?.id] as const,
  () => {
    generation++;
    controller?.abort();
    controller = undefined;
    scope.value = "current-film";
    compositionId.value = props.composition?.id ?? "";
    for (const key of Object.keys(rights)) delete rights[key];
    planState.value = undefined;
    created.value = undefined;
    verified.value = undefined;
    error.value = "";
    operation.value = "";
    coverageBusy.value = false;
    emit("busy", false);
  },
);

onBeforeUnmount(() => {
  generation++;
  controller?.abort();
  coverageBusy.value = false;
  emit("busy", false);
});
</script>

<template>
  <section class="collect-panel" aria-labelledby="collect-heading">
    <header class="collect-header">
      <div>
        <p class="eyebrow">{{ t("app.collect.eyebrow") }}</p>
        <h2 id="collect-heading">{{ t("app.collect.title") }}</h2>
        <p>{{ t("app.collect.description") }}</p>
      </div>
      <Icon name="folder" :size="22" />
    </header>

    <p class="collect-privacy">{{ t("app.collect.privacy") }}</p>

    <div class="collect-options">
      <fieldset :disabled="controlsDisabled || operation !== ''">
        <legend>{{ t("app.collect.scope") }}</legend>
        <label>
          <input v-model="scope" type="radio" value="current-film" />
          <span>
            <strong>{{ t("app.collect.currentFilm") }}</strong>
            <small>{{ t("app.collect.currentFilmHint") }}</small>
          </span>
        </label>
        <label>
          <input v-model="scope" type="radio" value="entire-project" />
          <span>
            <strong>{{ t("app.collect.entireProject") }}</strong>
            <small>{{ t("app.collect.entireProjectHint") }}</small>
          </span>
        </label>
      </fieldset>

      <div v-if="scope === 'current-film'" class="collect-select field">
        <label for="collect-composition">{{
          t("app.collect.composition")
        }}</label>
        <select
          id="collect-composition"
          v-model="compositionId"
          :disabled="controlsDisabled || operation !== ''"
          data-testid="collect-composition"
        >
          <option
            v-for="item in project.timelines"
            :key="item.id"
            :value="item.id"
          >
            {{
              project.stories.find((story) => story.id === item.storyId)
                ?.title ?? item.id
            }}
          </option>
        </select>
      </div>

      <div class="collect-select field">
        <label for="collect-format">{{ t("app.collect.format") }}</label>
        <select
          id="collect-format"
          v-model="format"
          :disabled="controlsDisabled || operation !== ''"
          data-testid="collect-format"
        >
          <option value="zip">{{ t("app.collect.zip") }}</option>
          <option value="directory">{{ t("app.collect.directory") }}</option>
        </select>
      </div>
    </div>

    <div class="collect-actions">
      <button
        class="primary"
        :disabled="
          controlsDisabled ||
          operation !== '' ||
          (scope === 'current-film' && !compositionId)
        "
        data-testid="collect-review"
        @click="review"
      >
        <Icon name="check" />
        {{
          planState ? t("app.collect.refreshReview") : t("app.collect.review")
        }}
      </button>
      <button
        v-if="operation"
        class="secondary"
        data-testid="collect-cancel"
        @click="cancel"
      >
        {{ t("app.collect.cancel") }}
      </button>
      <span v-if="operation" role="status">{{
        t(`app.collect.${operation}`)
      }}</span>
    </div>

    <CollectCoverageReview
      :request="{
        ...input(),
        projectId: project.id,
        ...(planCurrent && plan ? { expectedRevision: plan.revision } : {}),
      }"
      :disabled="disabled || operation !== ''"
      @busy="coverageActivity"
      @created="
        created = $event;
        verified = undefined;
      "
    />
    <p v-if="error" class="collect-error" role="alert">{{ error }}</p>

    <template v-if="plan">
      <p v-if="!planCurrent" class="collect-stale" role="status">
        {{ t("app.collect.reviewStale") }}
      </p>
      <dl class="collect-summary" data-testid="collect-summary">
        <div>
          <dt>{{ t("app.collect.referencedFiles") }}</dt>
          <dd>
            {{ plan.items.filter((item) => item.kind === "media").length }}
          </dd>
        </div>
        <div>
          <dt>{{ t("app.collect.packageSize") }}</dt>
          <dd>{{ formattedTotal }}</dd>
        </div>
        <div>
          <dt>{{ t("app.collect.uniqueSources") }}</dt>
          <dd>{{ formattedUnique }}</dd>
        </div>
        <div>
          <dt>{{ t("app.collect.versions") }}</dt>
          <dd>{{ t("app.collect.versionsExcluded") }}</dd>
        </div>
      </dl>

      <section class="collect-items" :aria-label="t('app.collect.resources')">
        <h3>{{ t("app.collect.resources") }}</h3>
        <article
          v-for="item in plan.items"
          :key="item.resourceId"
          class="collect-item"
          :data-status="item.status"
        >
          <div class="collect-item-heading">
            <div>
              <strong>{{ item.displayName }}</strong>
              <small>{{ t(`app.collect.kind.${item.kind}`) }}</small>
            </div>
            <span>{{
              item.size === undefined
                ? t("app.collect.unavailable")
                : formatBytes(item.size)
            }}</span>
          </div>
          <p v-if="item.sha256" class="collect-hash">
            SHA-256 · <code>{{ item.sha256 }}</code>
          </p>
          <ul v-if="item.issues.length" class="collect-issues">
            <li v-for="issue in item.issues" :key="issue">
              {{ issueLabel(issue) }}
            </li>
          </ul>
          <fieldset
            class="collect-rights"
            :disabled="controlsDisabled || operation !== ''"
          >
            <legend>{{ t("app.collect.rights") }}</legend>
            <label class="collect-confirm">
              <input v-model="ensureDraft(item).confirmed" type="checkbox" />
              <span>{{ t("app.collect.confirmRights") }}</span>
            </label>
            <label class="field">
              {{ t("app.collect.rightsBasis") }}
              <select v-model="ensureDraft(item).basis">
                <option value="">
                  {{ t("app.collect.chooseRightsBasis") }}
                </option>
                <option value="owned">
                  {{ t("app.collect.basis.owned") }}
                </option>
                <option value="licensed">
                  {{ t("app.collect.basis.licensed") }}
                </option>
                <option value="cc0">{{ t("app.collect.basis.cc0") }}</option>
                <option value="public-domain">
                  {{ t("app.collect.basis.publicDomain") }}
                </option>
                <option value="other">
                  {{ t("app.collect.basis.other") }}
                </option>
              </select>
            </label>
            <label
              v-if="
                ensureDraft(item).basis && ensureDraft(item).basis !== 'owned'
              "
              class="field"
            >
              {{ t("app.collect.licenseName") }}
              <input v-model="ensureDraft(item).licenseName" maxlength="120" />
            </label>
            <label
              v-if="
                ensureDraft(item).basis && ensureDraft(item).basis !== 'owned'
              "
              class="field"
            >
              {{ t("app.collect.attribution") }}
              <input v-model="ensureDraft(item).attribution" maxlength="512" />
            </label>
          </fieldset>
        </article>
      </section>

      <p v-if="needsRights.length" class="collect-blocker" role="status">
        {{ t("app.collect.rightsMissing", { count: needsRights.length }) }}
      </p>
      <p v-else-if="invalidRights" class="collect-blocker" role="status">
        {{ t("app.collect.rightsIncomplete") }}
      </p>
      <ul v-if="plan.issues.length" class="collect-plan-issues">
        <li
          v-for="(issue, index) in plan.issues"
          :key="`${issue.code}:${issue.itemId ?? index}`"
          :data-severity="issue.severity"
        >
          {{ issueLabel(issue.code) }}
        </li>
      </ul>
      <p v-if="!plan.complete" class="collect-blocker" role="status">
        {{ t("app.collect.packageBlocked") }}
      </p>
      <div class="collect-actions">
        <button
          class="primary"
          :disabled="!canCreate"
          data-testid="collect-create"
          @click="createPackage"
        >
          <Icon name="folder" />{{ t("app.collect.create") }}
        </button>
        <button
          v-if="created && !operation"
          class="secondary"
          data-testid="collect-verify"
          @click="verifyPackage"
        >
          {{ t("app.collect.verify") }}
        </button>
      </div>
    </template>

    <section
      v-if="created"
      class="collect-result"
      data-testid="collect-result"
      role="status"
    >
      <h3>{{ t("app.collect.created") }}</h3>
      <p>
        <code>{{ created.fileName }}</code>
      </p>
      <p>{{ t("app.collect.savedInProject") }}</p>
      <LocalDownload
        v-if="created.format === 'zip'"
        class="secondary"
        :href="exportDownloadUrl(created.fileName)"
        :filename="created.fileName"
        :owner="project.id"
      >
        <Icon name="download" />{{ t("app.collect.download") }}
      </LocalDownload>
      <p v-if="created.manifestSha256" class="collect-hash">
        {{ t("app.collect.manifestHash") }} ·
        <code>{{ created.manifestSha256 }}</code>
      </p>
    </section>

    <section
      v-if="verified"
      class="collect-result collect-verified"
      data-testid="collect-verified"
      role="status"
    >
      <h3>{{ t("app.collect.verified") }}</h3>
      <p>
        {{
          t("app.collect.verifySummary", {
            count: verified.sourceCount,
            fonts: verified.fontCount,
          })
        }}
      </p>
      <p>
        {{
          t("app.collect.renderEvidence", {
            width: verified.outputWidth,
            height: verified.outputHeight,
            frames: verified.outputFrames,
            duration: verified.outputDurationSeconds.toFixed(3),
            frameRate: verified.outputFrameRate,
          })
        }}
      </p>
      <p v-if="verified.outputAudio">
        {{
          t("app.collect.audioEvidence", {
            codec: verified.outputAudio.codec,
            sampleRate: verified.outputAudio.sampleRate,
            channels: verified.outputAudio.channels,
          })
        }}
      </p>
      <p v-if="verified.warnings.length" class="collect-warning">
        {{
          t("app.collect.renderWarnings", { count: verified.warnings.length })
        }}
      </p>
      <p class="collect-hash">
        {{ t("app.collect.previewHash") }} ·
        <code>{{ verified.previewSha256 }}</code>
      </p>
      <p class="collect-hash">
        {{ t("app.collect.outputHash") }} ·
        <code>{{ verified.outputSha256 }}</code>
      </p>
    </section>
  </section>
</template>

<style scoped>
.collect-panel {
  display: grid;
  gap: var(--of-space-4);
  max-width: 58rem;
  margin: var(--of-space-5) auto;
  padding: var(--of-space-5);
  border: 1px solid var(--of-border-subtle);
  border-radius: var(--of-radius-md);
  background: var(--of-surface-1);
}
.collect-header,
.collect-item-heading,
.collect-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--of-space-3);
}
.collect-header h2,
.collect-header p,
.collect-result h3,
.collect-result p,
.collect-items h3 {
  margin: 0;
}
.collect-header .eyebrow,
.collect-item-heading small {
  color: var(--of-text-secondary);
  font-size: var(--of-font-caption);
}
.collect-header > div {
  display: grid;
  gap: var(--of-space-2);
}
.collect-privacy,
.collect-stale,
.collect-blocker,
.collect-warning,
.collect-error {
  margin: 0;
}
.collect-privacy,
.collect-stale {
  color: var(--of-text-secondary);
  font-size: var(--of-font-caption);
}
.collect-options {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--of-space-4);
}
.collect-options fieldset,
.collect-rights {
  display: grid;
  gap: var(--of-space-3);
  min-width: 0;
  border: 0;
  padding: 0;
  margin: 0;
}
.collect-options legend,
.collect-rights legend {
  margin-bottom: var(--of-space-2);
  font-size: var(--of-font-small);
  font-weight: 600;
}
.collect-options fieldset > label {
  display: flex;
  align-items: flex-start;
  gap: var(--of-space-2);
}
.collect-options fieldset > label > span {
  display: grid;
  gap: var(--of-space-1);
}
.collect-options small {
  color: var(--of-text-secondary);
  font-size: var(--of-font-caption);
}
.collect-select {
  min-width: 0;
}
.collect-select select {
  width: 100%;
}
.collect-summary {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--of-space-3);
  margin: 0;
}
.collect-summary > div {
  min-width: 0;
  padding: var(--of-space-3);
  border: 1px solid var(--of-border-subtle);
  border-radius: var(--of-radius-sm);
}
.collect-summary dt {
  color: var(--of-text-secondary);
  font-size: var(--of-font-caption);
}
.collect-summary dd {
  margin: var(--of-space-1) 0 0;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
.collect-items {
  display: grid;
  gap: var(--of-space-3);
}
.collect-item {
  display: grid;
  gap: var(--of-space-3);
  min-width: 0;
  padding: var(--of-space-3);
  border: 1px solid var(--of-border-subtle);
  border-radius: var(--of-radius-sm);
}
.collect-item-heading > div {
  display: grid;
  gap: var(--of-space-1);
  min-width: 0;
  overflow-wrap: anywhere;
}
.collect-item-heading > span {
  flex-shrink: 0;
  color: var(--of-text-secondary);
  font-variant-numeric: tabular-nums;
}
.collect-hash {
  margin: 0;
  color: var(--of-text-secondary);
  font-size: var(--of-font-caption);
  overflow-wrap: anywhere;
}
.collect-hash code,
.collect-result code {
  overflow-wrap: anywhere;
  word-break: break-word;
}
.collect-issues,
.collect-plan-issues {
  margin: 0;
  padding-inline-start: var(--of-space-5);
  color: var(--of-text-secondary);
  font-size: var(--of-font-caption);
}
.collect-rights {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  padding-top: var(--of-space-3);
  border-top: 1px solid var(--of-border-subtle);
}
.collect-rights legend {
  grid-column: 1 / -1;
}
.collect-confirm {
  display: flex;
  align-items: center;
  gap: var(--of-space-2);
  grid-column: 1 / -1;
}
.collect-rights .field {
  min-width: 0;
}
.collect-rights input:not([type="checkbox"]),
.collect-rights select {
  width: 100%;
  min-width: 0;
}
.collect-blocker,
.collect-error {
  color: var(--of-danger-text, var(--of-text-danger));
}
.collect-plan-issues [data-severity="warning"],
.collect-warning {
  color: var(--of-warning-text, var(--of-text-secondary));
}
.collect-result {
  display: grid;
  gap: var(--of-space-2);
  min-width: 0;
  padding: var(--of-space-4);
  border: 1px solid var(--of-border-subtle);
  border-radius: var(--of-radius-sm);
}
.collect-result a {
  display: inline-flex;
  align-items: center;
  justify-self: start;
  gap: var(--of-space-2);
  text-decoration: none;
}
@media (max-width: 760px) {
  .collect-options {
    grid-template-columns: minmax(0, 1fr);
  }
  .collect-summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 500px) {
  .collect-panel {
    padding: var(--of-space-3);
  }
  .collect-summary {
    grid-template-columns: minmax(0, 1fr);
  }
  .collect-rights {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
