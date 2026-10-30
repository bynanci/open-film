<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId, watch } from "vue";
import { useI18n } from "vue-i18n";
import type {
  CollectCoveragePlanInput,
  CollectCoverageReview,
  CollectMediaCreateResult,
} from "@openfilm/application";
import type {
  CollectCoverageReason,
  CollectDeliveryMode,
} from "@openfilm/core";
import { api } from "../api";
import { localizeError } from "../i18n";
const props = defineProps<{
  request: Omit<CollectCoveragePlanInput, "delivery">;
  disabled: boolean;
}>();
const emit = defineEmits<{
  busy: [value: boolean];
  created: [value: CollectMediaCreateResult];
}>();
const { t, locale } = useI18n();
const uid = useId();
const mode = ref<CollectDeliveryMode>("trimmed-originals");
const handles = ref(2);
const format = ref<"directory" | "zip">("zip"),
  accepted = ref(false);
const creating = ref(false);
const reviewState = ref<CollectCoverageReview>();
const busy = ref(false),
  error = ref("");
const offset = ref(0);
let generation = 0;
let controller: AbortController | undefined;
const signature = computed(() =>
  JSON.stringify([props.request, mode.value, handles.value, format.value]),
);
const entries = computed(
  () =>
    reviewState.value?.coverage.entries.slice(
      offset.value,
      offset.value + 50,
    ) ?? [],
);
const names = computed(
  () =>
    new Map(
      reviewState.value?.baseline.items.map((item) => [
        item.resourceId,
        item.displayName,
      ]) ?? [],
    ),
);
const reasons: Record<CollectCoverageReason, string> = {
  "source.identity-missing": "identityMissing",
  "source.timing-unavailable": "timingUnavailable",
  "source.unsupported": "unsupported",
  "source.locked": "locked",
  "source.user-pinned": "userPinned",
  "source.opaque-reference": "opaqueReference",
  "source.evidence-bound": "evidenceBound",
  "source.range-invalid": "rangeInvalid",
  "source.unused": "unused",
};
function seconds(value: number) {
  return new Intl.NumberFormat(locale.value, {
    maximumFractionDigits: 3,
  }).format(value);
}
function reset() {
  generation++;
  controller?.abort();
  controller = undefined;
  busy.value = false;
  accepted.value = false;
  creating.value = false;
  reviewState.value = undefined;
  offset.value = 0;
  error.value = "";
  emit("busy", false);
}
async function review() {
  if (busy.value || props.disabled) return;
  const owner = ++generation,
    inputSignature = signature.value;
  const current = new AbortController();
  controller = current;
  const input: CollectCoveragePlanInput = {
    ...props.request,
    delivery: { version: 1, mode: mode.value, handlesSeconds: handles.value },
  };
  busy.value = true;
  accepted.value = false;
  error.value = "";
  reviewState.value = undefined;
  emit("busy", true);
  try {
    const response = await api.collectCoverage(input, current.signal);
    if (
      current.signal.aborted ||
      controller !== current ||
      generation !== owner ||
      signature.value !== inputSignature ||
      response.review.coverage.projectId !== input.projectId ||
      response.review.baseline.projectId !== input.projectId
    )
      return;
    reviewState.value = response.review;
    offset.value = 0;
  } catch (cause) {
    if (
      !current.signal.aborted &&
      controller === current &&
      generation === owner
    )
      error.value = localizeError(cause);
  } finally {
    if (controller === current && generation === owner) {
      controller = undefined;
      busy.value = false;
      emit("busy", false);
    }
  }
}
async function createPackage() {
  const reviewed = reviewState.value;
  if (
    busy.value ||
    props.disabled ||
    !accepted.value ||
    !reviewed?.baseline.complete
  )
    return;
  const owner = ++generation,
    inputSignature = signature.value,
    current = new AbortController();
  controller = current;
  busy.value = true;
  creating.value = true;
  error.value = "";
  emit("busy", true);
  try {
    const response = await api.createCollectedMedia(
      {
        scope: props.request.scope,
        ...(props.request.compositionId
          ? { compositionId: props.request.compositionId }
          : {}),
        rightsDeclarations: props.request.rightsDeclarations,
        projectId: props.request.projectId,
        planId: reviewed.baseline.id,
        baseRevision: reviewed.baseline.revision,
        delivery: {
          version: 1,
          mode: mode.value,
          handlesSeconds: handles.value,
        },
        coverageId: reviewed.coverageId,
        acceptDelivery: true,
        format: format.value,
      },
      current.signal,
    );
    if (
      current.signal.aborted ||
      controller !== current ||
      generation !== owner ||
      signature.value !== inputSignature ||
      response.result.projectId !== props.request.projectId
    )
      return;
    accepted.value = false;
    emit("created", response.result);
  } catch (cause) {
    if (
      !current.signal.aborted &&
      controller === current &&
      generation === owner
    ) {
      error.value = localizeError(cause);
      accepted.value = false;
      reviewState.value = undefined;
    }
  } finally {
    if (controller === current && generation === owner) {
      controller = undefined;
      busy.value = false;
      creating.value = false;
      emit("busy", false);
    }
  }
}
watch(signature, reset, { flush: "sync" });
onBeforeUnmount(reset);
</script>
<template>
  <details class="collect-delivery">
    <summary>{{ t("collectDelivery.heading") }}</summary>
    <div class="collect-delivery-body">
      <p>{{ t("collectDelivery.description") }}</p>
      <p class="collect-delivery-disclosure">
        {{ t("collectDelivery.planningOnly") }}
      </p>
      <form class="collect-delivery-controls" @submit.prevent="review">
        <div class="field">
          <label :for="`${uid}-mode`">{{ t("collectDelivery.mode") }}</label>
          <select
            :id="`${uid}-mode`"
            v-model="mode"
            :disabled="disabled || busy"
          >
            <option value="originals">
              {{ t("collectDelivery.originals") }}
            </option>
            <option value="trimmed-originals">
              {{ t("collectDelivery.trimmed") }}
            </option>
            <option value="offline-proxies">
              {{ t("collectDelivery.offline") }}
            </option>
          </select>
        </div>
        <div class="field">
          <label :for="`${uid}-handles`">{{
            t("collectDelivery.handles")
          }}</label>
          <input
            :id="`${uid}-handles`"
            v-model.number="handles"
            type="number"
            min="0"
            max="10"
            step="0.01"
            required
            :disabled="disabled || busy || mode !== 'trimmed-originals'"
          />
        </div>
        <div class="field">
          <label :for="`${uid}-format`">{{
            t("collectDelivery.format")
          }}</label>
          <select
            :id="`${uid}-format`"
            v-model="format"
            :disabled="disabled || busy"
          >
            <option value="zip">ZIP</option>
            <option value="directory">
              {{ t("collectDelivery.directory") }}
            </option>
          </select>
        </div>
        <button type="submit" class="secondary" :disabled="disabled || busy">
          {{ t("collectDelivery.review") }}
        </button>
        <button v-if="busy" type="button" class="secondary" @click="reset">
          {{ t("collectDelivery.cancel") }}
        </button>
      </form>
      <p v-if="busy" role="status">
        {{
          t(
            creating
              ? "collectDelivery.validating"
              : "collectDelivery.preparing",
          )
        }}
      </p>
      <p v-if="error" role="alert">{{ error }}</p>
      <section v-if="reviewState" :aria-label="t('collectDelivery.results')">
        <h3>{{ t("collectDelivery.results") }}</h3>
        <p>
          {{ t(`collectDelivery.quality.${reviewState.coverage.quality}`) }}
        </p>
        <label class="collect-delivery-accept">
          <input
            type="checkbox"
            :checked="accepted"
            :disabled="disabled || busy || !reviewState.baseline.complete"
            @change="accepted = ($event.target as HTMLInputElement).checked"
          />
          {{
            t(
              mode === "offline-proxies"
                ? "collectDelivery.acceptOffline"
                : mode === "originals"
                  ? "collectDelivery.acceptOriginals"
                  : "collectDelivery.acceptLossless",
            )
          }}
        </label>
        <p v-if="!reviewState.baseline.complete" role="status">
          {{ t("collectDelivery.rightsFirst") }}
        </p>
        <button
          type="button"
          class="primary"
          :disabled="
            disabled || busy || !accepted || !reviewState.baseline.complete
          "
          @click="createPackage"
        >
          {{ t("collectDelivery.create") }}
        </button>
        <ul class="collect-delivery-sources">
          <li v-for="entry in entries" :key="entry.assetId">
            <strong>{{
              names.get(`asset:${entry.assetId}`) ?? entry.assetId
            }}</strong>
            <span>{{ t(`collectDelivery.actions.${entry.action}`) }}</span>
            <p v-if="entry.ranges.length">
              {{ t("collectDelivery.ranges") }}
              {{
                entry.ranges
                  .map((range) =>
                    t("collectDelivery.window", {
                      start: seconds(range.start),
                      end: seconds(range.end),
                    }),
                  )
                  .join(" · ")
              }}
            </p>
            <p
              v-if="
                entry.retainedSeconds !== undefined &&
                entry.removedSeconds !== undefined
              "
            >
              {{
                t("collectDelivery.duration", {
                  retained: seconds(entry.retainedSeconds),
                  removed: seconds(entry.removedSeconds),
                })
              }}
            </p>
            <p v-for="reason in entry.reasons" :key="reason" class="muted">
              {{ t(`collectDelivery.reasons.${reasons[reason]}`) }}
            </p>
          </li>
        </ul>
        <nav
          v-if="reviewState.coverage.entries.length > 50"
          :aria-label="t('collectDelivery.pages')"
        >
          <button
            type="button"
            class="secondary"
            :disabled="!offset"
            @click="offset -= 50"
          >
            {{ t("collectDelivery.previous") }}</button
          ><span>{{
            t("collectDelivery.pageCount", {
              first: offset + 1,
              last: offset + entries.length,
              total: reviewState.coverage.entries.length,
            })
          }}</span
          ><button
            type="button"
            class="secondary"
            :disabled="offset + 50 >= reviewState.coverage.entries.length"
            @click="offset += 50"
          >
            {{ t("collectDelivery.next") }}
          </button>
        </nav>
      </section>
    </div>
  </details>
</template>
