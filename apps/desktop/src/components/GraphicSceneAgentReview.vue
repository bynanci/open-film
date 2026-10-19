<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { GraphicScene } from "@openfilm/core";
import {
  api,
  ApiError,
  type EditorState,
  type GraphicSceneAgentAcceptance,
  type GraphicSceneAgentPlan,
  type ReviewProviderState,
} from "../api";
import { graphicSceneAgentReceiptKey } from "../graphic-scene-agent-receipt";

const props = defineProps<{
  projectId: string;
  compositionId: string;
  revision: string;
  scene: GraphicScene;
  selectedNodeId: string;
  disabled: boolean;
}>();
const emit = defineEmits<{
  accepted: [state: EditorState];
  busy: [value: boolean];
  pending: [value: boolean];
  reload: [];
}>();
const { t } = useI18n();
const instruction = ref("");
const mode = ref<"local" | "provider">("local");
const provider = ref<ReviewProviderState>();
const plan = ref<GraphicSceneAgentPlan | null>(null);
const selected = ref<string[]>([]);
const busy = ref(false);
const error = ref("");
const pending = ref<GraphicSceneAgentAcceptance | null>(null);
const isStale = computed(
  () => !!plan.value && plan.value.baseRevision !== props.revision,
);
const selectedActions = computed(
  () =>
    plan.value?.actions.filter((action) =>
      selected.value.includes(action.id),
    ) ?? [],
);
const acceptDisabled = computed(
  () =>
    busy.value ||
    props.disabled ||
    !!pending.value ||
    isStale.value ||
    !selectedActions.value.length,
);
let generation = 0;
let disposed = false;
let previewController: AbortController | undefined;
const ownerKey = computed(() =>
  graphicSceneAgentReceiptKey(props.projectId, props.compositionId),
);
function retainPending(): boolean {
  try {
    if (pending.value) {
      const serialized = JSON.stringify(pending.value);
      localStorage.setItem(ownerKey.value, serialized);
      return localStorage.getItem(ownerKey.value) === serialized;
    }
    localStorage.removeItem(ownerKey.value);
    return true;
  } catch {
    return false;
  }
}
function restorePending() {
  pending.value = null;
  try {
    const raw = localStorage.getItem(ownerKey.value);
    if (!raw) return;
    const value = JSON.parse(raw) as GraphicSceneAgentAcceptance;
    if (
      typeof value.planId !== "string" ||
      !/^[a-f0-9]{64}$/u.test(value.planId) ||
      typeof value.baseRevision !== "string" ||
      !/^[a-f0-9]{64}$/u.test(value.baseRevision) ||
      !Array.isArray(value.actionIds) ||
      !value.actionIds.length ||
      typeof value.requestId !== "string" ||
      !value.requestId.trim()
    )
      throw new Error("Invalid GraphicScene acceptance receipt.");
    pending.value = value;
  } catch {
    try {
      localStorage.removeItem(ownerKey.value);
    } catch {
      /* Keep the parent barrier fail-closed when receipt storage is unreadable. */
    }
    error.value = t("editor.graphics.agentStorageError");
    emit("pending", false);
  }
}
watch(busy, (value) => emit("busy", value), { immediate: true });
function reset() {
  generation++;
  previewController?.abort();
  previewController = undefined;
  plan.value = null;
  selected.value = [];
  error.value = "";
  // A preview belongs to the revision/selection that started it. If that
  // owner changes, ignore its eventual response and release the editor gate.
  if (!pending.value) busy.value = false;
}
watch(
  [
    () => props.projectId,
    () => props.compositionId,
    () => props.revision,
    () => props.scene.id,
    () => props.selectedNodeId,
  ],
  reset,
);
watch(
  [() => props.projectId, () => props.compositionId],
  () => {
    restorePending();
    // In-flight work for the previous owner cannot hold the new project open.
    // Its receipt remains under the previous project's storage key.
    previewController?.abort();
    previewController = undefined;
    busy.value = false;
  },
  { immediate: true, flush: "sync" },
);
// Restore before the immediate emission so the parent never briefly drops a
// persisted receipt barrier while the review panel mounts.
watch(pending, (value) => emit("pending", !!value), {
  immediate: true,
  flush: "sync",
});
async function refreshProvider() {
  try {
    provider.value = await api.reviewProvider("graphic-scene");
  } catch {
    provider.value = undefined;
  }
}
onMounted(() => void refreshProvider());
onBeforeUnmount(() => {
  disposed = true;
  generation++;
  previewController?.abort();
  previewController = undefined;
  emit("busy", false);
  // Keep the editor's navigation/export barrier if the inspector is switched
  // away while acceptance is uncertain. The receipt must be retried or
  // explicitly discarded after the review UI is mounted again.
  if (!pending.value) emit("pending", false);
});
async function consent(allow: boolean) {
  if (busy.value || props.disabled || pending.value) return;
  busy.value = true;
  error.value = "";
  try {
    provider.value = await api.reviewConsent(
      allow,
      provider.value?.provider,
      "graphic-scene",
    );
    if (allow && provider.value.available) mode.value = "provider";
  } catch {
    error.value = t("editor.graphics.agentProviderError");
  } finally {
    busy.value = false;
  }
}
async function generate() {
  if (
    busy.value ||
    pending.value ||
    props.disabled ||
    !props.selectedNodeId ||
    !instruction.value.trim() ||
    (mode.value === "provider" && !provider.value?.available)
  )
    return;
  const run = ++generation;
  const controller = new AbortController();
  previewController?.abort();
  previewController = controller;
  busy.value = true;
  plan.value = null;
  selected.value = [];
  error.value = "";
  try {
    const next = await api.previewGraphicSceneAgent(
      props.compositionId,
      {
        baseRevision: props.revision,
        sceneId: props.scene.id,
        nodeIds: [props.selectedNodeId],
        instruction: instruction.value,
        mode: mode.value,
      },
      controller.signal,
    );
    if (disposed || run !== generation) return;
    plan.value = next;
    selected.value = [];
  } catch (cause) {
    if (disposed || run !== generation) return;
    error.value =
      cause instanceof ApiError && cause.status === 409
        ? t("editor.graphics.agentStale")
        : cause instanceof ApiError &&
            cause.code === "review.providerUnavailable"
          ? t("editor.graphics.agentProviderUnavailable")
          : t("editor.graphics.agentGenerateError");
  } finally {
    if (previewController === controller) previewController = undefined;
    if (!disposed && run === generation) busy.value = false;
  }
}
function toggle(actionId: string, event: Event) {
  if (busy.value || pending.value || isStale.value) return;
  const checked = (event.target as HTMLInputElement).checked;
  const action = plan.value?.actions.find((item) => item.id === actionId);
  if (!action) return;
  if (checked) {
    if (action.requiresActionIds.some((id) => !selected.value.includes(id)))
      return;
    selected.value = [...new Set([...selected.value, actionId])];
    return;
  }
  const deselected = new Set([actionId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const dependent of plan.value?.actions ?? [])
      if (
        !deselected.has(dependent.id) &&
        dependent.requiresActionIds.some((id) => deselected.has(id))
      ) {
        deselected.add(dependent.id);
        changed = true;
      }
  }
  selected.value = selected.value.filter((id) => !deselected.has(id));
}
function prerequisitesSelected(
  action: GraphicSceneAgentPlan["actions"][number],
) {
  return action.requiresActionIds.every((id) => selected.value.includes(id));
}
function prerequisiteNumbers(action: GraphicSceneAgentPlan["actions"][number]) {
  return action.requiresActionIds
    .map(
      (id) =>
        (plan.value?.actions.findIndex((item) => item.id === id) ?? -1) + 1,
    )
    .filter((index) => index > 0)
    .join(", ");
}
async function transmit(value: GraphicSceneAgentAcceptance) {
  if (
    busy.value ||
    !pending.value ||
    pending.value.requestId !== value.requestId
  )
    return;
  // Persist the idempotency receipt before sending the write. If storage is
  // unavailable, keep the editor blocked and let Retry attempt persistence
  // again; sending first would make a dropped response impossible to recover.
  if (!retainPending()) {
    error.value = t("editor.graphics.agentStorageError");
    return;
  }
  const owner = ownerKey.value;
  busy.value = true;
  error.value = "";
  try {
    const saved = await api.acceptGraphicSceneAgent(props.compositionId, value);
    if (disposed || pending.value?.requestId !== value.requestId) return;
    pending.value = null;
    retainPending();
    plan.value = null;
    selected.value = [];
    emit("accepted", saved);
  } catch (cause) {
    if (disposed || pending.value?.requestId !== value.requestId) return;
    if (cause instanceof ApiError && cause.status === 409) {
      pending.value = null;
      retainPending();
      plan.value = null;
      error.value = t("editor.graphics.agentStale");
      emit("reload");
    } else error.value = t("editor.graphics.agentAcceptError");
  } finally {
    if (!disposed && ownerKey.value === owner) busy.value = false;
  }
}
async function accept() {
  if (acceptDisabled.value || !plan.value) return;
  const value: GraphicSceneAgentAcceptance = {
    planId: plan.value.id,
    baseRevision: plan.value.baseRevision,
    actionIds: [...selected.value],
    requestId: crypto.randomUUID(),
  };
  pending.value = value;
  retainPending();
  await transmit(value);
}
async function retry() {
  if (pending.value) await transmit(pending.value);
}
function discardPending() {
  pending.value = null;
  retainPending();
  error.value = t("editor.graphics.agentStale");
}
</script>

