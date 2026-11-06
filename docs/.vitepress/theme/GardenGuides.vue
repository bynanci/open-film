<script setup lang="ts">
import { computed } from "vue";
import { useData, withBase } from "vitepress";
import { siteContent, siteLocale, sitePrefix } from "./site-content";
const { lang } = useData();
const locale = computed(() => siteLocale(lang.value));
const copy = computed(() => siteContent[locale.value]);
const groups = [
  [
    ["getting-started", "Getting started", "開始使用", "スタートガイド"],
    ["product-workflow", "Film-making workflow", "製作流程", "映画制作の流れ"],
  ],
  [
    ["source-support", "Camera sources", "相機與來源支援", "カメラソース"],
    [
      "media-portability",
      "Media portability",
      "媒體可攜與重新連結",
      "素材の移動と再リンク",
    ],
  ],
  [
    [
      "creative-story-templates",
      "Story templates",
      "故事模板",
      "ストーリーテンプレート",
    ],
    [
      "en/scene-script-planning",
      "Scene & script planning",
      "場景與腳本規劃",
      "シーンと脚本の計画",
    ],
  ],
  [
    ["precision-editing", "Precision editing", "精準剪輯", "精密編集"],
    [
      "markers-and-snapping",
      "Markers and snapping",
      "標記與吸附",
      "マーカーとスナップ",
    ],
    ["audio-quality", "Audio quality", "音訊品質", "音声品質"],
  ],
  [
    [
      "export-quality",
      "MP4 export quality",
      "MP4 輸出品質",
      "MP4 書き出し品質",
    ],
    ["collect-media", "Collect Media", "素材可攜套件", "Collect Media"],
    ["en/nle-compatibility", "NLE compatibility", "NLE 相容性", "NLE 互換性"],
  ],
  [
    [
      "media-portability",
      "Find missing media",
      "找回離線素材",
      "オフライン素材を探す",
    ],
    [
      "en/media-analysis-recovery",
      "Analysis recovery",
      "分析工作復原",
      "解析の復旧",
    ],
  ],
  [
    ["en/architecture", "Architecture", "系統架構", "アーキテクチャ"],
    [
      "en/licensing",
      "License and permissions",
      "授權與使用範圍",
      "ライセンスと利用範囲",
    ],
  ],
];
const labelIndex = computed(() =>
  locale.value === "zh-TW" ? 2 : locale.value === "ja-JP" ? 3 : 1,
);
function link(slug: string) {
  return withBase(
    slug.startsWith("en/") ? `/${slug}` : `${sitePrefix(locale.value)}${slug}`,
  );
}
</script>
<template>
  <div class="garden-guide-hub">
    <p class="garden-guide-intro">{{ copy.guideIntro }}</p>
    <div class="garden-guide-groups">
      <section v-for="(group, index) in groups" :key="index" data-stone="task">
        <span class="garden-step-number">{{
          String(index + 1).padStart(2, "0")
        }}</span>
        <h2>{{ copy.guideGroups[index]![0] }}</h2>
        <p>{{ copy.guideGroups[index]![1] }}</p>
        <ul>
          <li v-for="item in group" :key="item[0]">
            <a :href="link(item[0]!)"
              >{{ item[labelIndex]
              }}<small
                v-if="item[0]!.startsWith('en/') && locale !== 'en-US'"
                >{{ copy.englishReference }}</small
              ><span aria-hidden="true">↗</span></a
            >
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>
