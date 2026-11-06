<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { useData, withBase } from "vitepress";
import { siteContent, siteLocale, sitePrefix } from "./site-content";
import GardenArrow from "./GardenArrow.vue";
const { lang } = useData();
const locale = computed(() => siteLocale(lang.value));
const copy = computed(() => siteContent[locale.value]);
const prefix = computed(() => sitePrefix(locale.value));
const link = (slug: string) => withBase(`${prefix.value}${slug}`);
const image = (name: string) => withBase(`/images/${name}`);
const filmPlayer = ref<HTMLVideoElement>();
const filmRequested = ref(false);
const filmUnavailable = ref(false);
async function playFilm() {
  filmRequested.value = true;
  await nextTick();
  const player = filmPlayer.value;
  if (!player) return;
  player.focus();
  try {
    await player.play();
  } catch {
    filmUnavailable.value = !!player.error;
  }
}
const legacy = computed(() =>
  locale.value === "zh-TW"
    ? [
        "目前可用的版本",
        "選擇你的起點",
        "使用指南",
        "使用範圍與限制",
        "開發、證據與社群",
      ]
    : locale.value === "ja-JP"
      ? [
          "現在の提供状況",
          "目的から探す",
          "ユーザーガイド",
          "利用範囲と制限",
          "開発、検証記録、コミュニティ",
        ]
      : [
          "current-availability",
          "choose-a-starting-point",
          "user-guides",
          "scope-and-limits",
          "development-evidence-and-community",
        ],
);
const legacyIds = computed(() =>
  legacy.value.map((id) => id.normalize("NFKD")),
);
</script>

