import { existsSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import {
  flatten,
  loadComponent,
  mountComponent,
  vue,
} from "./helpers/vue-sfc-host";

const path = "apps/desktop/src/components/EditDecisionRibbon.vue";
const labels: Record<string, string> = {
  "cutDesk.ribbon.label": "Edit decision",
  "cutDesk.ribbon.sequence": "Sequence",
  "cutDesk.ribbon.beat": "Beat",
  "cutDesk.ribbon.clip": "Clip",
  "cutDesk.ribbon.source": "Source",
  "cutDesk.ribbon.sequenceTimecode": "Sequence TC",
  "cutDesk.ribbon.sequenceInTimecode": "Sequence in",
  "cutDesk.ribbon.sourceTimecode": "Source TC",
  "cutDesk.ribbon.protection": "Protection",
  "cutDesk.ribbon.clipAndSourceLocked": "Clip and source locked",
  "cutDesk.ribbon.snapping": "Snapping",
  "cutDesk.ribbon.snapOn": "On",
  "cutDesk.ribbon.action": "Action",
  "cutDesk.record": "Record",
  "cutDesk.playing": "Playing",
};
function text(node: { text: string; children: unknown[] }): string {
  return (
    node.text +
    node.children
      .map((child) => text(child as { text: string; children: unknown[] }))
      .join("")
  );
}

function component() {
  expect(existsSync(path), "Edit Decision Ribbon exists").toBe(true);
  return loadComponent(path, {
    "vue-i18n": {
      useI18n: () => ({ t: (key: string) => labels[key] ?? key }),
    },
  });
}

afterEach(() => vi.restoreAllMocks());

it("connects story context, both clocks, protection, snapping and action without another timeline", () => {
  const mounted = mountComponent(
    component(),
    vue.reactive({
      sequence: "Our memories",
      beat: "Turning point",
      clip: "Arrival",
      source: "arrival.mov",
      target: "record",
      transportStatus: "playing",
      sequenceTimecode: "00:00:12:04",
      sourceTimecode: "00:01:07:18",
      clipLocked: true,
      sourceLocked: true,
      snapState: "on",
      action: "Saved",
    }),
  );
  const nodes = flatten(mounted.root);
  const ribbon = nodes.find(
    (node) => node.props["data-testid"] === "edit-decision-ribbon",
  );
  const context = nodes
    .filter((node) => node.props["data-ribbon-scope"])
    .map((node) => [node.props["data-ribbon-scope"], text(node)]);

  expect(ribbon?.props["aria-label"]).toBe("Edit decision");
  expect(context).toEqual([
    ["sequence", "SequenceOur memories"],
    ["beat", "BeatTurning point"],
    ["clip", "ClipArrival"],
    ["source", "Sourcearrival.mov"],
  ]);
  expect(
    text(
      nodes.find(
        (node) => node.props["data-testid"] === "cut-desk-target-status",
      )!,
    ),
  ).toBe("Record · Playing");
  expect(text(ribbon!)).toContain("Sequence TC00:00:12:04");
  expect(text(ribbon!)).toContain("Source TC00:01:07:18");
  expect(text(ribbon!)).toContain("ProtectionClip and source locked");
  expect(text(ribbon!)).toContain("SnappingOn");
  expect(text(ribbon!)).toContain("ActionSaved");
  expect(nodes.some((node) => node.props.role === "slider")).toBe(false);
  mounted.unmount();
});

it("labels Source's fixed sequence boundary as an in point instead of a moving playhead", () => {
  const mounted = mountComponent(
    component(),
    vue.reactive({
      sequence: "Our memories",
      beat: "Turning point",
      clip: "Arrival",
      source: "arrival.mov",
      target: "source",
      transportStatus: "active",
      sequenceTimecode: "00:00:12:04",
      sourceTimecode: "00:01:09:02",
      clipLocked: false,
      sourceLocked: false,
      snapState: "off",
      action: "Saved",
    }),
  );
  const ribbon = flatten(mounted.root).find(
    (node) => node.props["data-testid"] === "edit-decision-ribbon",
  );

  expect(text(ribbon!)).toContain("Sequence in00:00:12:04");
  expect(text(ribbon!)).toContain("Source TC00:01:09:02");
  expect(text(ribbon!)).not.toContain("Sequence TC00:00:12:04");
  mounted.unmount();
});
