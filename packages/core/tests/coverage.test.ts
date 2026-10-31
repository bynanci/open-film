// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import {
  AUDIO_SAMPLE_RATE,
  buildAudioMixPlan,
  createCoverageProposal,
  resolveCompositionCoverageBindings,
  validateClipCoverage,
  validateCoverageProposal,
  type AudioMixContext,
  type Clip,
  type Composition,
  type MediaAsset,
} from "../src/index.js";

const timebase: AudioMixContext["timebase"] = {
  version: 1,
  rateNumerator: 30,
  rateDenominator: 1,
  dropFrame: false,
};

const dialogueAsset: MediaAsset = {
  id: "asset-dialogue",
  name: "Dialogue.wav",
  uri: "file:///dialogue.wav",
  mediaType: "audio",
  duration: 20,
  tags: [],
  state: {},
  metadata: {},
};

const bRollAsset1: MediaAsset = {
  id: "asset-broll1",
  name: "BRoll1.mp4",
  uri: "file:///broll1.mp4",
  mediaType: "video",
  duration: 10,
  tags: [],
  state: {},
  metadata: {
    "openfilm.ffprobe": {
      streams: [{ codec_type: "video" }, { codec_type: "audio", duration: 10 }],
    },
  },
};

const bRollAsset2: MediaAsset = {
  id: "asset-broll2",
  name: "BRoll2.mp4",
  uri: "file:///broll2.mp4",
  mediaType: "video",
  duration: 10,
  tags: [],
  state: {},
  metadata: {
    "openfilm.ffprobe": {
      streams: [{ codec_type: "video" }, { codec_type: "audio", duration: 10 }],
    },
  },
};

const silentBRollAsset: MediaAsset = {
  id: "asset-silent",
  name: "Silent.jpg",
  uri: "file:///silent.jpg",
  mediaType: "image",
  tags: [],
  state: {},
  metadata: {},
};