<template>
  <section class="graphic-agent-review" data-testid="graphic-agent-review">
    <h3>{{ t("editor.graphics.agentTitle") }}</h3>
    <p class="editor-muted">
      {{ t("editor.graphics.agentScope", { id: selectedNodeId || "—" }) }}
    </p>
    <label>
      {{ t("editor.graphics.agentInstruction") }}
      <textarea
        v-model="instruction"
        data-testid="graphic-agent-instruction"
        :disabled="busy || disabled || !!pending"
        :placeholder="t('editor.graphics.agentPlaceholder')"
        maxlength="2000"
      />
    </label>
    <div
      class="graphic-agent-modes"
      role="group"
      :aria-label="t('editor.graphics.agentMode')"
    >
      <label>
        <input
          v-model="mode"
          type="radio"
          value="local"
          :disabled="busy || disabled || !!pending"
        />
        {{ t("editor.graphics.agentLocal") }}
      </label>
      <label>
        <input
          v-model="mode"
          type="radio"
          value="provider"
          :disabled="busy || disabled || !!pending || !provider?.available"
        />
        {{ t("editor.graphics.agentProvider") }}
      </label>
    </div>
    <div v-if="provider?.configured" class="graphic-agent-disclosure">
      <strong>{{ provider.provider?.name }}</strong>
      <p v-if="provider.provider?.execution === 'remote'">
        {{ t("editor.graphics.agentRemoteDisclosure") }}
      </p>
      <p v-if="provider.provider?.endpoint">
        {{
          t("transcript.providerDestination", {
            destination: provider.provider.endpoint,
          })
        }}
      </p>
      <details>
        <summary>{{ t("transcript.providerDataKinds") }}</summary>
        <ul>
          <li v-for="kind in provider.provider?.dataKinds" :key="kind">
            {{ t(`transcript.dataKinds.${kind}`) }}
          </li>
        </ul>
      </details>
      <div
        v-if="provider.provider?.execution === 'remote'"
        class="editor-actions"
      >
        <button
          v-if="!provider.available"
          type="button"
          class="text-button"
          :disabled="busy || disabled || !!pending"
          @click="consent(true)"
        >
          {{ t("editor.graphics.agentGrantConsent") }}
        </button>
        <button
          v-else
          type="button"
          class="text-button"
          :disabled="busy || disabled || !!pending"
          @click="consent(false)"
        >
          {{ t("editor.graphics.agentRevokeConsent") }}
        </button>
      </div>
    </div>
    <p v-else class="editor-muted">
      {{ t("editor.graphics.agentNoProvider") }}
    </p>
    <button
      type="button"
      class="editor-button"
      data-testid="graphic-agent-preview"
      :disabled="
        busy ||
        disabled ||
        !!pending ||
        !selectedNodeId ||
        !instruction.trim() ||
        (mode === 'provider' && !provider?.available)
      "
      @click="generate"
    >
      {{
        busy
          ? t("editor.graphics.agentWorking")
          : t("editor.graphics.agentPreview")
      }}
    </button>
    <div
      v-if="plan"
      class="graphic-agent-plan"
      data-testid="graphic-agent-plan"
    >
      <p class="editor-muted">
        {{
          t("editor.graphics.agentSource", {
            source: t(
              `editor.graphics.agentSource${plan.source === "provider" ? "Provider" : "Local"}`,
            ),
          })
        }}
      </p>
      <p class="editor-muted">
        {{ t("editor.graphics.agentSelectInstructions") }}
      </p>
      <p v-if="isStale" role="alert">{{ t("editor.graphics.agentStale") }}</p>
      <ul class="graphic-agent-actions">
        <li
          v-for="action in plan.actions"
          :key="action.id"
          data-testid="graphic-agent-action"
        >
          <label>
            <input
              type="checkbox"
              :checked="selected.includes(action.id)"
              :disabled="
                busy ||
                disabled ||
                !!pending ||
                isStale ||
                !prerequisitesSelected(action)
              "
              @change="toggle(action.id, $event)"
            />
            <span>
              {{ action.reason }}
              <span v-if="action.requiresActionIds.length" class="editor-muted">
                {{
                  t("editor.graphics.agentRequiresActions", {
                    actions: prerequisiteNumbers(action),
                  })
                }}
              </span>
            </span>
          </label>
          <dl>
            <dt>{{ t("editor.graphics.agentAffected") }}</dt>
            <dd>
              <code>{{ action.nodeId }}</code>
            </dd>
            <dt>{{ t("editor.graphics.agentBefore") }}</dt>
            <dd>
              <pre>{{ JSON.stringify(action.before) }}</pre>
            </dd>
            <dt>{{ t("editor.graphics.agentAfter") }}</dt>
            <dd>
              <pre>{{ JSON.stringify(action.after) }}</pre>
            </dd>
          </dl>
        </li>
      </ul>
      <ul
        v-if="plan.conflicts.length"
        class="graphic-agent-conflicts"
        role="status"
        data-testid="graphic-agent-conflicts"
      >
        <li
          v-for="(conflict, index) in plan.conflicts"
          :key="`${conflict.code}:${conflict.nodeId ?? ''}:${index}`"
        >
          <strong>{{
            t(`editor.graphics.agentConflict.${conflict.code}`)
          }}</strong>
          · {{ conflict.text }}
          <code v-if="conflict.nodeId">{{ conflict.nodeId }}</code>
        </li>
      </ul>
      <button
        type="button"
        class="editor-button"
        data-testid="graphic-agent-accept"
        :disabled="acceptDisabled"
        @click="accept"
      >
        {{
          t("editor.graphics.agentAccept", { count: selectedActions.length })
        }}
      </button>
    </div>
    <div v-if="pending" class="graphic-agent-pending" role="status">
      <p>{{ t("editor.graphics.agentPending") }}</p>
      <button
        type="button"
        class="editor-button"
        data-testid="graphic-agent-retry"
        :disabled="busy"
        @click="retry"
      >
        {{ t("editor.graphics.agentRetry") }}
      </button>
      <button
        type="button"
        class="text-button"
        :disabled="busy"
        @click="discardPending"
      >
        {{ t("editor.graphics.agentDiscardPending") }}
      </button>
    </div>
    <p v-if="error" role="alert" data-testid="graphic-agent-error">
      {{ error }}
    </p>
  </section>
