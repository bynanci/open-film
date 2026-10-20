import { describe, expect, it } from "vitest";
import { canCreatePhotoDepth } from "../../apps/desktop/src/photo-depth-controls.js";

const hash = "a".repeat(64);
const ready = {
  disabled: false,
  sourceHash: hash,
  maskHash: hash,
  selectedMaskId: "mask",
  backgroundKind: "source" as const,
  backgroundHash: undefined,
  eligibility: "",
};

describe("PhotoDepth create-button readiness", () => {
  it("enables creation only when every required local asset is hash-verified", () => {
    expect(canCreatePhotoDepth(ready)).toBe(true);
    expect(canCreatePhotoDepth({ ...ready, sourceHash: undefined })).toBe(
      false,
    );
    expect(canCreatePhotoDepth({ ...ready, maskHash: undefined })).toBe(false);
    expect(canCreatePhotoDepth({ ...ready, backgroundKind: "asset" })).toBe(
      false,
    );
    expect(
      canCreatePhotoDepth({
        ...ready,
        backgroundKind: "asset",
        backgroundHash: hash,
      }),
    ).toBe(true);
  });

  it("keeps the action unavailable when editing is disabled or prerequisites fail", () => {
    expect(canCreatePhotoDepth({ ...ready, disabled: true })).toBe(false);
    expect(canCreatePhotoDepth({ ...ready, selectedMaskId: "" })).toBe(false);
    expect(canCreatePhotoDepth({ ...ready, eligibility: "duration" })).toBe(
      false,
    );
    expect(canCreatePhotoDepth({ ...ready, eligibility: "motion" })).toBe(
      false,
    );
  });
});
