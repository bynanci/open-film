<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { supportedLocales, formatDate } from "../i18n";
import { preferences } from "../preferences";
import type { FilmCreation, FilmLocale, RecentProject } from "../appTypes";
import {
  DEFAULT_PROJECT_TIMEBASE_PRESET_ID,
  PROJECT_TIMEBASE_PRESETS,
} from "../projectTimebase";
import Icon from "./Icon.vue";
import GardenStones from "./GardenStones.vue";

const props = defineProps<{
  busy: boolean;
  recent: RecentProject[];
  defaultRoot: string;
  templates: { id: string; targetDuration: number; maxDuration: number }[];
  native: boolean;
  connected: boolean;
}>();
const emit = defineEmits<{
  create: [value: FilmCreation];
  open: [path: string];
  retry: [];
}>();
const { t } = useI18n();
const mode = ref<"welcome" | "create" | "open">("welcome");
const name = ref("");
const template = ref("blank");
const filmLocale = ref<FilmLocale>(preferences.defaultFilmLocale);
const filmLocaleEdited = ref(false);
const target = ref(120);
const maximum = ref(180);
const timingEdited = ref(false);
const timebasePresetId = ref(DEFAULT_PROJECT_TIMEBASE_PRESET_ID);
const path = ref("");
const issue = ref("");
const durationIssueField = ref<"target" | "maximum">();
const createAction = ref<HTMLButtonElement>();
const openAction = ref<HTMLButtonElement>();
const nameInput = ref<HTMLInputElement>();
const pathInput = ref<HTMLInputElement>();
const targetInput = ref<HTMLInputElement>();
const maximumInput = ref<HTMLInputElement>();
const contentLocales = computed(() => supportedLocales);
watch(
  [template, () => props.templates],
  ([value]) => {
    if (timingEdited.value) return;
    const defaults = props.templates.find((item) => item.id === value);
    if (!defaults) return;
    target.value = defaults.targetDuration;
    maximum.value = defaults.maxDuration;
  },
  { immediate: true },
);
watch(
  () => preferences.defaultFilmLocale,
  (value) => {
    if (!filmLocaleEdited.value) filmLocale.value = value;
  },
);
function changeMode(next: typeof mode.value) {
  const previous = mode.value;
  mode.value = next;
  path.value = "";
  issue.value = "";
  durationIssueField.value = undefined;
  void nextTick(() => {
    const focusTarget =
      next === "create"
        ? nameInput.value
        : next === "open"
          ? pathInput.value
          : previous === "open"
            ? openAction.value
            : createAction.value;
    focusTarget?.focus({ preventScroll: true });
  });
}
function clearIssue() {
  issue.value = "";
  durationIssueField.value = undefined;
}
async function chooseFolder() {
  const { invoke } = await import("@tauri-apps/api/core");
  try {
    const picked = await invoke<string | null>("pick_folder");
    if (picked) path.value = picked;
  } catch {
    issue.value = "pickerFailed";
    void nextTick(() => pathInput.value?.focus({ preventScroll: true }));
  }
}
function submit() {
  issue.value = "";
  durationIssueField.value = undefined;
  if (mode.value === "open") {
    if (!path.value.trim()) {
      issue.value = "pathRequired";
      void nextTick(() => pathInput.value?.focus({ preventScroll: true }));
      return;
    }
    emit("open", path.value.trim());
    return;
  }
  if (!name.value.trim()) {
    issue.value = "nameRequired";
    void nextTick(() => nameInput.value?.focus({ preventScroll: true }));
    return;
  }
  if (!Number.isFinite(target.value) || target.value <= 0) {
    issue.value = "durationInvalid";
    durationIssueField.value = "target";
    void nextTick(() => targetInput.value?.focus({ preventScroll: true }));
    return;
  }
  if (!Number.isFinite(maximum.value) || maximum.value < target.value) {
    issue.value = "durationInvalid";
    durationIssueField.value = "maximum";
    void nextTick(() => maximumInput.value?.focus({ preventScroll: true }));
    return;
  }
  emit("create", {
    title: name.value.trim(),
    ...(path.value.trim()
      ? { path: path.value.trim() }
      : preferences.projectRoot
        ? { root: preferences.projectRoot }
        : {}),
    projectContentLocale: filmLocale.value,
    timebase: {
      ...PROJECT_TIMEBASE_PRESETS.find(
        (item) => item.id === timebasePresetId.value,
      )!.timebase,
    },
    filmSettings: {
      templateId: template.value,
      targetDuration: target.value,
      maxDuration: maximum.value,
    },
  });
}
</script>

