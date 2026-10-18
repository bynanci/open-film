import { describe, expect, it } from "vitest";
import {
  createProject,
  migrateProject,
  validateProject,
  type PhotoLayout,
  type PhotoMotion,
} from "../src/index.js";
import * as core from "../src/index.js";

const digest = (character = "a") => character.repeat(64);
const layout: PhotoLayout = { version: 1, preset: "hero" };
const motion: PhotoMotion = {
  version: 1,
  preset: "push-in",
  easing: "linear",
  from: { scale: 1, x: 0, y: 0 },
  to: { scale: 1.1, x: 0, y: 0 },
};

function layoutAction() {
  return {
    id: "clip:layout",
    clipId: "clip",
    kind: "layout",
    reason: "hero",
    evidence: "Use a hero composition for this opening photograph.",
    before: null,
    after: structuredClone(layout),
    command: {
      type: "presentation",
      clipId: "clip",
      layout: structuredClone(layout),
    },
  };
}

function motionAction() {
  return {
    id: "clip:motion",
    clipId: "clip",
    kind: "motion",
    reason: "push-in",
    evidence: "Move gently toward the subject.",
    before: null,
    after: structuredClone(motion),
    command: {
      type: "presentation",
      clipId: "clip",
      motion: structuredClone(motion),
    },
  };
}

function receipt() {
  return {
    version: 1,
    planId: digest(),
    requestId: "direction-request",
    fingerprint: digest("b"),
    compositionId: "historical-composition",
    storyId: "historical-story",
    beatId: "historical-beat",
    baseRevision: digest("c"),
    contextSignature: digest("d"),
    acceptedAt: "2026-10-18T00:00:00Z",
    acceptedRevision: digest("e"),
    sourceText: "Show the photograph full frame, then move in gently.",
    actions: [layoutAction(), motionAction()],
  };
}

function projectWith<Receipts>(receipts: Receipts) {
  return {
    ...createProject("Direction receipts"),
    sceneDirectionReceipts: receipts,
  };
}

