<script setup lang="ts">
import { computed, nextTick, ref, shallowRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { Job } from "@openfilm/core";
import type { AnalysisJobRecoveryState, AnalysisRecoveryInput } from "../api";

const props = defineProps<{
  projectId: string;
  job: Job;
  recovery?: AnalysisJobRecoveryState;
  pending?: boolean;
  disabled?: boolean;
  cancelLabel?: string;
}>();
const emit = defineEmits<{
  cancel: [];
  recover: [input: AnalysisRecoveryInput];
}>();
const { t } = useI18n();
const confirmation = shallowRef<{
  projectId: string;
  jobId: string;
  checkpoint: string;
  ownerToken?: string;
}>();
const confirmButton = ref<HTMLButtonElement | null>(null);
const recoverButton = ref<HTMLButtonElement | null>(null);
const active = computed(
  () =>
    ["transcribe", "waveform", "scenes"].includes(props.job.type) &&
    ["queued", "running"].includes(props.job.status),
);
const canCancel = computed(
  () =>
    active.value &&
    props.recovery?.jobId === props.job.id &&
    props.recovery?.canCancel === true,
);
const canRecover = computed(
  () =>
    active.value &&
    !!props.recovery?.checkpoint &&
    props.recovery.jobId === props.job.id &&
    props.recovery.manualRecoveryAllowed &&
    props.recovery.ownerState !== "alive" &&
    !props.recovery.canCancel,
);
function confirmationIsCurrent() {
  const saved = confirmation.value;
  return (
    !!saved &&
    canRecover.value &&
    saved.projectId === props.projectId &&
    saved.jobId === props.job.id &&
    saved.checkpoint === props.recovery?.checkpoint &&
    saved.ownerToken === props.recovery?.ownerToken
  );
}
function beginRecovery() {
  if (!canRecover.value || props.pending || props.disabled) return;
  confirmation.value = {
    projectId: props.projectId,
    jobId: props.job.id,
    checkpoint: props.recovery!.checkpoint,
    ownerToken: props.recovery!.ownerToken,
  };
  void nextTick(() => confirmButton.value?.focus());
}
function confirmRecovery() {
  if (props.pending || props.disabled || !confirmationIsCurrent()) return;
  const saved = confirmation.value!;
  confirmation.value = undefined;
  emit("recover", {
    confirmStopped: true,
    checkpoint: saved.checkpoint,
    ...(saved.ownerToken === undefined ? {} : { ownerToken: saved.ownerToken }),
  });
}
function keepCurrent() {
  confirmation.value = undefined;
  void nextTick(() => recoverButton.value?.focus());
}
watch(
  [
    () => props.projectId,
    () => props.job.id,
    () => props.job.status,
    () => props.recovery?.checkpoint,
    () => props.recovery?.ownerToken,
    () => props.recovery?.ownerState,
    () => props.recovery?.manualRecoveryAllowed,
    () => props.recovery?.canCancel,
  ],
  () => {
    if (confirmation.value && !confirmationIsCurrent())
      confirmation.value = undefined;
  },
  { flush: "sync" },
);
</script>

<template>
  <div
    v-if="active"
    class="analysis-job-actions"
    :class="{ 'analysis-job-actions-expanded': !canCancel }"
    :aria-busy="pending || undefined"
    data-testid="analysis-job-actions"
    :data-job-id="job.id"
  >
    <button
      v-if="canCancel"
      class="editor-button"
      :disabled="pending || disabled"
      @click="emit('cancel')"
    >
      {{
        pending
          ? t("precision.recovery.pending")
          : (cancelLabel ?? t("precision.cancelJob"))
      }}
    </button>
    <template v-else>
      <p role="status" class="editor-note">
        {{
          t(
            !recovery
              ? "precision.recovery.checking"
              : recovery.ownerState === "alive"
                ? "precision.recovery.runningElsewhere"
                : recovery.ownerState === "dead"
                  ? "precision.recovery.stopped"
                  : "precision.recovery.unknown",
          )
        }}
      </p>
      <div
        v-if="confirmation"
        class="editor-actions"
        role="group"
        :aria-label="t('precision.recovery.confirmTitle')"
      >
        <p class="editor-note">{{ t("precision.recovery.confirmMessage") }}</p>
        <button
          ref="confirmButton"
          class="editor-button primary"
          :disabled="pending || disabled"
          @click="confirmRecovery"
        >
          {{ t("precision.recovery.confirmStopped") }}
        </button>
        <button
          class="editor-button"
          :disabled="pending || disabled"
          @click="keepCurrent"
        >
          {{ t("precision.recovery.keepCurrent") }}
        </button>
      </div>
      <button
        v-else-if="canRecover"
        ref="recoverButton"
        class="editor-button"
        :disabled="pending || disabled"
        @click="beginRecovery"
      >
        {{
          pending
            ? t("precision.recovery.pending")
            : t("precision.recovery.recover")
        }}
      </button>
    </template>
  </div>
</template>

<style scoped>
.analysis-job-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--of-space-2);
  min-width: 0;
}
.analysis-job-actions-expanded {
  flex-basis: 100%;
}
.analysis-job-actions p {
  margin: 0;
  overflow-wrap: anywhere;
}
</style>
