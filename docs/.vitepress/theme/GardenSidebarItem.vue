<script setup lang="ts">
import { computed } from "vue";
import { useData, withBase } from "vitepress";
import type { DefaultTheme } from "vitepress/theme";

const props = defineProps<{ item: DefaultTheme.SidebarItem }>();
const { page } = useData();
const normalize = (path: string) =>
  path
    .split("#")[0]!
    .replace(/\.(md|html)$/u, "")
    .replace(/\/index$/u, "/");
const active = (item: DefaultTheme.SidebarItem): boolean =>
  !!item.link &&
  normalize(item.link) === normalize(`/${page.value.relativePath}`);
const containsActive = (item: DefaultTheme.SidebarItem): boolean =>
  active(item) || !!item.items?.some(containsActive);
const expanded = computed(
  () => props.item.collapsed === false || containsActive(props.item),
);
</script>
<template>
  <li>
    <details v-if="item.items?.length" :open="expanded">
      <summary>{{ item.text }}</summary>
      <ul>
        <GardenSidebarItem
          v-for="child in item.items"
          :key="child.link ?? child.text"
          :item="child"
        />
      </ul>
    </details>
    <a
      v-else-if="item.link"
      :href="withBase(item.link)"
      :target="item.target"
      :rel="item.rel"
      :aria-current="active(item) ? 'page' : undefined"
      >{{ item.text }}</a
    >
    <span v-else>{{ item.text }}</span>
  </li>
</template>
