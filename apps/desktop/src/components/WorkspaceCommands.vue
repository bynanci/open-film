<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  useId,
  watch,
} from "vue";
import { useI18n } from "vue-i18n";
import {
  filterWorkspaceCommands,
  nextEnabledCommandIndex,
  type WorkspaceCommand,
  type WorkspaceCommandId,
} from "../workspace-commands";
import Icon from "./Icon.vue";

const props = defineProps<{ commands: readonly WorkspaceCommand[] }>();
const emit = defineEmits<{ close: []; execute: [id: WorkspaceCommandId] }>();
const { t } = useI18n();
const id = useId();
const dialog = ref<HTMLDialogElement | null>(null);
const search = ref<HTMLInputElement | null>(null);
const query = ref("");
const selected = ref(-1);
const results = computed(() =>
  filterWorkspaceCommands(props.commands, query.value),
);
const origin =
  document.activeElement instanceof HTMLElement ? document.activeElement : null;
const optionId = (index: number) => `${id}-command-${index}`;
let lastQuery = "";
watch(
  results,
  (items, previous) => {
    const previousId =
      query.value === lastQuery ? previous?.[selected.value]?.id : undefined;
    lastQuery = query.value;
    const retained = items.findIndex(
      (item) => item.id === previousId && !item.disabled,
    );
    selected.value =
      retained >= 0 ? retained : nextEnabledCommandIndex(items, -1, 1);
  },
  { immediate: true },
);
function execute(index: number) {
  const command = results.value[index];
  if (command && !command.disabled) emit("execute", command.id);
}
async function keyboard(event: KeyboardEvent) {
  if (event.isComposing) return;
  if (event.key === "Escape") {
    event.preventDefault();
    emit("close");
  } else if (event.target !== search.value) {
    return;
  } else if (event.key === "Enter") {
    event.preventDefault();
    execute(selected.value);
  } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    selected.value = nextEnabledCommandIndex(
      results.value,
      selected.value,
      event.key === "ArrowDown" ? 1 : -1,
    );
    await nextTick();
    if (selected.value >= 0)
      document
        .getElementById(optionId(selected.value))
        ?.scrollIntoView({ block: "nearest" });
  }
}
onMounted(() => {
  dialog.value?.showModal();
  search.value?.focus();
});
onBeforeUnmount(() => {
  dialog.value?.close();
  if (origin?.isConnected) origin.focus();
});
</script>

<template>
  <dialog
    ref="dialog"
    class="workspace-commands"
    role="dialog"
    aria-modal="true"
    :aria-labelledby="`${id}-title`"
    @cancel.prevent="emit('close')"
    @keydown.stop="keyboard"
    @click="$event.target === dialog && emit('close')"
  >
    <header>
      <h2 :id="`${id}-title`">{{ t("app.workspaceMode.commands") }}</h2>
      <button
        type="button"
        class="icon-button"
        :aria-label="t('app.workspaceMode.close')"
        @click="emit('close')"
      >
        <Icon name="reject" :size="18" />
      </button>
    </header>
    <label class="workspace-command-search">
      <Icon name="search" :size="18" />
      <span class="sr-only">{{ t("app.workspaceMode.search") }}</span>
      <input
        ref="search"
        v-model="query"
        type="search"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded="true"
        :aria-controls="`${id}-results`"
        :aria-activedescendant="selected >= 0 ? optionId(selected) : undefined"
        :placeholder="t('app.workspaceMode.placeholder')"
        autocomplete="off"
      />
    </label>
    <ul
      :id="`${id}-results`"
      role="listbox"
      :aria-label="t('app.workspaceMode.commands')"
    >
      <li
        v-for="(command, index) in results"
        :id="optionId(index)"
        :key="command.id"
        role="option"
        :aria-selected="selected === index"
        :aria-disabled="command.disabled || undefined"
        :class="{ selected: selected === index, unavailable: command.disabled }"
        @mousedown.prevent
        @click="execute(index)"
      >
        <Icon :name="command.icon" :size="18" />
        <span
          ><strong>{{ command.label }}</strong
          ><small v-if="command.description">{{
            command.description
          }}</small></span
        >
        <Icon v-if="command.disabled" name="lock" :size="15" />
        <Icon v-else name="arrow" :size="15" />
      </li>
    </ul>
    <p v-if="!results.length" class="workspace-command-empty" role="status">
      {{ t("app.workspaceMode.empty") }}
    </p>
    <footer>{{ t("app.workspaceMode.keyboard") }}</footer>
  </dialog>
</template>

<style scoped>
.workspace-commands {
  box-sizing: border-box;
  width: min(640px, calc(100vw - 32px));
  max-height: calc(100dvh - 32px);
  margin: auto;
  padding: 0;
  overflow: auto;
  color: var(--of-text-primary);
  background: var(--of-surface-1);
  border: 1px solid var(--of-border-subtle);
  border-radius: var(--of-radius-dialog);
  box-shadow: var(--of-shadow-dialog);
}
.workspace-commands::backdrop {
  background: var(--of-overlay);
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--of-group-gap);
  padding: var(--of-space-5) var(--of-space-6) var(--of-space-4);
}
h2 {
  font-size: var(--of-font-subtitle);
}
.workspace-command-search {
  display: flex;
  align-items: center;
  gap: var(--of-space-3);
  margin: 0 var(--of-space-4) var(--of-space-3);
  padding-inline: var(--of-space-3);
  border: 1px solid var(--of-border-control);
  border-radius: var(--of-radius-md);
  background: var(--of-bg);
  color: var(--of-text-secondary);
}
.workspace-command-search:focus-within {
  outline: 2px solid var(--of-focus);
  outline-offset: 3px;
}
input {
  min-width: 0;
  width: 100%;
  min-height: 46px;
  padding: var(--of-space-2) 0;
  border: 0;
  background: transparent;
  color: var(--of-text-primary);
  font: inherit;
}
input:focus-visible {
  /* The search group owns the visible ring around icon and input together. */
  outline: none;
}
ul {
  margin: 0;
  padding: var(--of-space-3);
  max-height: 45dvh;
  overflow: auto;
  list-style: none;
}
li {
  display: flex;
  align-items: center;
  gap: var(--of-space-3);
  padding: var(--of-space-3);
  border: 1px solid transparent;
  border-radius: var(--of-radius-md);
  cursor: pointer;
}
li > span {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
li strong,
li small {
  display: block;
}
li strong {
  font-size: var(--of-font-base);
  font-weight: 600;
}
li small,
footer {
  color: var(--of-text-secondary);
  font-size: var(--of-font-caption);
}
li.selected {
  color: var(--of-accent);
  background: var(--of-accent-soft);
  border-color: transparent;
  box-shadow: inset 3px 0 var(--of-accent);
}
li.unavailable {
  cursor: default;
  color: var(--of-text-muted);
}
.workspace-command-empty {
  padding: var(--of-space-6);
  color: var(--of-text-secondary);
}
footer {
  padding: var(--of-space-3) var(--of-space-4);
  border-top: 1px solid var(--of-border-subtle);
}
</style>
