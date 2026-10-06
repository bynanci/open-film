<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { supportedLocales, uiLocale, setUiLocale } from "../i18n";
import {
  preferences,
  setTheme,
  setDefaultFilmLocale,
  setProjectRoot,
} from "../preferences";
import type { FilmLocale } from "../appTypes";
import Icon from "./Icon.vue";
const props = defineProps<{
  contentLocale?: string;
  busy: boolean;
  native: boolean;
  defaultRoot: string;
}>();
const emit = defineEmits<{ close: []; contentLocale: [value: FilmLocale] }>();
const { t } = useI18n();
const pickerFailed = ref(false);
const interfaceLocales = [
  ...supportedLocales,
  ...(import.meta.env.DEV ? [{ code: "en-XA", label: "Pseudo · en-XA" }] : []),
];
const contentLocales = computed(() => supportedLocales);
const dialog = ref<HTMLElement | null>(null);
const root = ref(preferences.projectRoot);
const previousFocus = document.activeElement as HTMLElement | null;
function keydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    event.stopPropagation();
    emit("close");
  }
  if (event.key !== "Tab") return;
  const nodes = Array.from(
    dialog.value?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]',
    ) ?? [],
  );
  const first = nodes[0];
  const last = nodes.at(-1);
  if (
    event.shiftKey &&
    (document.activeElement === first ||
      document.activeElement === dialog.value)
  ) {
    event.preventDefault();
    last?.focus();
  }
  if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
}
async function chooseRoot() {
  pickerFailed.value = false;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const picked = await invoke<string | null>("pick_folder");
    if (picked) {
      root.value = picked;
      setProjectRoot(picked);
    }
  } catch {
    pickerFailed.value = true;
  }
}
function changeContentLocale(event: Event) {
  const input = event.target as HTMLSelectElement;
  const next = input.value as FilmLocale;
  input.value = props.contentLocale ?? "en-US";
  emit("contentLocale", next);
}
onMounted(() => {
  dialog.value?.querySelector<HTMLElement>("button, select, input")?.focus();
});
onBeforeUnmount(() => previousFocus?.focus());
</script>
<template>
  <div class="settings-backdrop" @click.self="emit('close')">
    <section
      ref="dialog"
      class="settings-dialog"
      role="dialog"
      aria-modal="true"
      :aria-label="t('app.settings.title')"
      tabindex="-1"
      @keydown="keydown"
    >
      <header class="settings-header">
        <h2>{{ t("app.settings.title") }}</h2>
        <button
          class="icon-button"
          :aria-label="t('app.settings.close')"
          @click="emit('close')"
        >
          <Icon name="reject" />
        </button>
      </header>
      <div class="settings-grid">
        <label class="field"
          >{{ t("app.settings.language")
          }}<select
            :value="uiLocale"
            @change="setUiLocale(($event.target as HTMLSelectElement).value)"
          >
            <option
              v-for="item in interfaceLocales"
              :key="item.code"
              :value="item.code"
            >
              {{ item.label }}
            </option></select
          ><small>{{ t("app.settings.languageHint") }}</small></label
        >
        <label class="field"
          >{{ t("app.settings.theme")
          }}<select
            :value="preferences.theme"
            @change="
              setTheme(
                ($event.target as HTMLSelectElement).value as
                  'dark' | 'light' | 'system',
              )
            "
          >
            <option value="dark">{{ t("app.settings.dark") }}</option>
            <option value="light">{{ t("app.settings.light") }}</option>
            <option value="system">{{ t("app.settings.system") }}</option>
          </select></label
        >
        <label class="field"
          >{{ t("app.settings.defaultFilmLanguage")
          }}<select
            :value="preferences.defaultFilmLocale"
            @change="
              setDefaultFilmLocale(
                ($event.target as HTMLSelectElement).value as FilmLocale,
              )
            "
          >
            <option
              v-for="item in contentLocales"
              :key="item.code"
              :value="item.code"
            >
              {{ item.label }}
            </option>
          </select></label
        >
        <label v-if="props.contentLocale" class="field"
          >{{ t("app.settings.currentFilmLanguage")
          }}<select
            :value="contentLocale"
            :disabled="busy"
            @change="changeContentLocale"
          >
            <option
              v-for="item in contentLocales"
              :key="item.code"
              :value="item.code"
            >
              {{ item.label }}
            </option></select
          ><small>{{ t("app.settings.contentHint") }}</small></label
        >
        <label class="field"
          >{{ t("app.settings.storage") }}
          <div class="path-input">
            <input
              v-model="root"
              :placeholder="defaultRoot"
              @change="setProjectRoot(root.trim())"
            /><button
              v-if="native"
              class="icon-button"
              :aria-label="t('app.create.chooseFolder')"
              @click="chooseRoot"
            >
              <Icon name="folder" />
            </button>
          </div>
          <small>{{ t("app.settings.storageHint") }}</small
          ><span v-if="pickerFailed" role="alert">{{
            t("app.create.pickerFailed")
          }}</span></label
        >
      </div>
      <section class="settings-privacy">
        <h3>{{ t("app.settings.localTitle") }}</h3>
        <p>{{ t("app.settings.localDescription") }}</p>
        <p>{{ t("app.settings.autosave") }}</p>
      </section>
      <button class="primary" @click="emit('close')">
        {{ t("app.actions.done") }}
      </button>
    </section>
  </div>
</template>
