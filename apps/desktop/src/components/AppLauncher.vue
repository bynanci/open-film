<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { supportedLocales, formatDate } from "../i18n";
import { preferences } from "../preferences";
import type { FilmCreation, FilmLocale, RecentProject } from "../appTypes";
import Icon from "./Icon.vue";

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
const path = ref("");
const issue = ref("");
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
  mode.value = next;
  path.value = "";
  issue.value = "";
}
async function chooseFolder() {
  const { invoke } = await import("@tauri-apps/api/core");
  try {
    const picked = await invoke<string | null>("pick_folder");
    if (picked) path.value = picked;
  } catch {
    issue.value = "pickerFailed";
  }
}
function submit() {
  issue.value = "";
  if (mode.value === "open") {
    if (!path.value.trim()) {
      issue.value = "pathRequired";
      return;
    }
    emit("open", path.value.trim());
    return;
  }
  if (!name.value.trim()) {
    issue.value = "nameRequired";
    return;
  }
  if (
    !Number.isFinite(target.value) ||
    !Number.isFinite(maximum.value) ||
    target.value <= 0 ||
    maximum.value < target.value
  ) {
    issue.value = "durationInvalid";
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
        <svg
          class="launcher-stack-graphic"
          viewBox="0 0 360 190"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <linearGradient
              id="of-hero-top"
              x1="60"
              y1="20"
              x2="300"
              y2="120"
              gradientUnits="userSpaceOnUse"
            >
              <stop offset="0%" stop-color="#c48e63" />
              <stop offset="100%" stop-color="#593e29" />
            </linearGradient>
          </defs>
          <ellipse
            cx="180"
            cy="158"
            rx="118"
            ry="18"
            fill="#090b0d"
            opacity="0.65"
          />
          <polygon
            points="180,92 316,136 180,180 44,136"
            fill="#14171c"
            stroke="#2b313a"
            stroke-width="1.5"
          />
          <polygon
            points="180,62 316,106 180,150 44,106"
            fill="#232830"
            stroke="#3d4552"
            stroke-width="1.5"
          />
          <polygon
            points="180,26 316,74 180,122 44,74"
            fill="url(#of-hero-top)"
            stroke="#e0a477"
            stroke-opacity="0.55"
            stroke-width="1.5"
          />
          <polygon
            points="166,57 166,89 204,73"
            fill="#f7f5f1"
            fill-opacity="0.9"
          />
        </svg>
      </div>
      <div v-if="mode === 'welcome'" class="launcher-actions">
        <button class="primary" :disabled="busy" @click="changeMode('create')">
          {{ t("app.welcome.create") }}<Icon name="plus" />
        </button>
        <button class="secondary" :disabled="busy" @click="changeMode('open')">
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
              v-model="name"
              name="title"
              :placeholder="t('app.create.namePlaceholder')"
              required
              autocomplete="off"
          /></label>
          <div class="create-film-grid">
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
                v-model.number="target"
                type="number"
                min="1"
                required
                @input="timingEdited = true"
            /></label>
            <label class="field"
              >{{ t("app.create.maximum")
              }}<input
                v-model.number="maximum"
                type="number"
                min="1"
                required
                @input="timingEdited = true"
            /></label>
          </div>
          <p class="muted">{{ t("app.create.languageHint") }}</p>
          <details class="advanced-storage">
            <summary>{{ t("app.create.advanced") }}</summary>
            <label class="field"
              >{{ t("app.create.folder") }}
              <div class="path-input">
                <input
                  v-model="path"
                  name="project-folder"
                  :placeholder="preferences.projectRoot || defaultRoot"
                  autocomplete="off"
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
                v-model="path"
                name="project-folder"
                required
                autocomplete="off"
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
        <p v-if="issue" class="inline-error" role="alert">
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
