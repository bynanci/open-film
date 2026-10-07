import { describe, expect, it } from "vitest";
import { resolveClipGeometry } from "@openfilm/core";
import { previewDraftGeometry } from "../../apps/desktop/src/previewGeometry";

describe("draft preview geometry", () => {
  it.each(["", "-", "1e", NaN, Infinity, null])(
    "keeps committed geometry for transient input %s",
    (value) => {
      const committed = { scale: 1.2, rotation: 30, x: 120, y: -40 };
      expect(
        previewDraftGeometry(
          { scale: value, rotation: value, x: value, y: value },
          committed,
        ),
      ).toEqual(committed);
    },
  );
  it("updates valid fields independently and rejects nonpositive draft scale", () => {
    expect(
      previewDraftGeometry(
        { scale: 0, rotation: -15, x: 12, y: "" },
        { scale: 2, y: 20 },
      ),
    ).toEqual({ scale: 2, rotation: -15, x: 12, y: 20 });
    expect(() => resolveClipGeometry({ scale: 0 })).toThrow();
  });
});
