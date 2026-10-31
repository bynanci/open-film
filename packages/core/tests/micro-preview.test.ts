// Modified by OpenFilm contributors on 2026-10-31. Preexisting portions retain
// Apache-2.0 grants; current OpenFilm first-party code is Apache-2.0. See LICENSE/NOTICE.

import { describe, expect, it } from "vitest";
import {
  ApplicationError,
  validateMicroPreviewProposal,
  type SceneMicroPreviewProposal,
  MICRO_PREVIEW_MAX_DURATION,
} from "../src/index.js";

const VALID_HEX64 = "a".repeat(64);

function validProposal(): SceneMicroPreviewProposal {
  return {
    version: 1,
    id: VALID_HEX64,
    storyId: "story-1",
    compositionId: "comp-1",
    baseRevision: VALID_HEX64,
    targetClipId: "clip-2",
    transition: {
      type: "dip-to-black",
      duration: 1.0,
    },
    cutTime: 3.0,
    previewStart: 1.0,
    previewEnd: 5.5,
    previewDuration: 4.5,
    ephemeralComposition: {
      id: "comp-1",
      storyId: "story-1",
      duration: 10.0,
      tracks: [],
    },
    createdAt: new Date().toISOString(),
  };
}

describe("SceneMicroPreviewProposal validation", () => {
  it("validates a well-formed micro-preview proposal", () => {
    const proposal = validProposal();
    const result = validateMicroPreviewProposal(proposal);
    expect(result).toBeDefined();
    expect(result.id).toBe(VALID_HEX64);
    expect(result.transition.type).toBe("dip-to-black");
    expect(result.previewDuration).toBe(4.5);
    expect(result.previewDuration).toBeLessThanOrEqual(
      MICRO_PREVIEW_MAX_DURATION,
    );
  });

  it("accepts crossfade, dip-to-black, and dip-to-white transitions", () => {
    for (const type of ["crossfade", "dip-to-black", "dip-to-white"] as const) {
      const proposal = validProposal();
      proposal.transition.type = type;
      expect(validateMicroPreviewProposal(proposal).transition.type).toBe(type);
    }
  });

  it("fails closed on non-object proposals", () => {
    expect(() => validateMicroPreviewProposal(null)).toThrow(ApplicationError);
    expect(() => validateMicroPreviewProposal("invalid")).toThrow(
      ApplicationError,
    );
  });

  it("fails closed on unsupported transition types", () => {
    const proposal = validProposal();
    (proposal.transition as { type: string }).type = "wipe";
    expect(() => validateMicroPreviewProposal(proposal)).toThrow(
      ApplicationError,
    );
  });

  it("fails closed on non-positive or non-finite transition duration", () => {
    const proposal1 = validProposal();
    proposal1.transition.duration = 0;
    expect(() => validateMicroPreviewProposal(proposal1)).toThrow(
      ApplicationError,
    );

    const proposal2 = validProposal();
    proposal2.transition.duration = -1.0;
    expect(() => validateMicroPreviewProposal(proposal2)).toThrow(
      ApplicationError,
    );

    const proposal3 = validProposal();
    proposal3.transition.duration = NaN;
    expect(() => validateMicroPreviewProposal(proposal3)).toThrow(
      ApplicationError,
    );
  });

  it("fails closed on invalid 64-character hex digests", () => {
    const proposal = validProposal();
    proposal.id = "short-id";
    expect(() => validateMicroPreviewProposal(proposal)).toThrow(
      ApplicationError,
    );

    const proposal2 = validProposal();
    proposal2.baseRevision = "not-a-hex-digest";
    expect(() => validateMicroPreviewProposal(proposal2)).toThrow(
      ApplicationError,
    );
  });

  it("fails closed when preview duration exceeds 5.0 seconds maximum", () => {
    const proposal = validProposal();
    proposal.previewStart = 0;
    proposal.previewEnd = 6.0;
    expect(() => validateMicroPreviewProposal(proposal)).toThrow(
      ApplicationError,
    );
  });
});
