<script setup lang="ts">
// SPDX-License-Identifier: Apache-2.0
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { OpenFilmProject, PresetEntry } from "@openfilm/core";
import type {
  PresetRegistryView,
  PresetRegistryPackage,
  PresetImportReview,
  PresetRecoveryReview,
  PresetAcceptance,
} from "@openfilm/application";
import { api } from "../api";
import { localizeError } from "../i18n";
import {
  createPresetTaskScope,
  readPresetFileSelection,
} from "../local-presets";
import PresetApplyReview from "./PresetApplyReview.vue";
const props = defineProps<{
  project?: OpenFilmProject;
  activeCompositionId?: string;
  busy: boolean;
}>();
const emit = defineEmits<{ applied: [result: PresetAcceptance] }>();
const { t } = useI18n();
const scope = createPresetTaskScope(),
  view = ref<PresetRegistryView>(),
  review = ref<PresetImportReview>(),
  document = ref(""),
  acknowledged = ref(false),
  working = ref(false),
  error = ref<unknown>(),
  status = ref(""),
  removeCandidate = ref<PresetRegistryPackage>(),
  recovery = ref<PresetRecoveryReview>(),
  selected = ref<{ package: PresetRegistryPackage; entry: PresetEntry }>();
function cancel() {
  scope.cancel();
  working.value = false;
  review.value = undefined;
  document.value = "";
  acknowledged.value = false;
  recovery.value = undefined;
  removeCandidate.value = undefined;
  selected.value = undefined;
}
async function load() {
  const run = scope.begin();
  working.value = true;
  error.value = undefined;
  try {
    const result = await api.localPresets(run.signal);
    if (run.current()) view.value = result;
  } catch (cause) {
    if (run.current()) error.value = cause;
  } finally {
    if (run.current()) working.value = false;
  }
}
async function chooseFile(event: Event) {
  cancel();
  error.value = undefined;
  status.value = "";
  const input = event.target as HTMLInputElement,
    file = input.files?.[0];
  input.value = "";
  if (!file) return;
  const run = scope.begin();
  working.value = true;
  try {
    const bytes = await readPresetFileSelection(file, run.signal);
    const result = await api.reviewPresetImport(bytes, run.signal);
    if (run.current()) {
      document.value = bytes;
      review.value = result;
    }
  } catch (cause) {
    if (run.current()) error.value = cause;
  } finally {
    if (run.current()) working.value = false;
  }
}
async function install() {
  if (!review.value || !acknowledged.value || props.busy) return;
  const original = review.value,
    run = scope.begin();
  working.value = true;
  error.value = undefined;
  try {
    const result = await api.installPreset(
      {
        document: document.value,
        packageSha256: original.packageSha256,
        baseRegistryRevision: original.registryRevision,
        reviewSha256: original.reviewSha256,
        acknowledgeLicense: true,
      },
      run.signal,
    );
    if (run.current()) {
      view.value = result;
      review.value = undefined;
      document.value = "";
      acknowledged.value = false;
      status.value = t("presets.installed");
    }
  } catch (cause) {
    if (run.current()) error.value = cause;
  } finally {
    if (run.current()) working.value = false;
  }
}
async function remove() {
  if (!removeCandidate.value || !view.value || props.busy) return;
  const p = removeCandidate.value,
    run = scope.begin();
  working.value = true;
  error.value = undefined;
  try {
    const result = await api.removePreset(
      {
        packageId: p.id,
        packageVersion: p.version,
        packageSha256: p.packageSha256,
        baseRegistryRevision: view.value.revision,
      },
      run.signal,
    );
    if (run.current()) {
      view.value = result;
      removeCandidate.value = undefined;
      status.value = t("presets.removed");
    }
  } catch (cause) {
    if (run.current()) error.value = cause;
  } finally {
    if (run.current()) working.value = false;
  }
}
async function reviewRecovery() {
  cancel();
  const run = scope.begin();
  working.value = true;
  error.value = undefined;
  try {
    const result = await api.reviewPresetRecovery(run.signal);
    if (run.current()) recovery.value = result;
  } catch (cause) {
    if (run.current()) error.value = cause;
  } finally {
    if (run.current()) working.value = false;
  }
}
async function restore() {
  if (!recovery.value || props.busy) return;
  const original = recovery.value,
    run = scope.begin();
  working.value = true;
  error.value = undefined;
  try {
    const result = await api.recoverPresets(
      { ...original, acknowledgeRecovery: true },
      run.signal,
    );
    if (run.current()) {
      view.value = result;
      recovery.value = undefined;
      status.value = t("presets.restored");
    }
  } catch (cause) {
    if (run.current()) error.value = cause;
  } finally {
    if (run.current()) working.value = false;
  }
}
function applied(result: PresetAcceptance) {
  if (result.receipt.projectId !== props.project?.id) return;
  selected.value = undefined;
  status.value = t("presets.applied");
  emit("applied", result);
}
watch(
  () => props.project?.id,
  () => {
    cancel();
    error.value = undefined;
    status.value = "";
  },
);
onMounted(load);
onBeforeUnmount(() => scope.cancel());
</script>
<template>
  <section class="local-presets" :aria-label="t('presets.heading')">
    <h3>{{ t("presets.heading") }}</h3>
    <p>{{ t("presets.description") }}</p>
    <label class="preset-file"
      ><span>{{ t("presets.chooseFile") }}</span
      ><input
        type="file"
        accept=".json,.openfilm-presets.json,application/json"
        :disabled="busy || working"
        @change="chooseFile"
    /></label>
    <p v-if="error" role="alert">{{ localizeError(error) }}</p>
    <p v-if="status" role="status">{{ status }}</p>
    <p v-if="working" role="status">{{ t("presets.working") }}</p>
    <section
      v-if="review"
      class="preset-review"
      :aria-label="t('presets.importReview')"
    >
      <h4>
        {{ review.package.name }} <span>{{ review.package.version }}</span>
      </h4>
      <p>{{ review.package.description }}</p>
      <dl>
        <dt>{{ t("presets.author") }}</dt>
        <dd>{{ review.package.provenance.author }}</dd>
        <dt>{{ t("presets.source") }}</dt>
        <dd>{{ review.package.provenance.source }}</dd>
        <dt>{{ t("presets.license") }}</dt>
        <dd>
          {{ review.package.license.spdxId }} ·
          {{ review.package.license.copyright }}
        </dd>
      </dl>
      <p class="preset-notice">{{ review.package.license.notice }}</p>
      <p v-if="review.package.provenance.modificationNotice">
        {{ review.package.provenance.modificationNotice }}
      </p>
      <ul>
        <li v-for="entry in review.package.entries" :key="entry.id">
          {{ entry.name }} · {{ t(`presets.kinds.${entry.kind}`) }}
        </li>
      </ul>
      <details>
        <summary>{{ t("presets.identity") }}</summary>
        <code>{{ review.packageSha256 }}</code>
      </details>
      <label class="preset-check"
        ><input
          type="checkbox"
          :checked="acknowledged"
          :disabled="working || busy"
          @change="acknowledged = ($event.target as HTMLInputElement).checked"
        /><span>{{ t("presets.acknowledgeLicense") }}</span></label
      >
      <div class="preset-actions">
        <button
          type="button"
          :disabled="!acknowledged || working || busy"
          @click="install"
        >
          {{ t("presets.install") }}</button
        ><button type="button" @click="cancel">
          {{ t("presets.cancel") }}
        </button>
      </div>
    </section>
    <p v-if="view && !view.packages.length">{{ t("presets.empty") }}</p>
    <article
      v-for="p in view?.packages ?? []"
      :key="`${p.id}@${p.version}`"
      class="preset-package"
    >
      <h4>
        {{ p.name }} <small>{{ p.version }}</small>
      </h4>
      <p>{{ p.provenance.author }} · {{ p.license.spdxId }}</p>
      <details>
        <summary>{{ t("presets.provenance") }}</summary>
        <p>{{ p.provenance.source }}</p>
        <p class="preset-notice">{{ p.license.notice }}</p>
        <code>{{ p.id }} · {{ p.packageSha256 }}</code>
      </details>
      <ul>
        <li v-for="entry in p.entries" :key="entry.id">
          <span
            >{{ entry.name }}
            <small>{{ t(`presets.kinds.${entry.kind}`) }}</small></span
          ><button
            type="button"
            :disabled="!project || busy || working"
            @click="selected = { package: p, entry }"
          >
            {{ t("presets.apply") }}
          </button>
        </li>
      </ul>
      <button
        type="button"
        :disabled="working || busy"
        @click="removeCandidate = p"
      >
        {{ t("presets.remove") }}
      </button>
    </article>
    <section
      v-if="removeCandidate"
      class="preset-review"
      :aria-label="t('presets.removeReview')"
    >
      <h4>{{ removeCandidate.name }}</h4>
      <p>{{ t("presets.removeHint") }}</p>
      <div class="preset-actions">
        <button type="button" :disabled="working || busy" @click="remove">
          {{ t("presets.confirmRemove") }}</button
        ><button type="button" @click="removeCandidate = undefined">
          {{ t("presets.cancel") }}
        </button>
      </div>
    </section>
    <div class="preset-actions">
      <button type="button" :disabled="working" @click="load">
        {{ t("presets.refresh") }}</button
      ><button
        type="button"
        :disabled="working || busy"
        @click="reviewRecovery"
      >
        {{ t("presets.reviewRecovery") }}</button
      ><button v-if="working" type="button" @click="cancel">
        {{ t("presets.cancel") }}
      </button>
    </div>
    <section
      v-if="recovery"
      class="preset-review"
      :aria-label="t('presets.recoveryTitle')"
    >
      <p>{{ t("presets.recoveryHint", { count: recovery.packages }) }}</p>
      <button type="button" :disabled="working || busy" @click="restore">
        {{ t("presets.restore") }}</button
      ><button type="button" @click="recovery = undefined">
        {{ t("presets.cancel") }}
      </button>
    </section>
    <PresetApplyReview
      v-if="selected && project && view"
      :key="
        selected?.package.id +
        '@' +
        selected?.package.version +
        '/' +
        selected?.entry.id
      "
      :project="project"
      :active-composition-id="activeCompositionId"
      :package="selected.package"
      :entry="selected.entry"
      :registry-revision="view.revision"
      :disabled="busy"
      @close="selected = undefined"
      @applied="applied"
    />
  </section>
