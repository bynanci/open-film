<script setup lang="ts">
import { useI18n } from "vue-i18n";

const { t } = useI18n();
</script>

<template>
  <div class="workspace-loading" role="status" aria-live="polite">
    {{ t("app.actions.working") }}
  </div>
</template>

<style scoped>
.workspace-loading {
  display: grid;
  min-height: 4rem;
  place-items: center;
}
</style>