describe("D3B2 A-roll / B-roll coverage contracts", () => {
  describe("validateClipCoverage", () => {
    it("accepts valid primary-narrative role", () => {
      const coverage = validateClipCoverage({
        version: 1,
        role: "primary-narrative",
      });
      expect(coverage).toEqual({
        version: 1,
        role: "primary-narrative",
      });
    });

    it("accepts valid b-roll-overlay with bound primaryClipId and audioPolicy", () => {
      const coverage = validateClipCoverage({
        version: 1,
        role: "b-roll-overlay",
        primaryClipId: "clip-a",
        audioPolicy: {
          version: 1,
          mode: "mix-secondary",
          role: "ambience",
          gain: 0.35,
        },
      });
      expect(coverage).toEqual({
        version: 1,
        role: "b-roll-overlay",
        primaryClipId: "clip-a",
        audioPolicy: {
          version: 1,
          mode: "mix-secondary",
          role: "ambience",
          gain: 0.35,
        },
      });
    });

    it("rejects invalid versions, unknown roles and keys", () => {
      expect(() =>
        validateClipCoverage({ version: 2, role: "primary-narrative" }),
      ).toThrow();
      expect(() =>
        validateClipCoverage({ version: 1, role: "invalid-role" }),
      ).toThrow();
      expect(() =>
        validateClipCoverage({
          version: 1,
          role: "primary-narrative",
          extraField: true,
        }),
      ).toThrow();
      expect(() =>
        validateClipCoverage(
          { version: 1, role: "b-roll-overlay", primaryClipId: "unknown-clip" },
          "coverage",
          new Set(["clip-1", "clip-2"]),
        ),
      ).toThrow(/unknown primary clip ID/);
    });
  });

  describe("validateCoverageProposal", () => {
    it("accepts a structurally complete coverage proposal", () => {
      const proposal = validateCoverageProposal({
        version: 1,
        id: "proposal-1",
        compositionId: "comp-1",
        bRollClipId: "broll-1",
        primaryClipId: "primary-1",
        role: "b-roll-overlay",
        audioPolicy: { version: 1, mode: "keep-primary" },
        timelineStart: 2,
        timelineDuration: 4,
        evidence: {
          primaryRange: { timelineStart: 0, timelineDuration: 10 },
          bRollRange: { timelineStart: 2, timelineDuration: 4 },
          overlapStart: 2,
          overlapDuration: 4,
        },
      });
      expect(proposal.id).toBe("proposal-1");
      expect(proposal.role).toBe("b-roll-overlay");
    });

    it("rejects identical primary and secondary clip IDs", () => {
      expect(() =>
        validateCoverageProposal({
          version: 1,
          id: "proposal-1",
          compositionId: "comp-1",
          bRollClipId: "clip-same",
          primaryClipId: "clip-same",
          role: "b-roll-overlay",
          audioPolicy: { version: 1, mode: "keep-primary" },
          timelineStart: 2,
          timelineDuration: 4,
          evidence: {
            primaryRange: { timelineStart: 0, timelineDuration: 10 },
            bRollRange: { timelineStart: 2, timelineDuration: 4 },
            overlapStart: 2,
            overlapDuration: 4,
          },
        }),
      ).toThrow(/must differ/);
    });
  });

  describe("resolveCompositionCoverageBindings and buildAudioMixPlan parity", () => {
    it("multiple B-roll clips covering an A-roll clip keep primary narration continuous", () => {
      // Primary A-roll clip: 0s to 10s (dialogue narration)
      const primaryClip: Clip = {
        id: "clip-primary",
        assetId: dialogueAsset.id,
        timelineStart: 0,
        timelineDuration: 10,
        sourceIn: 0,
        sourceOut: 10,
        coverage: { version: 1, role: "primary-narrative" },
        audioAutomation: { version: 1, role: "narration" },
      };

      // B-roll 1: 1s to 3s (overlay, default keep-primary)
      const bRollClip1: Clip = {
        id: "clip-broll-1",
        assetId: bRollAsset1.id,
        timelineStart: 1,
        timelineDuration: 2,
        sourceIn: 0,
        sourceOut: 2,
        coverage: {
          version: 1,
          role: "b-roll-overlay",
          primaryClipId: "clip-primary",
        },
      };

      // B-roll 2: 5s to 8s (overlay, default keep-primary)
      const bRollClip2: Clip = {
        id: "clip-broll-2",
        assetId: bRollAsset2.id,
        timelineStart: 5,
        timelineDuration: 3,
        sourceIn: 0,
        sourceOut: 3,
        coverage: {
          version: 1,
          role: "b-roll-overlay",
          primaryClipId: "clip-primary",
        },
      };

      const composition: Composition = {
        id: "comp-1",
        storyId: "story-1",
        duration: 10,
        tracks: [
          { id: "track-main", type: "video", clips: [primaryClip] },
          {
            id: "track-overlay-1",
            type: "overlay",
            timing: "overlay",
            clips: [bRollClip1],
          },
          {
            id: "track-overlay-2",
            type: "overlay",
            timing: "overlay",
            clips: [bRollClip2],
          },
        ],
      };

      const bindings = resolveCompositionCoverageBindings(
        composition,
        timebase,
      );
      expect(bindings).toHaveLength(2);

      // Binding 1: 1s to 3s (48000 to 144000 samples)
      expect(bindings[0]).toMatchObject({
        primaryClipId: "clip-primary",
        secondaryClipId: "clip-broll-1",
        startSample: 48000,
        endSample: 144000,
        policy: { version: 1, mode: "keep-primary" },
      });

      // Binding 2: 5s to 8s (240000 to 384000 samples)
      expect(bindings[1]).toMatchObject({
        primaryClipId: "clip-primary",
        secondaryClipId: "clip-broll-2",
        startSample: 240000,
        endSample: 384000,
        policy: { version: 1, mode: "keep-primary" },
      });

      // Build audio mix plan with the resolved coverage
      const plan = buildAudioMixPlan(
        composition,
        [dialogueAsset, bRollAsset1, bRollAsset2],
        { timebase, coverage: bindings },
      );

      // Primary narration must be continuous across entire 10s (0 to 480000 samples)
      const narrationSegments = plan.segments.filter(
        (s) => s.clipId === "clip-primary" && s.role === "narration",
      );
      expect(narrationSegments.length).toBeGreaterThanOrEqual(1);

      // Total narration span starts at 0 and ends at 480000
      expect(narrationSegments[0]!.startSample).toBe(0);
      expect(narrationSegments[narrationSegments.length - 1]!.endSample).toBe(
        10 * AUDIO_SAMPLE_RATE,
      );

      // No gaps in narration
      for (let i = 1; i < narrationSegments.length; i++) {
        expect(narrationSegments[i]!.startSample).toBe(
          narrationSegments[i - 1]!.endSample,
        );
      }

      // Both B-roll audios must be excluded (masked) so secondary audio does not bleed in
      const secondarySegments = plan.segments.filter((s) =>
        ["clip-broll-1", "clip-broll-2"].includes(s.clipId),
      );
      expect(secondarySegments).toHaveLength(0);

      expect(plan.masks).toContainEqual({
        clipId: "clip-broll-1",
        startSample: 48000,
        endSample: 144000,
        reason: "excluded-secondary",
      });
      expect(plan.masks).toContainEqual({
        clipId: "clip-broll-2",
        startSample: 240000,
        endSample: 384000,
        reason: "excluded-secondary",
      });
    });

    it("supports silent or image B-roll overlays without audio streams", () => {
      const primaryClip: Clip = {
        id: "clip-primary",
        assetId: dialogueAsset.id,
        timelineStart: 0,
        timelineDuration: 6,
        sourceIn: 0,
        sourceOut: 6,
        coverage: { version: 1, role: "primary-narrative" },
      };

      const silentBRoll: Clip = {
        id: "clip-silent",
        assetId: silentBRollAsset.id,
        timelineStart: 1,
        timelineDuration: 3,
        coverage: {
          version: 1,
          role: "b-roll-overlay",
          primaryClipId: "clip-primary",
        },
      };

      const composition: Composition = {
        id: "comp-silent",
        storyId: "story-1",
        duration: 6,
        tracks: [
          { id: "v1", type: "video", clips: [primaryClip] },
          {
            id: "o1",
            type: "overlay",
            timing: "overlay",
            clips: [silentBRoll],
          },
        ],
      };

      const bindings = resolveCompositionCoverageBindings(
        composition,
        timebase,
      );
      expect(bindings).toHaveLength(1);
      expect(bindings[0]!.policy.mode).toBe("keep-primary");

      const plan = buildAudioMixPlan(
        composition,
        [dialogueAsset, silentBRollAsset],
        { timebase, coverage: bindings },
      );

      // Primary audio plays continuously; silent overlay does not fail or produce audio
      expect(plan.segments.map((s) => s.clipId)).toEqual(["clip-primary"]);
    });

    it("explicit mix-secondary mixes secondary audio without double mixing or muting primary", () => {
      const primaryClip: Clip = {
        id: "clip-primary",
        assetId: dialogueAsset.id,
        timelineStart: 0,
        timelineDuration: 8,
        sourceIn: 0,
        sourceOut: 8,
        coverage: { version: 1, role: "primary-narrative" },
        audioAutomation: { version: 1, role: "narration" },
      };

      const bRollClip: Clip = {
        id: "clip-broll",
        assetId: bRollAsset1.id,
        timelineStart: 2,
        timelineDuration: 4,
        sourceIn: 0,
        sourceOut: 4,
        coverage: {
          version: 1,
          role: "b-roll-overlay",
          primaryClipId: "clip-primary",
          audioPolicy: {
            version: 1,
            mode: "mix-secondary",
            role: "ambience",
            gain: 0.4,
          },
        },
      };

      const composition: Composition = {
        id: "comp-mix",
        storyId: "story-1",
        duration: 8,
        tracks: [
          { id: "v", type: "video", clips: [primaryClip] },
          { id: "o", type: "overlay", timing: "overlay", clips: [bRollClip] },
        ],
      };

      const bindings = resolveCompositionCoverageBindings(
        composition,
        timebase,
      );
      const plan = buildAudioMixPlan(
        composition,
        [dialogueAsset, bRollAsset1],
        { timebase, coverage: bindings },
      );

      // Primary narration covers the entire 8s
      const primarySegments = plan.segments.filter(
        (s) => s.clipId === "clip-primary",
      );
      expect(primarySegments[0]!.startSample).toBe(0);
      expect(primarySegments[primarySegments.length - 1]!.endSample).toBe(
        8 * AUDIO_SAMPLE_RATE,
      );

      // Secondary audio segment is mixed during 2s to 6s (96000 to 288000)
      const secondarySegment = plan.segments.find(
        (s) => s.clipId === "clip-broll",
      );
      expect(secondarySegment).toBeDefined();
      expect(secondarySegment!.startSample).toBe(2 * AUDIO_SAMPLE_RATE);
      expect(secondarySegment!.endSample).toBe(6 * AUDIO_SAMPLE_RATE);
      expect(secondarySegment!.role).toBe("ambience");
      expect(secondarySegment!.baseGain).toBe(0.4);
    });

    it("explicit replace-primary replaces primary narration during the coverage span", () => {
      const primaryClip: Clip = {
        id: "clip-primary",
        assetId: dialogueAsset.id,
        timelineStart: 0,
        timelineDuration: 8,
        sourceIn: 0,
        sourceOut: 8,
        coverage: { version: 1, role: "primary-narrative" },
        audioAutomation: { version: 1, role: "narration" },
      };

      const bRollClip: Clip = {
        id: "clip-broll",
        assetId: bRollAsset1.id,
        timelineStart: 2,
        timelineDuration: 3,
        sourceIn: 0,
        sourceOut: 3,
        coverage: {
          version: 1,
          role: "b-roll-overlay",
          primaryClipId: "clip-primary",
          audioPolicy: {
            version: 1,
            mode: "replace-primary",
            role: "dialogue",
            gain: 0.9,
          },
        },
      };

      const composition: Composition = {
        id: "comp-replace",
        storyId: "story-1",
        duration: 8,
        tracks: [
          { id: "v", type: "video", clips: [primaryClip] },
          { id: "o", type: "overlay", timing: "overlay", clips: [bRollClip] },
        ],
      };

      const bindings = resolveCompositionCoverageBindings(
        composition,
        timebase,
      );
      const plan = buildAudioMixPlan(
        composition,
        [dialogueAsset, bRollAsset1],
        { timebase, coverage: bindings },
      );

      // Primary narration is split around the replacement (0 to 2s, and 5s to 8s)
      const primarySegments = plan.segments.filter(
        (s) => s.clipId === "clip-primary",
      );
      expect(primarySegments).toHaveLength(2);
      expect(primarySegments[0]!.startSample).toBe(0);
      expect(primarySegments[0]!.endSample).toBe(2 * AUDIO_SAMPLE_RATE);
      expect(primarySegments[1]!.startSample).toBe(5 * AUDIO_SAMPLE_RATE);
      expect(primarySegments[1]!.endSample).toBe(8 * AUDIO_SAMPLE_RATE);

      // Secondary replacement plays from 2s to 5s
      const secondarySegment = plan.segments.find(
        (s) => s.clipId === "clip-broll",
      );
      expect(secondarySegment!.startSample).toBe(2 * AUDIO_SAMPLE_RATE);
      expect(secondarySegment!.endSample).toBe(5 * AUDIO_SAMPLE_RATE);
      expect(secondarySegment!.role).toBe("dialogue");
      expect(secondarySegment!.baseGain).toBe(0.9);

      // Primary is masked as replaced-primary between 2s and 5s
      expect(plan.masks).toContainEqual({
        clipId: "clip-primary",
        startSample: 2 * AUDIO_SAMPLE_RATE,
        endSample: 5 * AUDIO_SAMPLE_RATE,
        reason: "replaced-primary",
      });
    });

    it("creates reviewable coverage proposals with evidence", () => {
      const primaryClip: Clip = {
        id: "clip-primary",
        assetId: dialogueAsset.id,
        timelineStart: 1,
        timelineDuration: 8,
        coverage: { version: 1, role: "primary-narrative" },
      };

      const bRollClip: Clip = {
        id: "clip-broll",
        assetId: bRollAsset1.id,
        timelineStart: 3,
        timelineDuration: 4,
      };

      const composition: Composition = {
        id: "comp-prop",
        storyId: "story-1",
        duration: 10,
        tracks: [
          { id: "v", type: "video", clips: [primaryClip] },
          { id: "o", type: "overlay", timing: "overlay", clips: [bRollClip] },
        ],
      };

      const proposal = createCoverageProposal(composition, {
        bRollClipId: "clip-broll",
        primaryClipId: "clip-primary",
        timebase,
        sourceHash: "abc123sha",
      });

      expect(proposal.primaryClipId).toBe("clip-primary");
      expect(proposal.bRollClipId).toBe("clip-broll");
      expect(proposal.role).toBe("b-roll-overlay");
      expect(proposal.audioPolicy).toEqual({
        version: 1,
        mode: "keep-primary",
      });
      expect(proposal.timelineStart).toBe(3);
      expect(proposal.timelineDuration).toBe(4);
      expect(proposal.evidence).toEqual({
        primaryRange: { timelineStart: 1, timelineDuration: 8 },
        bRollRange: { timelineStart: 3, timelineDuration: 4 },
        overlapStart: 3,
        overlapDuration: 4,
        sourceHash: "abc123sha",
      });
    });
  });
});