describe("durable scene direction receipts", () => {
  it("publishes the 100-receipt capacity", () => {
    expect(core).toHaveProperty("MAX_SCENE_DIRECTION_RECEIPTS", 100);
  });

  it("preserves legacy absence and historical receipts as independent copies", () => {
    const legacy = createProject("Legacy");
    expect(validateProject(legacy)).toEqual(legacy);
    expect(validateProject(legacy)).not.toHaveProperty(
      "sceneDirectionReceipts",
    );
    const value = projectWith([receipt()]);
    const restored = validateProject(value);
    expect(restored).toEqual(value);
    expect(migrateProject(value)).toEqual(value);
    expect(restored.sceneDirectionReceipts).not.toBe(
      value.sceneDirectionReceipts,
    );
    const action = restored.sceneDirectionReceipts![0]!.actions[0]!;
    if (action.kind !== "layout") throw new Error("Expected a layout receipt");
    action.after.preset = "contain";
    expect(value.sceneDirectionReceipts[0]!.actions[0]!.after.preset).toBe(
      "hero",
    );
  });

  it.each(["opaque\u0000\ud800", "id-" + "x".repeat(300)])(
    "preserves existing opaque model and action identities: %j",
    (id) => {
      const action = {
        ...layoutAction(),
        id: `${id}:layout`,
        clipId: id,
        command: { type: "presentation", clipId: id, layout },
      };
      const value = projectWith([
        {
          ...receipt(),
          compositionId: id,
          storyId: id,
          beatId: id,
          actions: [action],
        },
      ]);
      expect(validateProject(value)).toEqual(value);
    },
  );

  it("accepts bounded histories and repeated action identities across receipts", () => {
    const receipts = Array.from({ length: 100 }, (_, index) => ({
      ...receipt(),
      planId: index.toString(16).padStart(64, "0"),
      requestId: `request-${index}`,
    }));
    const value = projectWith(receipts);
    expect(validateProject(value)).toEqual(value);
    expect(validateProject(projectWith([])).sceneDirectionReceipts).toEqual([]);
  });

  it("preserves repeated plan evidence accepted through distinct requests", () => {
    const value = projectWith([
      receipt(),
      {
        ...receipt(),
        requestId: "accept-again-after-undo",
        fingerprint: digest("f"),
        acceptedAt: "2026-10-18T00:01:00Z",
      },
    ]);
    expect(validateProject(value)).toEqual(value);
    expect(migrateProject(value)).toEqual(value);
  });

  it("accepts one through 100 actions and existing presentation snapshots", () => {
    const actions = Array.from({ length: 100 }, (_, index) => ({
      ...layoutAction(),
      id: `clip-${index}:layout`,
      clipId: `clip-${index}`,
      before: {
        version: 1,
        preset: "diptych",
        secondary: { assetId: "old-image" },
      },
      command: { type: "presentation", clipId: `clip-${index}`, layout },
    }));
    const value = projectWith([{ ...receipt(), actions }]);
    expect(validateProject(value)).toEqual(value);
  });

  it("counts source and evidence limits in Unicode code points", () => {
    const action = { ...layoutAction(), evidence: "😀".repeat(8000) };
    const value = projectWith([
      { ...receipt(), sourceText: "😀".repeat(8000), actions: [action] },
    ]);
    expect(validateProject(value)).toEqual(value);
    expect(
      validateProject(
        projectWith([{ ...receipt(), requestId: "😀".repeat(128) }]),
      ),
    ).toHaveProperty("sceneDirectionReceipts");
  });

  it.each(
    [
      "planId",
      "fingerprint",
      "baseRevision",
      "contextSignature",
      "acceptedRevision",
    ].flatMap((field) =>
      ["", "a".repeat(63), "a".repeat(65), "g".repeat(64)].map((value) => ({
        field,
        value,
      })),
    ),
  )("rejects malformed digest $field: $value", ({ field, value }) => {
    expect(() =>
      validateProject(projectWith([{ ...receipt(), [field]: value }])),
    ).toThrow(field);
  });

  it.each([
    "",
    " ",
    "x".repeat(257),
    "😀".repeat(129),
    "bad\nid",
    "bad\tid",
    "bad\u0000id",
    "bad\u007fid",
    "bad\u0085id",
    "\ud800",
    "\udc00",
  ])("rejects an invalid request ID: %j", (requestId) => {
    expect(() =>
      validateProject(projectWith([{ ...receipt(), requestId }])),
    ).toThrow(/requestId/);
  });

  it.each(
    ["sourceText", "evidence"].flatMap((field) =>
      [
        "",
        " ",
        "x".repeat(8001),
        "😀".repeat(8001),
        "bad\u0000text",
        "bad\u007ftext",
        "\ud800",
        "\udc00",
      ].map((value) => ({ field, value })),
    ),
  )("rejects invalid receipt text $field: $value", ({ field, value }) => {
    const item = receipt();
    if (field === "sourceText") item.sourceText = value;
    else item.actions[0]!.evidence = value;
    expect(() => validateProject(projectWith([item]))).toThrow(field);
  });

  it.each([
    { version: 2 },
    { acceptedAt: "2026-02-30T00:00:00Z" },
    { acceptedAt: "2026-10-18" },
    { compositionId: "" },
    { storyId: " " },
    { beatId: null },
    { actions: [] },
    {
      actions: Array.from({ length: 101 }, (_, index) => ({
        ...layoutAction(),
        id: String(index),
      })),
    },
    { actions: [layoutAction(), layoutAction()] },
    { extra: true },
  ])("rejects malformed or unsupported receipt envelopes %j", (patch) => {
    expect(() =>
      validateProject(projectWith([{ ...receipt(), ...patch }])),
    ).toThrow();
  });

  it.each([
    [receipt(), receipt()],
    [receipt(), { ...receipt(), planId: digest("f") }],
  ])("rejects duplicate request identities", (...receipts) => {
    expect(() => validateProject(projectWith(receipts))).toThrow(/requestId/);
  });

  it("rejects histories over capacity", () => {
    const receipts = Array.from({ length: 101 }, (_, index) => ({
      ...receipt(),
      requestId: `request-${index}`,
    }));
    expect(() => validateProject(projectWith(receipts))).toThrow(
      /sceneDirectionReceipts/,
    );
  });

  it.each([
    { id: "" },
    { clipId: " " },
    { kind: "audio" },
    { reason: "pan" },
    { before: motion },
    { after: motion },
    { after: null },
    { extra: true },
    { command: { type: "presentation", clipId: "other", layout } },
    { command: { type: "presentation", clipId: "clip", motion } },
    { command: { type: "presentation", clipId: "clip", layout, motion } },
    { command: { type: "presentation", clipId: "clip" } },
    { command: { type: "remove", clipId: "clip", layout } },
    { command: { type: "presentation", clipId: "clip", layout, extra: true } },
    {
      command: {
        type: "presentation",
        clipId: "clip",
        layout: { ...layout, preset: "contain" },
      },
    },
    {
      command: {
        type: "presentation",
        clipId: "clip",
        layout: { ...layout, unsafe: true },
      },
    },
  ])("rejects malformed layout action evidence %j", (patch) => {
    expect(() =>
      validateProject(
        projectWith([
          { ...receipt(), actions: [{ ...layoutAction(), ...patch }] },
        ]),
      ),
    ).toThrow();
  });

  it.each([
    { reason: "hero" },
    { before: layout },
    { after: layout },
    { command: { type: "presentation", clipId: "clip", layout } },
    {
      command: {
        type: "presentation",
        clipId: "clip",
        motion: { ...motion, to: { scale: 0, x: 0, y: 0 } },
      },
    },
  ])("rejects malformed motion action evidence %j", (patch) => {
    expect(() =>
      validateProject(
        projectWith([
          { ...receipt(), actions: [{ ...motionAction(), ...patch }] },
        ]),
      ),
    ).toThrow();
  });

  it("accepts matching command snapshots independently of property order", () => {
    const after = {
      version: 1,
      preset: "hero",
      focalPoint: { x: 0.5, y: 0.25 },
    };
    const action = {
      ...layoutAction(),
      after,
      command: {
        type: "presentation",
        clipId: "clip",
        layout: { focalPoint: { y: 0.25, x: 0.5 }, preset: "hero", version: 1 },
      },
    };
    const value = projectWith([{ ...receipt(), actions: [action] }]);
    expect(validateProject(value)).toEqual(value);
  });
});
