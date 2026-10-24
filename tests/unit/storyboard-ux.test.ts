import { expect, it, vi } from "vitest";
import type { Composition, MediaAsset, Story } from "@openfilm/core";
import { beatTimelineDuration } from "../../apps/desktop/src/duration";
import {
  flatten,
  loadComponent,
  mountComponent,
  vue,
} from "./helpers/vue-sfc-host";

const story: Story = {
  id: "story",
  title: "A local story",
  targetDuration: 15,
  beats: [
    {
      id: "beat",
      title: "A moment",
      targetDuration: 15,
      selectedAssetIds: ["photo"],
    },
  ],
};
const photo: MediaAsset = {
  id: "photo",
  name: "Synthetic.png",
  uri: "file:///Synthetic.png",
  mediaType: "image",
  tags: [],
  state: {},
  metadata: {},
};
const composition: Composition = {
  id: "cut",
  storyId: "story",
  duration: 15,
  tracks: [
    {
      id: "v",
      type: "video",
      clips: [
        {
          id: "c1",
          assetId: "photo",
          beatId: "beat",
          timelineStart: 0,
          timelineDuration: 10,
          sourceIn: 0,
          sourceOut: 10,
        },
      ],
    },
    {
      id: "a",
      type: "audio",
      clips: [
        {
          id: "c2",
          assetId: "audio",
          beatId: "beat",
          timelineStart: 5,
          timelineDuration: 10,
          sourceIn: 0,
          sourceOut: 10,
        },
      ],
    },
  ],
};
const dependencies = {
  "vue-i18n": {
    useI18n: () => ({
      t: (key: string, params?: Record<string, unknown>) =>
        params?.duration ? `${key}:${params.duration}` : key,
    }),
  },
  "../duration": { beatTimelineDuration, durationStatus: () => "ideal" },
  "../i18n": {
    formatDuration: (n: number) => `${n}s`,
    formatNumber: (n: number) => `${n}`,
  },
  "../api": {
    sourceUrl: (id: string) => `/api/assets/${id}/source`,
    thumbnailUrl: (id: string) => `/api/assets/${id}/thumbnail`,
  },
  "./Icon.vue": {
    props: ["name", "size"],
    template: '<span class="icon"></span>',
  },
};
const component = () =>
  loadComponent("apps/desktop/src/components/StoryboardView.vue", dependencies);

it("measures covered timeline time once when video and audio overlap", async () => {
  const mounted = mountComponent(component(), {
    story,
    assets: [photo],
    composition,
  });
  try {
    await vue.nextTick();
    const actual = flatten(mounted.root).find(
      (n) => n.props.class === "timing-actual",
    );
    expect(actual?.text.trim()).toBe("app.story.actual:15s");
  } finally {
    mounted.unmount();
  }
});

it("does not present another story's active cut as this storyboard's mapping", async () => {
  const mounted = mountComponent(component(), {
    story,
    assets: [photo],
    composition: { ...composition, storyId: "other" },
  });
  try {
    await vue.nextTick();
    expect(
      flatten(mounted.root).filter(
        (n) => n.props["data-testid"] === "mapping-pill-mapped",
      ),
    ).toHaveLength(0);
  } finally {
    mounted.unmount();
  }
});

it("leaves Enter and Space on nested controls to their native actions", async () => {
  const selected = vi.fn();
  const mounted = mountComponent(component(), {
    story,
    assets: [photo],
    "onSelect-beat": selected,
  });
  try {
    await vue.nextTick();
    const card = flatten(mounted.root).find(
      (n) => n.props["data-testid"] === "storyboard-card-beat",
    )!;
    const preventDefault = vi.fn();
    const keydown = card.props.onKeydown as (event: object) => void;
    keydown({
      key: "Enter",
      target: { tagName: "BUTTON" },
      currentTarget: card,
      preventDefault,
    });
    keydown({
      key: " ",
      target: { tagName: "VIDEO" },
      currentTarget: card,
      preventDefault,
    });
    expect(selected).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
  } finally {
    mounted.unmount();
  }
});

it("keeps offline source preview controls disabled", async () => {
  const mounted = mountComponent(component(), {
    story,
    assets: [photo],
    activeBeatId: "beat",
    mediaStatuses: { photo: { status: "missing" } },
  });
  try {
    await vue.nextTick();
    const button = flatten(mounted.root).find(
      (n) => n.props["data-testid"] === "storyboard-preview-photo",
    );
    expect(button?.tag).toBe("button");
    expect(button?.props.disabled).toBe(true);
  } finally {
    mounted.unmount();
  }
});