</template>
<style scoped>
.local-presets {
  display: grid;
  gap: var(--of-space-3);
  padding-block: var(--of-space-4);
  border-block: 1px solid var(--of-border-subtle);
  min-width: 0;
}
.local-presets :is(h3, h4, p) {
  margin: 0;
}
.local-presets :is(p, dd, li, code) {
  overflow-wrap: anywhere;
}
.local-presets p,
.local-presets small {
  color: var(--of-text-secondary);
}
.preset-file {
  display: grid;
  gap: var(--of-space-2);
}
.preset-file input {
  max-width: 100%;
  min-width: 0;
}
.preset-review,
.preset-package {
  display: grid;
  gap: var(--of-space-3);
  padding-block: var(--of-space-3);
  border-block-start: 1px solid var(--of-border-subtle);
}
.preset-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--of-space-2);
}
.preset-check {
  display: flex;
  align-items: start;
  gap: var(--of-space-2);
}
.preset-package ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--of-space-2);
}
.preset-package li {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--of-space-3);
}
.preset-package li span {
  min-width: 0;
}
.preset-package small {
  display: block;
}
.preset-notice {
  white-space: pre-wrap;
}
.local-presets dl {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: var(--of-space-2);
  margin: 0;
}
.local-presets dd {
  margin: 0;
}
.local-presets button {
  min-height: 36px;
  max-width: 100%;
  white-space: normal;
}
.local-presets code {
  display: block;
  font-size: var(--of-font-caption);
}
@media (pointer: coarse) {
  .local-presets button {
    min-height: 44px;
  }
}
</style>
