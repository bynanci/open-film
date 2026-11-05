import { afterEach, expect, it, vi } from "vitest";
import {
  flatten,
  hostNode,
  loadComponent,
  mountComponent,
  vue,
} from "./helpers/vue-sfc-host";

function text(node: ReturnType<typeof hostNode>): string {
  return (
    node.text +
    node.children
      .map((child) => text(child as ReturnType<typeof hostNode>))
      .join("")
  );
}
async function settle() {
  for (let i = 0; i < 16; i++) {
    await Promise.resolve();
    await vue.nextTick();
  }
}
afterEach(() => vi.unstubAllGlobals());
function fixture(prepare?: (...args: unknown[]) => Promise<unknown>) {
  const play = vi.fn(async () => {}),
    dispose = vi.fn(),
    load = vi.fn(),
    close = vi.fn(async () => {});
  vi.stubGlobal(
    "AudioContext",
    class {
      close = close;
    },
  );
  const descriptor = {
    version: 1,
    id: "12345678-1234-1234-1234-123456789abc",
    revision: "r1",
    sourceKeyDigest: "a".repeat(64),
    sampleRate: 48000,
    channels: 2,
    format: "pcm_s24le",
    lengthSamples: 192000,
  };
  const response = (input: unknown) => {
    const body = input as { requestId: string };
    return {
      version: 1,
      reviewId: "review-1",
      requestId: body.requestId,
      baseRevision: "r1",
      before: descriptor,
      after: descriptor,
      seams: [
        {
          beforeStartSample: 24000,
          beforeEndSample: 120000,
          afterStartSample: 24000,
          afterEndSample: 72000,
          removedStartSample: 48000,
          removedEndSample: 96000,
        },
      ],
      removedSamples: 48000,
      parity: "renderer",
    };
  };
  const silenceAudition = vi.fn(
    prepare ?? (async (_job: unknown, input: unknown) => response(input)),
  );
  const component = loadComponent(
    "apps/desktop/src/components/SilenceAuditionControls.vue",
    {
      "vue-i18n": { useI18n: () => ({ t: (key: string) => key }) },
      "../api": { api: { silenceAudition, recordAudioPcm: vi.fn() } },
      "../i18n": { localizeError: () => "audition error" },
      "../recordAudioPlayback": {
        createRecordAudioPlayback: () => ({ play, dispose, load }),
      },
    },
  );
  const props = vue.reactive({
    projectId: "p1",
    compositionId: "c1",
    revision: "r1",
    jobId: "j1",
    reviewId: "review-1",
    proposal: {} as never,
    disabled: false,
    active: true,
  });
  const mounted = mountComponent(component, props);
  const button = (key: string) =>
    flatten(mounted.root).find(
      (node) =>
        node.tag === "button" &&
        text(node).includes("precision.silence.audition." + key),
    )!;
  const click = async (key: string) => {
    (button(key).props.onClick as () => unknown)();
    await settle();
  };
  return {
    response,
    props,
    mounted,
    button,
    click,
    silenceAudition,
    play,
    dispose,
    load,
    close,
  };
}
it("plays both rendered seam windows through existing PCM playback and retires playback on revision changes", async () => {
  const f = fixture();
  try {
    await f.click("prepare");
    expect(f.silenceAudition).toHaveBeenCalledTimes(1);
    await f.click("before");
    expect(f.play).toHaveBeenLastCalledWith(24000, 120000);
    await f.click("after");
    expect(f.play).toHaveBeenLastCalledWith(24000, 72000);
    expect(f.dispose).toHaveBeenCalled();
    f.props.revision = "r2";
    await settle();
    expect(f.close).toHaveBeenCalled();
    expect(f.button("after")).toBeUndefined();
  } finally {
    f.mounted.unmount();
  }
});
it.each(["projectId", "compositionId"] as const)(
  "fences cancelled or previous %s responses and preserves retry identity",
  async (contextKey) => {
    let finish: (value: unknown) => void = () => {};
    const f = fixture(
      async () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    try {
      await f.click("prepare");
      const signal = f.silenceAudition.mock.calls[0]![2] as AbortSignal;
      Object.assign(f.button("prepare"), { focus: vi.fn() });
      await f.click("cancel");
      expect(signal.aborted).toBe(true);
      finish(f.response(f.silenceAudition.mock.calls[0]![1]));
      await settle();
      expect(f.button("after")).toBeUndefined();
      expect(f.button("retry")).toBeUndefined();
      await f.click("prepare");
      expect(f.silenceAudition.mock.calls[1]![1]).toEqual(
        f.silenceAudition.mock.calls[0]![1],
      );
      const secondSignal = f.silenceAudition.mock.calls[1]![2] as AbortSignal;
      f.props[contextKey] = "different-context";
      await settle();
      expect(secondSignal.aborted).toBe(true);
      finish(f.response(f.silenceAudition.mock.calls[1]![1]));
      await settle();
      expect(f.button("after")).toBeUndefined();
      expect(f.button("retry")).toBeUndefined();
    } finally {
      f.mounted.unmount();
    }
  },
);
it("blocks rendering for staged candidate edits and rejects an unbound renderer response", async () => {
  const f = fixture(async () => ({ parity: "preview-only" }));
  try {
    f.props.disabled = true;
    await settle();
    await f.click("prepare");
    expect(f.silenceAudition).not.toHaveBeenCalled();
    f.props.disabled = false;
    await settle();
    await f.click("prepare");
    expect(f.button("retry")).toBeDefined();
    expect(f.button("after")).toBeUndefined();
  } finally {
    f.mounted.unmount();
  }
});
it("ignores a retired playback rejection after switching before to after", async () => {
  const f = fixture();
  let reject: (error: Error) => void = () => {};
  f.play.mockImplementationOnce(
    () =>
      new Promise<void>((_resolve, rejectPromise) => {
        reject = rejectPromise;
      }),
  );
  try {
    await f.click("prepare");
    await f.click("before");
    await f.click("after");
    const disposedBefore = f.dispose.mock.calls.length;
    const closedBefore = f.close.mock.calls.length;
    reject(new Error("retired AudioContext resume rejected"));
    await settle();
    expect(f.dispose).toHaveBeenCalledTimes(disposedBefore);
    expect(f.close).toHaveBeenCalledTimes(closedBefore);
    expect(f.button("after").props["aria-pressed"]).toBe(true);
  } finally {
    f.mounted.unmount();
  }
});
it("retires rendered audio on tab deactivation and staged selection changes", async () => {
  const f = fixture();
  try {
    await f.click("prepare");
    await f.click("before");
    f.props.active = false;
    await settle();
    expect(f.button("after")).toBeUndefined();
    expect(f.dispose).toHaveBeenCalled();
    f.props.active = true;
    await settle();
    await f.click("prepare");
    await f.click("after");
    f.props.disabled = true;
    await settle();
    expect(f.button("after")).toBeUndefined();
  } finally {
    f.mounted.unmount();
  }
});