<template>
  <main
    class="welcome project-launcher"
    :class="{ 'launcher-form-open': mode !== 'welcome' }"
  >
    <section class="welcome-intro launcher-intro">
      <span class="eyebrow">WELCOME / LOCAL-FIRST</span>
      <h1>{{ t("app.welcome.title") }}</h1>
      <p>{{ t("app.welcome.description") }}</p>
      <div class="launcher-brand-hero" aria-hidden="true">
        <GardenStones class="launcher-stack-graphic" />
      </div>
      <div v-if="mode === 'welcome'" class="launcher-actions">
        <button
          ref="createAction"
          class="primary"
          :disabled="busy"
          @click="changeMode('create')"
        >
          {{ t("app.welcome.create") }}<Icon name="plus" />
        </button>
        <button
          ref="openAction"
          class="secondary"
          :disabled="busy"
          @click="changeMode('open')"
        >
          {{ t("app.welcome.open") }}<Icon name="folder" />
        </button>
      </div>
      <div class="welcome-note">
        <Icon name="film" :size="18" /><span>{{ t("app.welcome.local") }}</span>
      </div>
    </section>
    <section v-if="mode === 'welcome'" class="launcher-home">
      <section class="recent-projects" :aria-label="t('app.welcome.recent')">
        <h2>{{ t("app.welcome.recent") }}</h2>
        <div v-if="!recent.length" class="recent-empty-card">
          <p class="muted">
            {{ t("app.welcome.noRecent") }}
          </p>
        </div>
        <button
          v-for="item in recent"
          :key="item.path"
          class="recent-project-row"
          :disabled="busy"
          :title="item.path"
          @click="emit('open', item.path)"
        >
          <Icon name="film" /><span
            ><strong>{{ item.title }}</strong
            ><small>{{ formatDate(item.openedAt) }}</small></span
          >
          <span class="recent-project-status" :data-status="item.status">{{
            t(`app.welcome.status.${item.status}`)
          }}</span
          ><Icon name="chevron" :size="14" />
        </button>
        <p class="project-footnote">{{ t("app.welcome.privacy") }}</p>
      </section>
    </section>
    <section v-else class="project-start" :aria-label="t('app.create.setup')">
      <button
        class="text-button"
        :disabled="busy"
        @click="changeMode('welcome')"
      >
        <Icon name="chevron" class="reverse" :size="14" />{{
          t("app.actions.back")
        }}
      </button>
      <h2>
        {{
          mode === "create" ? t("app.welcome.create") : t("app.welcome.open")
        }}
      </h2>
      <form
        :class="mode === 'create' ? 'create-film-form' : 'open-project-form'"
        novalidate
        @submit.prevent="submit"
      >
        <template v-if="mode === 'create'">
          <label class="field"
            >{{ t("app.create.name")
            }}<input
              ref="nameInput"
              v-model="name"
              name="title"
              :placeholder="t('app.create.namePlaceholder')"
              :aria-invalid="issue === 'nameRequired'"
              :aria-describedby="
                issue === 'nameRequired' ? 'launcher-form-error' : undefined
              "
              required
              autocomplete="off"
              @input="clearIssue"
          /></label>
          <div class="create-film-grid">
            <label class="field"
              >{{ t("app.create.timebase")
              }}<select v-model="timebasePresetId">
                <option
                  v-for="item in PROJECT_TIMEBASE_PRESETS"
                  :key="item.id"
                  :value="item.id"
                >
                  {{ t(item.labelKey) }}
                </option>
              </select></label
            >
            <label class="field"
              >{{ t("app.create.storyType")
              }}<select v-model="template">
                <option value="blank">{{ t("app.create.openStory") }}</option>
                <option value="proposal-film">
                  {{ t("app.create.proposal") }}
                </option>
              </select></label
            >
            <label class="field"
              >{{ t("app.create.filmLanguage")
              }}<select v-model="filmLocale" @change="filmLocaleEdited = true">
                <option
                  v-for="item in contentLocales"
                  :key="item.code"
                  :value="item.code"
                >
                  {{ item.label }}
                </option>
              </select></label
            >
            <label class="field"
              >{{ t("app.create.target")
              }}<input
                ref="targetInput"
                v-model.number="target"
                type="number"
                min="1"
                :aria-invalid="
                  issue === 'durationInvalid' && durationIssueField === 'target'
                "
                :aria-describedby="
                  issue === 'durationInvalid' && durationIssueField === 'target'
                    ? 'launcher-form-error'
                    : undefined
                "
                required
                @input="
                  timingEdited = true;
                  clearIssue();
                "
            /></label>
            <label class="field"
              >{{ t("app.create.maximum")
              }}<input
                ref="maximumInput"
                v-model.number="maximum"
                type="number"
                min="1"
                :aria-invalid="
                  issue === 'durationInvalid' &&
                  durationIssueField === 'maximum'
                "
                :aria-describedby="
                  issue === 'durationInvalid' &&
                  durationIssueField === 'maximum'
                    ? 'launcher-form-error'
                    : undefined
                "
                required
                @input="
                  timingEdited = true;
                  clearIssue();
                "
            /></label>
          </div>
          <p class="muted">{{ t("app.create.languageHint") }}</p>
          <details class="advanced-storage">
            <summary>{{ t("app.create.advanced") }}</summary>
            <label class="field"
              >{{ t("app.create.folder") }}
              <div class="path-input">
                <input
                  ref="pathInput"
                  v-model="path"
                  name="project-folder"
                  :placeholder="preferences.projectRoot || defaultRoot"
                  :aria-invalid="issue === 'pickerFailed'"
                  :aria-describedby="
                    issue === 'pickerFailed' ? 'launcher-form-error' : undefined
                  "
                  autocomplete="off"
                  @input="clearIssue"
                /><button
                  v-if="native"
                  type="button"
                  class="icon-button"
                  :aria-label="t('app.create.chooseFolder')"
                  @click="chooseFolder"
                >
                  <Icon name="folder" />
                </button>
              </div>
              <small>{{ t("app.create.folderHint") }}</small></label
            >
          </details>
        </template>
        <template v-else>
          <p>{{ t("app.create.openHint") }}</p>
          <label class="field"
            >{{ t("app.create.existingFolder") }}
            <div class="path-input">
              <input
                ref="pathInput"
                v-model="path"
                name="project-folder"
                required
                :aria-invalid="mode === 'open' && issue === 'pathRequired'"
                :aria-describedby="
                  mode === 'open' && issue === 'pathRequired'
                    ? 'launcher-form-error'
                    : undefined
                "
                autocomplete="off"
                @input="clearIssue"
              /><button
                v-if="native"
                type="button"
                class="icon-button"
                :aria-label="t('app.create.chooseFolder')"
                @click="chooseFolder"
              >
                <Icon name="folder" />
              </button></div
          ></label>
        </template>
        <p
          v-if="issue"
          id="launcher-form-error"
          class="inline-error"
          role="alert"
        >
          {{ t(`app.create.${issue}`) }}
        </p>
        <button class="primary full" type="submit" :disabled="busy">
          {{
            busy
              ? t("app.actions.working")
              : mode === "create"
                ? t("app.create.submit")
                : t("app.welcome.open")
          }}<Icon name="arrow" />
        </button>
      </form>
      <button
        v-if="!connected && !busy"
        class="text-button retry"
        @click="emit('retry')"
      >
        <Icon name="refresh" :size="15" />{{ t("app.actions.retry") }}
      </button>
      <p class="project-footnote">{{ t("app.welcome.privacy") }}</p>
    </section>
  </main>
</template>