</template>

<style scoped>
.graphic-agent-review {
  display: grid;
  gap: 0.55rem;
  border-top: 1px solid var(--border-subtle);
  margin-top: 0.75rem;
  padding-top: 0.75rem;
}
.graphic-agent-review h3,
.graphic-agent-review p {
  margin: 0;
}
.graphic-agent-review textarea {
  min-height: 4.5rem;
}
.graphic-agent-modes,
.graphic-agent-disclosure,
.graphic-agent-pending {
  display: grid;
  gap: 0.35rem;
  border: 1px solid var(--border-subtle);
  border-radius: 0.5rem;
  padding: 0.55rem;
}
.graphic-agent-modes label {
  display: flex;
  gap: 0.4rem;
  align-items: center;
}
.graphic-agent-actions,
.graphic-agent-conflicts {
  display: grid;
  gap: 0.5rem;
  margin: 0;
  padding-left: 1.25rem;
}
.graphic-agent-actions li {
  border: 1px solid var(--border-subtle);
  border-radius: 0.45rem;
  padding: 0.5rem;
}
.graphic-agent-actions li > label {
  display: flex;
  align-items: flex-start;
  gap: 0.45rem;
}
.graphic-agent-actions dl {
  display: grid;
  grid-template-columns: minmax(5rem, 0.6fr) minmax(0, 1fr);
  gap: 0.2rem 0.5rem;
  margin: 0.5rem 0 0;
  overflow-wrap: anywhere;
}
.graphic-agent-actions dd {
  margin: 0;
}
.graphic-agent-actions pre {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font: inherit;
}
.graphic-agent-disclosure p {
  overflow-wrap: anywhere;
}
</style>
