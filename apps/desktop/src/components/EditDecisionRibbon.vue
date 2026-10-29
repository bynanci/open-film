<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";

const props = defineProps<{
  sequence: string;
  beat?: string;
  clip?: string;
  source?: string;
  target: "record" | "source";
  transportStatus: "active" | "playing" | "paused";
  sequenceTimecode: string;
  sourceTimecode: string;
  clipLocked: boolean;
  sourceLocked: boolean;
  snapState: "on" | "off" | "unavailable";
  action: string;
}>();
const { t } = useI18n();
const scopes = computed(() => [
  { id: "sequence", value: props.sequence },
  { id: "beat", value: props.beat },
  { id: "clip", value: props.clip },
  { id: "source", value: props.source },
]);
const protection = computed(() =>
  props.clipLocked && props.sourceLocked
    ? "clipAndSourceLocked"
    : props.clipLocked
      ? "clipLocked"
      : props.sourceLocked
        ? "sourceLocked"
        : "unlocked",
);
</script>

<template>
  <section
    class="cut-desk-target-bar edit-decision-ribbon"
    :aria-label="t('cutDesk.ribbon.label')"
    data-testid="edit-decision-ribbon"
  >
    <ol class="edit-decision-context">
      <li
        v-for="scope in scopes"
        :key="scope.id"
        class="edit-decision-scope"
        :data-ribbon-scope="scope.id"
      >
        <span>{{ t(`cutDesk.ribbon.${scope.id}`) }}</span>
        <strong :title="scope.value || t('cutDesk.ribbon.unassigned')">
          {{ scope.value || t("cutDesk.ribbon.unassigned") }}
        </strong>
      </li>
    </ol>

    <div class="edit-decision-state">
      <p data-testid="cut-desk-target-status" role="status" aria-live="polite">
        {{ t(`cutDesk.${target}`) }} · {{ t(`cutDesk.${transportStatus}`) }}
      </p>
      <dl class="edit-decision-metadata">
        <div>
          <dt>
            {{
              t(
                target === "record"
                  ? "cutDesk.ribbon.sequenceTimecode"
                  : "cutDesk.ribbon.sequenceInTimecode",
              )
            }}
          </dt>
          <dd>{{ sequenceTimecode }}</dd>
        </div>
        <div>
          <dt>{{ t("cutDesk.ribbon.sourceTimecode") }}</dt>
          <dd>{{ sourceTimecode }}</dd>
        </div>
        <div>
          <dt>{{ t("cutDesk.ribbon.protection") }}</dt>
          <dd>{{ t(`cutDesk.ribbon.${protection}`) }}</dd>
        </div>
        <div>
          <dt>{{ t("cutDesk.ribbon.snapping") }}</dt>
          <dd>
            {{
              t(
                `cutDesk.ribbon.snap${
                  snapState === "unavailable"
                    ? "Unavailable"
                    : snapState === "on"
                      ? "On"
                      : "Off"
                }`,
              )
            }}
          </dd>
        </div>
        <div>
          <dt>{{ t("cutDesk.ribbon.action") }}</dt>
          <dd>{{ action }}</dd>
        </div>
      </dl>
    </div>

    <div class="edit-decision-controls">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.edit-decision-ribbon {
  display: grid;
  grid-template-columns: minmax(280px, 1.2fr) minmax(360px, 1fr) auto;
  align-items: center;
  gap: var(--of-space-3) var(--of-space-5);
}
.edit-decision-context {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  min-width: 0;
  margin: 0;
  padding: 0;
  list-style: none;
}
.edit-decision-scope {
  position: relative;
  min-width: 0;
  padding-inline: var(--of-space-3);
}
.edit-decision-scope:first-child {
  padding-inline-start: 0;
}
.edit-decision-scope + .edit-decision-scope::before {
  position: absolute;
  inset-inline-start: -0.25ch;
  top: 50%;
  color: var(--editor-muted);
  content: "›";
  transform: translateY(-50%);
}
.edit-decision-scope span,
.edit-decision-metadata dt {
  display: block;
  color: var(--editor-muted);
  font-size: var(--of-font-caption);
  line-height: 1.2;
}
.edit-decision-scope strong {
  display: block;
  margin-top: 2px;
  overflow: hidden;
  color: var(--editor-text);
  font-weight: 600;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.edit-decision-state {
  min-width: 0;
}
.edit-decision-state > p {
  color: var(--editor-accent);
  font-weight: 600;
}
.edit-decision-metadata {
  display: flex;
  flex-wrap: wrap;
  gap: var(--of-space-2) var(--of-space-4);
  margin: var(--of-space-1) 0 0;
}
.edit-decision-metadata div {
  min-width: 0;
}
.edit-decision-metadata dd {
  margin: 1px 0 0;
  color: var(--editor-text);
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
.edit-decision-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: var(--of-space-2);
  min-width: 0;
}
@media (max-width: 1100px) {
  .edit-decision-ribbon {
    grid-template-columns: minmax(0, 1fr) auto;
  }
  .edit-decision-state {
    grid-column: 1 / -1;
    grid-row: 2;
  }
}
@media (max-width: 780px) {
  .edit-decision-ribbon {
    grid-template-columns: minmax(0, 1fr);
  }
  .edit-decision-context {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    row-gap: var(--of-space-2);
  }
  .edit-decision-scope:nth-child(3) {
    padding-inline-start: 0;
  }
  .edit-decision-scope:nth-child(3)::before {
    content: none;
  }
  .edit-decision-state,
  .edit-decision-controls {
    grid-column: auto;
    grid-row: auto;
  }
  .edit-decision-controls {
    justify-content: flex-start;
  }
}
</style>
