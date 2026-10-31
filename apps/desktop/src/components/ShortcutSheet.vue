<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, useId, watch } from "vue";
import { useI18n } from "vue-i18n";
import Icon from "./Icon.vue";

const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  close: [];
}>();

const { t } = useI18n();
const titleId = useId();
const descId = useId();
const dialogRef = ref<HTMLDialogElement | null>(null);
const closeButtonRef = ref<HTMLButtonElement | null>(null);
let previousActiveElement: HTMLElement | null = null;

const groups = [
  {
    key: "transport",
    shortcuts: [
      { key: "Space", label: "cutDesk.shortcutSheet.items.space" },
      { key: "J · K · L", label: "cutDesk.shortcutSheet.items.jkl" },
      { key: "← · →", label: "cutDesk.shortcutSheet.items.arrows" },
    ],
  },
  {
    key: "marks",
    shortcuts: [
      { key: "I · O", label: "cutDesk.shortcutSheet.items.markInOut" },
      { key: "Enter (Apply)", label: "cutDesk.shortcutSheet.items.applyRange" },
    ],
  },
  {
    key: "edit",
    shortcuts: [
      { key: "↑ · ↓", label: "cutDesk.shortcutSheet.items.upDown" },
      { key: "B", label: "cutDesk.shortcutSheet.items.split" },
      { key: "M", label: "cutDesk.shortcutSheet.items.marker" },
    ],
  },
  {
    key: "timeline",
    shortcuts: [
      { key: "Home · End", label: "cutDesk.shortcutSheet.items.homeEnd" },
      { key: "⌘ / Ctrl + Z", label: "cutDesk.shortcutSheet.items.undoRedo" },
    ],
  },
  {
    key: "gestures",
    shortcuts: [
      { key: "Wheel", label: "cutDesk.shortcutSheet.items.zoom" },
      { key: "Shift + Wheel", label: "cutDesk.shortcutSheet.items.pan" },
      { key: "Alt + Drag", label: "cutDesk.shortcutSheet.items.snapBypass" },
      { key: "Shift + Drag", label: "cutDesk.shortcutSheet.items.fineTrim" },
      { key: "Escape", label: "cutDesk.shortcutSheet.items.cancel" },
      { key: "?", label: "cutDesk.shortcutSheet.items.help" },
    ],
  },
] as const;

function handleKeydown(event: KeyboardEvent) {
  if (!props.open) return;
  if (event.key === "Escape") {
    event.preventDefault();
    emit("close");
    return;
  }
  if (
    event.key === "Tab" &&
    dialogRef.value &&
    typeof document !== "undefined"
  ) {
    const focusable = dialogRef.value.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }
}

watch(
  () => props.open,
  async (isOpen) => {
    if (isOpen) {
      if (
        typeof document !== "undefined" &&
        document.activeElement instanceof HTMLElement
      ) {
        previousActiveElement = document.activeElement;
      }
      if (typeof window !== "undefined") {
        window.addEventListener("keydown", handleKeydown, true);
      }
      await nextTick();
      if (typeof closeButtonRef.value?.focus === "function") {
        closeButtonRef.value.focus();
      }
    } else {
      if (typeof window !== "undefined") {
        window.removeEventListener("keydown", handleKeydown, true);
      }
      if (
        typeof document !== "undefined" &&
        previousActiveElement &&
        document.contains(previousActiveElement) &&
        typeof previousActiveElement.focus === "function"
      ) {
        previousActiveElement.focus();
      }
      previousActiveElement = null;
    }
  },
  { immediate: true },
);

onMounted(() => {
  if (props.open && typeof window !== "undefined") {
    window.addEventListener("keydown", handleKeydown, true);
  }
});

onUnmounted(() => {
  if (typeof window !== "undefined") {
    window.removeEventListener("keydown", handleKeydown, true);
  }
});
</script>

<template>
  <div v-if="open" class="shortcut-sheet-overlay" @click.self="emit('close')">
    <div
      ref="dialogRef"
      class="shortcut-sheet-dialog"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="titleId"
      :aria-describedby="descId"
    >
      <header class="shortcut-sheet-header">
        <div class="shortcut-sheet-header-text">
          <h2 :id="titleId" class="shortcut-sheet-title">
            {{ t("cutDesk.shortcutSheet.title") }}
          </h2>
          <p :id="descId" class="shortcut-sheet-desc">
            {{ t("cutDesk.shortcutSheet.desc") }}
          </p>
        </div>
        <button
          ref="closeButtonRef"
          type="button"
          class="editor-button shortcut-sheet-close"
          :aria-label="t('cutDesk.shortcutSheet.close')"
          @click="emit('close')"
        >
          <Icon name="close" :size="16" />
        </button>
      </header>

      <div class="shortcut-sheet-content">
        <section
          v-for="group in groups"
          :key="group.key"
          class="shortcut-sheet-group"
        >
          <h3 class="shortcut-sheet-group-title">
            {{ t(`cutDesk.shortcutSheet.groups.${group.key}`) }}
          </h3>
          <dl class="shortcut-sheet-list">
            <div
              v-for="item in group.shortcuts"
              :key="item.key"
              class="shortcut-sheet-row"
            >
              <dt class="shortcut-sheet-key">
                <kbd>{{ item.key }}</kbd>
              </dt>
              <dd class="shortcut-sheet-label">
                {{ t(item.label) }}
              </dd>
            </div>
          </dl>
        </section>
      </div>
    </div>
  </div>
</template>