<template>
  <div class="garden-home">
    <section class="garden-hero" aria-labelledby="garden-title">
      <div class="garden-hero-copy">
        <p class="garden-eyebrow">{{ copy.eyebrow }}</p>
        <h1 id="garden-title">
          <span>{{ copy.title[0] }}</span
          ><span>{{ copy.title[1] }}</span>
        </h1>
        <p class="garden-lead">{{ copy.description }}</p>
        <div class="garden-actions">
          <a class="garden-button primary" :href="link('getting-started')"
            >{{ copy.start }}<GardenArrow
          /></a>
          <a class="garden-text-link" href="#the-path"
            >{{ copy.explore }}<GardenArrow down
          /></a>
        </div>
        <div :id="legacyIds[0]" class="garden-availability">
          <strong>{{ copy.availability }}</strong>
          <p>{{ copy.sourceNotice }}</p>
        </div>
      </div>
      <div class="garden-hero-visual">
        <figure class="garden-product-hero" data-stone="entry">
          <img
            :src="image('product-edit.webp')"
            width="1440"
            height="900"
            fetchpriority="high"
            :alt="copy.panels[2]![0]"
          />
          <figcaption>{{ copy.screenshot }}</figcaption>
        </figure>
        <figure class="garden-arrival">
          <img
            :src="image('garden-path.webp')"
            :srcset="`${image('garden-path-small.webp')} 640w, ${image('garden-path.webp')} 1280w`"
            sizes="(max-width: 680px) 80vw, 360px"
            width="1280"
            height="720"
            alt=""
          />
          <figcaption>
            <span aria-hidden="true">01 — 05</span
            ><a href="#the-path">{{ copy.pathTitle }}</a>
          </figcaption>
        </figure>
      </div>
    </section>

    <section
      id="the-path"
      class="garden-path"
      aria-labelledby="garden-path-title"
    >
      <span :id="legacyIds[1]" class="legacy-anchor" />
      <header class="garden-section-heading">
        <p class="garden-eyebrow">01 — {{ copy.workflow }}</p>
        <h2 id="garden-path-title">{{ copy.pathTitle }}</h2>
        <p>{{ copy.pathDescription }}</p>
      </header>
      <ol class="garden-steps">
        <li
          v-for="(step, index) in copy.steps"
          :key="step[2]"
          data-stone="task"
        >
          <a :href="link(`product-workflow#${step[2]}`)"
            ><span class="garden-step-number">{{
              String(index + 1).padStart(2, "0")
            }}</span>
            <h3>{{ step[0] }}</h3>
            <p>{{ step[1] }}</p>
            <GardenArrow class="garden-step-arrow"
          /></a>
        </li>
      </ol>
    </section>

    <section class="garden-product" aria-labelledby="garden-product-title">
      <span :id="legacyIds[2]" class="legacy-anchor" />
      <header class="garden-section-heading">
        <p class="garden-eyebrow">02 — OpenFilm</p>
        <h2 id="garden-product-title">{{ copy.productTitle }}</h2>
        <p>{{ copy.productIntro }}</p>
      </header>
      <article
        v-for="(panel, index) in copy.panels"
        :key="panel[2]"
        class="garden-product-row"
        :class="{ reverse: index === 1 }"
      >
        <div class="garden-product-copy">
          <span class="garden-step-number">{{
            String(index + 1).padStart(2, "0")
          }}</span>
          <h3>{{ panel[0] }}</h3>
          <p>{{ panel[1] }}</p>
          <a class="garden-text-link" :href="link('product-workflow')"
            >{{ copy.workflow }}<GardenArrow
          /></a>
        </div>
        <figure data-stone="anchor">
          <img
            :src="image(`product-${panel[2]}.webp`)"
            width="1440"
            height="900"
            loading="lazy"
            :alt="panel[0]"
          />
          <figcaption>{{ copy.screenshot }}</figcaption>
        </figure>
      </article>
    </section>

    <section
      class="garden-example"
      data-stone="entry"
      aria-labelledby="garden-example-title"
    >
      <div>
        <p class="garden-eyebrow">03 — MP4</p>
        <h2 id="garden-example-title">{{ copy.exampleTitle }}</h2>
        <p>{{ copy.exampleDescription }}</p>
      </div>
      <div class="garden-film-player">
        <button
          v-if="!filmRequested"
          type="button"
          class="garden-film-start"
          @click="playFilm"
        >
          <img
            :src="image('garden-courtyard.webp')"
            width="1280"
            height="720"
            alt=""
            loading="lazy"
          />
          <span
            ><svg
              width="18"
              height="18"
              viewBox="0 0 18 18"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              aria-hidden="true"
            >
              <path d="M5 3 15 9 5 15Z" /></svg
            >{{ copy.exampleLabel }}</span
          >
        </button>
        <video
          v-else
          ref="filmPlayer"
          controls
          preload="metadata"
          :poster="image('garden-courtyard.webp')"
          :src="withBase('/media/garden-film.mp4')"
          :aria-label="copy.exampleLabel"
          width="1280"
          height="720"
          playsinline
          @error="filmUnavailable = true"
        >
          <track
            kind="captions"
            :src="withBase(`/media/garden-film-${locale}.vtt`)"
            :srclang="locale"
            :label="locale"
          />
        </video>
        <p v-if="filmUnavailable" class="garden-film-error" role="status">
          {{ copy.exampleUnavailable }}
          <a :href="link('product-workflow')">{{ copy.explore }}</a>
        </p>
      </div>
    </section>

    <section class="garden-values" :aria-label="copy.eyebrow">
      <span :id="legacyIds[3]" class="legacy-anchor" />
      <article v-for="(value, index) in copy.values" :key="value[0]">
        <span class="garden-step-number">{{
          String(index + 1).padStart(2, "0")
        }}</span>
        <h2>{{ value[0] }}</h2>
        <p>{{ value[1] }}</p>
      </article>
    </section>

    <section class="garden-ending" aria-labelledby="garden-ending-title">
      <span :id="legacyIds[4]" class="legacy-anchor" />
      <figure class="garden-courtyard">
        <img
          :src="image('garden-courtyard.webp')"
          :srcset="`${image('garden-courtyard-small.webp')} 640w, ${image('garden-courtyard.webp')} 1280w`"
          sizes="(max-width: 680px) 100vw, 50vw"
          width="1280"
          height="720"
          loading="lazy"
          alt=""
        />
      </figure>
      <div>
        <p class="garden-eyebrow">OpenFilm</p>
        <h2 id="garden-ending-title">{{ copy.ending }}</h2>
        <p>{{ copy.endingDescription }}</p>
        <a class="garden-button primary" :href="link('getting-started')"
          >{{ copy.start }}<GardenArrow
        /></a>
      </div>
    </section>
  </div>
</template>
