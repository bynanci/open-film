<script setup lang="ts">
import { computed, onMounted, onUnmounted } from "vue";
import DefaultTheme, { useSidebar } from "vitepress/theme-without-fonts";
import { useData, withBase } from "vitepress";
import { startGardenLighting } from "../../../design/garden-lighting";
import GardenHome from "./GardenHome.vue";
import GardenGuides from "./GardenGuides.vue";
import GardenSidebarItem from "./GardenSidebarItem.vue";
import { siteContent, siteLocale, sitePrefix } from "./site-content";
import { startSearchFocus } from "./search-focus";
const { frontmatter, lang, page } = useData();
const { sidebarGroups } = useSidebar();
const locale = computed(() => siteLocale(lang.value));
const copy = computed(() => siteContent[locale.value]);
const journey = computed(() =>
  page.value.relativePath.endsWith("getting-started.md")
    ? copy.value.setupSteps
    : page.value.relativePath.endsWith("product-workflow.md")
      ? copy.value.steps.map(([title, , hash]) => [title, hash])
      : [],
);
let stopLighting: (() => void) | undefined;
let stopSearchFocus: (() => void) | undefined;
onMounted(() => {
  stopLighting = startGardenLighting();
  stopSearchFocus = startSearchFocus();
});
onUnmounted(() => {
  stopLighting?.();
  stopSearchFocus?.();
});
</script>
<template>
  <DefaultTheme.Layout
    :class="{ 'garden-hub-layout': frontmatter.gardenGuides }"
  >
    <template #home-hero-before
      ><GardenHome v-if="frontmatter.gardenHome"
    /></template>
    <template #sidebar-nav-before>
      <ul class="garden-sidebar">
        <GardenSidebarItem
          v-for="group in sidebarGroups"
          :key="group.text"
          :item="group"
        />
      </ul>
    </template>
    <template #doc-before>
      <nav
        v-if="journey.length"
        class="garden-article-path"
        :aria-label="copy.workflow"
      >
        <a v-for="(step, index) in journey" :key="step[1]" :href="`#${step[1]}`"
          ><span>{{ String(index + 1).padStart(2, "0") }}</span
          >{{ step[0] }}</a
        >
      </nav>
    </template>
    <template #doc-after
      ><GardenGuides v-if="frontmatter.gardenGuides"
    /></template>
    <template #layout-bottom>
      <footer class="garden-site-footer">
        <a class="garden-footer-brand" :href="withBase(sitePrefix(locale))"
          >OpenFilm</a
        >
        <p>{{ copy.eyebrow }}</p>
        <nav :aria-label="copy.community">
          <a :href="withBase(`${sitePrefix(locale)}guides`)">{{
            copy.guides
          }}</a
          ><a href="https://github.com/bynanci/open-film">{{ copy.source }}</a
          ><a href="https://github.com/bynanci/open-film/discussions">{{
            copy.community
          }}</a
          ><a :href="withBase('/en/website-assets')">{{ copy.gardenCredit }}</a>
        </nav>
      </footer>
    </template>
  </DefaultTheme.Layout>
</template>
