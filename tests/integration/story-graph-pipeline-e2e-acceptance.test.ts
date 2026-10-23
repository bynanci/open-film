// Modified by OpenFilm contributors on 2026-10-23. See LICENSE and NOTICE.

import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const exec = promisify(execFile);
import { OpenFilmApplication } from "@openfilm/application";
import {
  isRunOutdated,
  type Composition,
  type MediaAsset,
  type Story,
  type StoryGraph,
} from "@openfilm/core";

/**
 * Generates a valid 16-bit PCM Mono WAV buffer with a standard 44-byte RIFF header.
 * Generates a 440 Hz sinusoidal tone; explicitly documented and flagged as synthetic tone.
 */
function createSyntheticToneWav(
  durationSeconds: number,
  sampleRate = 44100,
): Buffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const numSamples = Math.floor(sampleRate * durationSeconds);
  const dataSize = numSamples * blockAlign;
  const buffer = Buffer.alloc(44 + dataSize);

  // RIFF header
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);

  // fmt chunk
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16); // Chunk size
  buffer.writeUInt16LE(1, 20); // PCM format
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);

  // data chunk
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  // 440 Hz Sine wave tone
  const frequency = 440;
  for (let i = 0; i < numSamples; i++) {
    const sample = Math.sin((2 * Math.PI * frequency * i) / sampleRate);
    const intSample = Math.max(
      -32768,
      Math.min(32767, Math.floor(sample * 16000)),
    );
    buffer.writeInt16LE(intSample, 44 + i * 2);
  }

  return buffer;
}

describe(
  "Story Graph × Pipeline — End-to-End Product Acceptance",
  { timeout: 360_000 },
  () => {
    let projectDir: string;
    let app: OpenFilmApplication;
    let mediaDir: string;

    // 6 Synthetic Image Assets
    let photoAssets: MediaAsset[] = [];
    // Reproducible WAV Asset (tone)
    let wavAsset: MediaAsset;

    beforeEach(async () => {
      projectDir = await mkdtemp(join(tmpdir(), "openfilm-e2e-acceptance-"));
      app = await OpenFilmApplication.create(
        projectDir,
        "Jiufen Mountain & Sea Journey",
      );

      mediaDir = join(projectDir, "media");
      await mkdir(mediaDir, { recursive: true });

      // 1. Generate 6 Synthetic Photos (1280x720, 30fps baseline, 5s each -> 30s total)
      const photoConfigs = [
        {
          id: "photo_1",
          name: "九份老街入口",
          filename: "img1_entrance.jpg",
          color: "blue",
          lat: 25.109,
          lon: 121.844,
        },
        {
          id: "photo_2",
          name: "巷弄茶坊小憩",
          filename: "img2_teahouse.jpg",
          color: "teal",
          lat: 25.111,
          lon: 121.846,
        },
        {
          id: "photo_3",
          name: "雞籠山步道遠眺",
          filename: "img3_trail.jpg",
          color: "green",
          lat: 25.115,
          lon: 121.849,
        },
        {
          id: "photo_4",
          name: "山頂微風與芒草",
          filename: "img4_summit.jpg",
          color: "gold",
          lat: 25.118,
          lon: 121.851,
        },
        {
          id: "photo_5",
          name: "日落海平線霞光",
          filename: "img5_sunset.jpg",
          color: "orange",
          lat: 25.12,
          lon: 121.853,
        },
        {
          id: "photo_6",
          name: "夜市紅燈籠歸途",
          filename: "img6_lanterns.jpg",
          color: "purple",
          lat: 25.109,
          lon: 121.844,
        },
      ];

      photoAssets = [];
      for (const conf of photoConfigs) {
        const filePath = join(mediaDir, conf.filename);
        await exec("ffmpeg", [
          "-v",
          "error",
          "-f",
          "lavfi",
          "-i",
          `color=c=${conf.color}:s=1280x720`,
          "-frames:v",
          "1",
          "-threads",
          "1",
          "-update",
          "1",
          "-y",
          filePath,
        ]);
        const fileBytes = await readFile(filePath);
        const contentHash = createHash("sha256")
          .update(fileBytes)
          .digest("hex");

        const asset: MediaAsset = {
          id: conf.id,
          name: conf.name,
          uri: pathToFileURL(filePath).href,
          mediaType: "image",
          duration: 5,
          contentHash,
          dimensions: { width: 1280, height: 720 },
          tags: ["travel", "jiufen", "scenery"],
          state: {},
          metadata: {
            width: 1280,
            height: 720,
            colorSpace: "sRGB",
            frameRate: 30,
          },
          gps: { latitude: conf.lat, longitude: conf.lon },
        };
        app.catalog.upsertAsset(asset);
        photoAssets.push(asset);
      }

      // 2. Generate Reproducible 30-Second WAV Tone (must be labeled tone, not pretending to be human voice)
      const wavBytes = createSyntheticToneWav(30);
      const wavPath = join(mediaDir, "synthetic_guide_tone.wav");
      await writeFile(wavPath, wavBytes);
      const wavHash = createHash("sha256").update(wavBytes).digest("hex");

      wavAsset = {
        id: "asset_voice_tone",
        name: "synthetic_guide_tone.wav",
        uri: pathToFileURL(wavPath).href,
        mediaType: "audio",
        duration: 30,
        contentHash: wavHash,
        tags: ["tone", "synthetic-audio"],
        state: {},
        metadata: {
          audioFormat: "wav",
          sampleRate: 44100,
          channels: 1,
          bitsPerSample: 16,
          isTone: true,
          sourceNature: "synthetic-tone",
          description: "Synthetic 440Hz test tone; not human voice.",
        },
      };
      app.catalog.upsertAsset(wavAsset);

      // Initial manual editing timeline in timelines[0] (must remain untouched across story planning)
      const manualStory: Story = {
        id: "story-manual-original",
        title: "Original Hand-Crafted Cut",
        targetDuration: 10,
        maxDuration: 10,
        beats: [
          {
            id: "m-beat-1",
            title: "Manual Beat 1",
            targetDuration: 5,
            selectedAssetIds: ["photo_1"],
          },
          {
            id: "m-beat-2",
            title: "Manual Beat 2",
            targetDuration: 5,
            selectedAssetIds: ["photo_2"],
          },
        ],
      };
      app.project = {
        ...app.project,
        stories: [manualStory],
      };
      const manualComp = app.compose(manualStory.id);
      app.project = {
        ...app.project,
        timelines: [manualComp],
      };
      await app.save();
    });

    afterEach(async () => {
      try {
        app.catalog.close();
      } catch {
        /* ignore */
      }
      await rm(projectDir, { recursive: true, force: true }).catch(
        () => undefined,
      );
    });

    it("executes Journey 1 & 2: Story Graph -> Storyboard Proposal -> Rough Cut A without overwriting manual edit", async () => {
      // 3 fictional memories & 3 fictional conversations
      const baseStory: Story = {
        id: "story-jiufen-e2e",
        title: "九份山海漫行 (30秒完整試片)",
        targetDuration: 30,
        maxDuration: 30,
        beats: [
          {
            id: "b1",
            title: "清晨老街起步",
            intent: "呈現清晨寧靜的老街起點，鋪陳旅程氛圍",
            script: {
              narration: "清晨石階微涼，我們在老街路口集合出發。",
              visualDirection: "1280x720 廣角緩慢推鏡，定焦於石階與晨光。",
            },
            targetDuration: 5,
            selectedAssetIds: ["photo_1"],
          },
          {
            id: "b2",
            title: "巷弄茶香小憩",
            intent: "捕捉老街特有的茶坊慢活記憶",
            script: {
              narration: "走進熟悉的小巷，茶香隨著晨霧漸漸散開。",
              visualDirection: "中景平視，微縮深景聚焦茶壺與熱氣蒸騰。",
            },
            targetDuration: 5,
            selectedAssetIds: ["photo_2"],
          },
          {
            id: "b3",
            title: "石階步道遠眺",
            intent: "轉換視角至壯闊山海，表現步道向上的節奏",
            script: {
              narration: "轉上石階步道，遠處的海面泛起淡金色的晨光。",
              visualDirection: "水平緩搖全景，呈現山脊與太平洋的交會線。",
            },
            targetDuration: 5,
            selectedAssetIds: ["photo_3"],
          },
          {
            id: "b4",
            title: "登頂微風拂面",
            intent: "抵達山頂的高潮點，感受豁然開朗的心情",
            script: {
              narration: "抵達山頂眺望，涼爽的山風撫平了一路上的喧囂。",
              visualDirection:
                "微風吹拂芒草的特寫，接著快速拉開至廣角頂點視角。",
            },
            targetDuration: 5,
            selectedAssetIds: ["photo_4"],
          },
          {
            id: "b5",
            title: "黃昏海景霞光",
            intent: "黃昏日落的暖色調回歸，營造沉靜溫暖的結尾前奏",
            script: {
              narration: "夕陽緩緩沉入海平面，天邊染成溫暖的橘紅色。",
              visualDirection:
                "固定鏡頭長鏡頭，紀錄太陽沉落時的海平線光芒變化。",
            },
            targetDuration: 5,
            selectedAssetIds: ["photo_5"],
          },
          {
            id: "b6",
            title: "夜市燈火歸途",
            intent: "回到老街呼應片頭，但從清晨靜謐轉為夜晚燈火溫暖",
            script: {
              narration: "夜幕降臨紅燈籠亮起，我們帶著滿滿回憶踏上歸途。",
              visualDirection: "特寫紅燈籠暖光，淡出收尾。",
            },
            targetDuration: 5,
            selectedAssetIds: ["photo_1"], // Thematic echo of photo_1
          },
        ],
      };

      const graph: StoryGraph = {
        version: 1,
        nodes: [
          {
            id: "bn1",
            type: "beat",
            storyId: "story-jiufen-e2e",
            beatId: "b1",
          },
          {
            id: "bn2",
            type: "beat",
            storyId: "story-jiufen-e2e",
            beatId: "b2",
          },
          {
            id: "bn3",
            type: "beat",
            storyId: "story-jiufen-e2e",
            beatId: "b3",
          },
          {
            id: "bn4",
            type: "beat",
            storyId: "story-jiufen-e2e",
            beatId: "b4",
          },
          {
            id: "bn5",
            type: "beat",
            storyId: "story-jiufen-e2e",
            beatId: "b5",
          },
          {
            id: "bn6",
            type: "beat",
            storyId: "story-jiufen-e2e",
            beatId: "b6",
          },
          // 3 Fictional Memories
          {
            id: "mem1",
            type: "idea",
            text: "小時候外婆牽著我走過石階的午後",
            source: "user-memory",
          },
          {
            id: "mem2",
            type: "idea",
            text: "微風吹過山頂芒草沙沙作響的片刻",
            source: "user-memory",
          },
          {
            id: "mem3",
            type: "idea",
            text: "計畫明年春天再帶家人重遊此地",
            source: "wish",
          },
          // 3 Fictional Conversations
          {
            id: "chat1",
            type: "idea",
            text: "旅伴：『我們一定要在日落前走到山頂！』",
            source: "planned",
          },
          {
            id: "chat2",
            type: "idea",
            text: "茶坊老闆：『這壺高山烏龍要先聞茶香再入口。』",
            source: "planned",
          },
          {
            id: "chat3",
            type: "idea",
            text: "導遊：『晚上老街的紅燈籠一亮，整個氛圍完全不一樣。』",
            source: "planned",
          },
        ],
        edges: [
          { id: "e1", from: "bn1", to: "bn2", type: "precedes" },
          { id: "e2", from: "bn2", to: "bn3", type: "precedes" },
          { id: "e3", from: "bn3", to: "bn4", type: "precedes" },
          { id: "e4", from: "bn4", to: "bn5", type: "precedes" },
          { id: "e5", from: "bn5", to: "bn6", type: "precedes" },
          { id: "e-echo", from: "bn1", to: "bn6", type: "echoes" },
          { id: "e-mem1", from: "bn1", to: "mem1", type: "contains" },
          { id: "e-chat2", from: "bn2", to: "chat2", type: "contains" },
          { id: "e-chat1", from: "bn3", to: "chat1", type: "contains" },
          { id: "e-mem2", from: "bn4", to: "mem2", type: "contains" },
          { id: "e-mem3", from: "bn5", to: "mem3", type: "contains" },
          { id: "e-chat3", from: "bn6", to: "chat3", type: "contains" },
        ],
      };

      app.project = {
        ...app.project,
        stories: [...app.project.stories, baseStory],
      };
      app.storyGraph.updateGraph("story-jiufen-e2e", graph);

      const originalManualCompId = app.project.timelines[0]!.id;

      // 1. Preview Storyboard Proposal (StoryPlan)
      const { plan, compositionPreview } = app.storyPlan.previewPlan(
        "story-jiufen-e2e",
        {
          targetDuration: 30,
          maxDuration: 30,
        },
      );

      // 30 seconds, 30fps -> 900 frames calculation
      expect(compositionPreview.duration).toBeCloseTo(30, 2);
      const calculatedFrames = Math.round(compositionPreview.duration * 30);
      expect(calculatedFrames).toBe(900);

      // 5 Storyboard Dimensions Verified
      expect(plan.scenes).toHaveLength(6);
      for (const sc of plan.scenes) {
        expect(sc.assets.length).toBeGreaterThan(0); // whichImage
        expect(sc.intent).toBeTruthy(); // whatExpressed
        expect(sc.visualDirection).toBeTruthy(); // howPresented
        expect(sc.targetDuration).toBeGreaterThanOrEqual(5); // howLong
        expect(sc.rationale).toBeTruthy(); // whyRationale
      }

      // Thematic Echo: photo_1 is reused in scenes[0] and scenes[5] as distinct clip instances
      expect(plan.scenes[0]!.assets[0]!.assetId).toBe("photo_1");
      expect(plan.scenes[5]!.assets[0]!.assetId).toBe("photo_1");
      expect(plan.scenes[0]!.assets[0]!.isEcho).toBe(true);
      expect(plan.scenes[5]!.assets[0]!.isEcho).toBe(true);

      // Source Nature Preservation: user-memory vs. wish vs. chat are distinct
      expect(plan.scenes[0]?.sourceNature).toBe("user-memory");
      expect(plan.scenes[1]?.sourceNature).toBe("planned");
      expect(plan.scenes[4]?.sourceNature).toBe("wish");

      // Preview must not overwrite manual editing
      expect(app.project.timelines).toHaveLength(1);
      expect(app.project.timelines[0]?.storyId).toBe("story-manual-original");

      // 2. Adopt StoryPlan into a New Rough Cut A
      const { story: roughCutStory, composition: roughCutComp } =
        app.storyPlan.acceptPlan("story-jiufen-e2e", plan);

      expect(roughCutStory.title).toContain("Story Plan Cut");
      expect(roughCutComp.duration).toBeCloseTo(30, 2);

      // Timelines now contain original manual edit at [0] and new rough cut A at [1]
      expect(app.project.timelines).toHaveLength(2);
      expect(app.project.timelines[0]?.id).toBe(originalManualCompId);
      expect(app.project.timelines[1]?.id).toBe(roughCutComp.id);
    });

    it("executes Journey 3 & 4: Guided Pipeline -> Export -> Subtitle-only Variant B with Verified 0 TTS / 0 Motion Reuse", async () => {
      // Setup Story and Composition with 30s duration
      const story: Story = {
        id: "story-pipeline-e2e",
        title: "九份管線試片",
        targetDuration: 30,
        maxDuration: 30,
        beats: photoAssets.map((p, idx) => ({
          id: `b_${idx + 1}`,
          title: p.name,
          targetDuration: 5,
          selectedAssetIds: [p.id],
        })),
      };
      app.project.stories.push(story);
      app.compose(story.id);
      await app.save();

      // 1. Initial Guided Pipeline Run
      const run = await app.pipeline.createRun("guided-story-to-video", {
        storyId: story.id,
        assetIds: photoAssets.map((p) => p.id),
        narration: {
          type: "voice-import",
          assetId: wavAsset.id,
        },
        exportFormat: "mp4",
        customParams: {
          subtitleText: "清晨石階微涼，我們在老街路口集合出發。",
        },
      });

      expect(run.status).toBe("idle");
      const started = await app.pipeline.startRun(run.id);

      // Awaiting review step
      expect(started.status).toBe("waiting-review");
      const waitingAttempt = started.stepAttempts[started.currentStepIndex];
      expect(waitingAttempt?.stepId).toBe("step-3");

      // Review & accept
      let resumed = await app.pipeline.submitReview(
        run.id,
        "step-3",
        "accepted",
        { notes: "照片與鏡頭安排合適，確認採用" },
      );
      if (resumed.status === "waiting-review") {
        resumed = await app.pipeline.submitReview(
          run.id,
          resumed.stepAttempts[resumed.currentStepIndex]?.stepId ?? "step-7",
          "accepted",
          { notes: "QA 檢測通過，確認輸出" },
        );
      }
      expect(resumed.status).toBe("succeeded");

      // Output frame count check: 30 seconds at 30fps = 900 frames
      const timingStep = resumed.stepAttempts.find(
        (s) => s.stepId === "step-4",
      );
      expect(timingStep?.outputs?.confirmedDuration).toBe(30);
      const framesCount = Number(timingStep?.outputs?.confirmedDuration) * 30;
      expect(framesCount).toBe(900);

      // Verify receipts & artifacts produced
      const adoptReceipt = resumed.receipts.find((r) => r.stepId === "step-5");
      expect(adoptReceipt).toBeDefined();
      expect(adoptReceipt?.action).toBe("composition-adopt");

      const previewArtifact = resumed.artifacts.find(
        (a) => a.stepId === "step-6",
      );
      expect(previewArtifact?.kind).toBe("preview-video");

      const qaAttempt = resumed.stepAttempts.find((s) => s.stepId === "step-7");
      expect(qaAttempt?.outputs?.qaStatus).toBe("complete");

      // 2. Journey 4: Create Variant B (Modifying Subtitles Only)
      const prevTtsCalls = app.pipeline.getServiceCallCounters().ttsCalls;
      const prevMotionCalls = app.pipeline.getServiceCallCounters().motionCalls;

      // Analyze change impact for subtitle update
      const impact = await app.pipeline.analyzeChangeImpact(
        "guided-story-to-video",
        {
          storyId: story.id,
          assetIds: photoAssets.map((p) => p.id),
          narration: {
            type: "voice-import",
            assetId: wavAsset.id,
          },
          exportFormat: "mp4",
          customParams: {
            subtitleText: "轉上石階步道，整片山海在陽光下豁然開朗。", // Subtitle updated
          },
          baseRunId: resumed.id,
        },
      );

      // Subtitle update impacts timing-captions, render, visual-qa, export; preserves scene-prep and narration
      const scenePrepImpact = impact.steps.find((s) => s.stepId === "step-2");
      const narrationImpact = impact.steps.find((s) => s.stepId === "step-3");
      const renderImpact = impact.steps.find((s) => s.stepId === "step-6");

      expect(scenePrepImpact?.status).toBe("reuse");
      expect(narrationImpact?.status).toBe("reuse");
      expect(renderImpact?.status).toBe("rerun");
      expect(impact.renderMode).toBe("full-render-fallback");

      // Run incremental execution
      const incrementalRun = await app.pipeline.createIncrementalRun(
        "guided-story-to-video",
        {
          storyId: story.id,
          assetIds: photoAssets.map((p) => p.id),
          narration: {
            type: "voice-import",
            assetId: wavAsset.id,
          },
          exportFormat: "mp4",
          customParams: {
            subtitleText: "轉上石階步道，整片山海在陽光下豁然開朗。",
          },
          baseRunId: resumed.id,
          impactReport: impact,
        },
      );

      const incrementalStarted = await app.pipeline.startRun(incrementalRun.id);
      let finalIncrementalRun = incrementalStarted;
      while (finalIncrementalRun.status === "waiting-review") {
        const waitingStepId =
          finalIncrementalRun.stepAttempts[finalIncrementalRun.currentStepIndex]
            ?.stepId ?? "step-7";
        finalIncrementalRun = await app.pipeline.submitReview(
          incrementalRun.id,
          waitingStepId,
          "accepted",
        );
      }

      expect(finalIncrementalRun.status).toBe("succeeded");

      // Verify 0 TTS and 0 Motion calls occurred during incremental run
      expect(app.pipeline.getServiceCallCounters().ttsCalls).toBe(prevTtsCalls);
      expect(app.pipeline.getServiceCallCounters().motionCalls).toBe(
        prevMotionCalls,
      );

      // Verify reused step attempts stamp reuseSource
      const reusedAttempt = finalIncrementalRun.stepAttempts.find(
        (s) => s.stepId === "step-3",
      );
      expect(reusedAttempt?.reuseSource?.runId).toBe(resumed.id);
    });

    it("executes Journey 5: Narration Modification propagates invalidation while visual candidates are preserved", async () => {
      const story: Story = {
        id: "story-narration-inval",
        title: "旁白變更測試",
        targetDuration: 30,
        maxDuration: 30,
        beats: photoAssets.map((p, idx) => ({
          id: `nb_${idx + 1}`,
          title: p.name,
          targetDuration: 5,
          selectedAssetIds: [p.id],
        })),
      };
      app.project.stories.push(story);
      app.compose(story.id);
      await app.save();

      // Baseline Run with initial narration
      const run1 = await app.pipeline.createRun("guided-story-to-video", {
        storyId: story.id,
        assetIds: photoAssets.map((p) => p.id),
        narration: {
          type: "voice-import",
          assetId: wavAsset.id,
        },
      });
      const s1 = await app.pipeline.startRun(run1.id);
      const finished1 =
        s1.status === "waiting-review"
          ? await app.pipeline.submitReview(run1.id, "step-3", "accepted")
          : s1;
      expect(finished1.status).toBe("succeeded");

      // Create a modified WAV tone
      const altWavBytes = createSyntheticToneWav(32); // Different duration (32s)
      const altWavPath = join(mediaDir, "alt_tone.wav");
      await writeFile(altWavPath, altWavBytes);
      const altWavAsset: MediaAsset = {
        ...wavAsset,
        id: "asset_voice_tone_alt",
        uri: pathToFileURL(altWavPath).href,
        duration: 32,
      };
      app.catalog.upsertAsset(altWavAsset);

      // Impact analysis: modifying narration invalidates narration, timing, composition-adopt, render, visual-qa, export
      const impact = await app.pipeline.analyzeChangeImpact(
        "guided-story-to-video",
        {
          storyId: story.id,
          assetIds: photoAssets.map((p) => p.id),
          narration: {
            type: "voice-import",
            assetId: altWavAsset.id,
          },
          baseRunId: finished1.id,
        },
      );

      const scenePrepImpact = impact.steps.find((s) => s.stepId === "step-2");
      const narrationImpact = impact.steps.find((s) => s.stepId === "step-3");
      const timingImpact = impact.steps.find((s) => s.stepId === "step-4");

      // Visual candidate assets stay preserved!
      expect(scenePrepImpact?.status).toBe("reuse");
      // Audio step requires review when input changes; timing is rerun
      expect(narrationImpact?.status).toBe("needs-review");
      expect(timingImpact?.status).toBe("rerun");
    });

    it("executes Journey 6: Injects Cancel, Retry, Source Change, Project Switch, Reopen, and Version Restore", async () => {
      const story: Story = {
        id: "story-fault-injections",
        title: "容錯與彈性測試",
        targetDuration: 15,
        beats: [
          {
            id: "fb1",
            title: "Fault Beat 1",
            targetDuration: 5,
            selectedAssetIds: ["photo_1"],
          },
          {
            id: "fb2",
            title: "Fault Beat 2",
            targetDuration: 5,
            selectedAssetIds: ["photo_2"],
          },
          {
            id: "fb3",
            title: "Fault Beat 3",
            targetDuration: 5,
            selectedAssetIds: ["photo_3"],
          },
        ],
      };
      app.project.stories.push(story);
      app.compose(story.id);
      await app.save();

      // 1. CANCEL INJECTION
      const run = await app.pipeline.createRun("guided-story-to-video", {
        storyId: story.id,
        assetIds: ["photo_1", "photo_2", "photo_3"],
        narration: { type: "none" },
      });
      const cancelPromise = app.pipeline.startRun(run.id);
      await app.pipeline.cancelRun(run.id);
      const cancelledRun = await cancelPromise;
      expect(cancelledRun.status).toBe("cancelled");

      // Late arrival rejection: cannot review cancelled step
      await expect(
        app.pipeline.submitReview(run.id, "step-2", "accepted"),
      ).rejects.toThrow();

      // 2. RETRY WITH ORIGINAL INPUT
      const retriedRun = await app.pipeline.retryRun(run.id);
      expect(retriedRun.id).toBe(run.id);
      expect(retriedRun.status).toBe("succeeded");
      expect(retriedRun.stepAttempts[0]?.attemptNumber).toBe(2);
      const finalRetry = retriedRun;

      // 3. SOURCE CHANGE (Content Hash mutation)
      const basePhoto = app.catalog.getAsset("photo_1")!;
      const mutatedPhoto: MediaAsset = {
        ...basePhoto,
        contentHash:
          "tampered_hash_000000000000000000000000000000000000000000000000000000",
      };
      app.catalog.upsertAsset(mutatedPhoto);

      const sourceChangeImpact = await app.pipeline.analyzeChangeImpact(
        "guided-story-to-video",
        {
          storyId: story.id,
          assetIds: ["photo_1", "photo_2", "photo_3"],
          narration: { type: "none" },
          baseRunId: finalRetry.id,
        },
      );
      // Consuming steps invalidated because photo_1 contentHash changed
      const step2Impact = sourceChangeImpact.steps.find(
        (s) => s.stepId === "step-2",
      );
      expect(step2Impact?.status).toBe("rerun");

      // Restore original asset
      app.catalog.upsertAsset(basePhoto);

      // 4. PROJECT SWITCH ISOLATION
      const projectDir2 = await mkdtemp(join(tmpdir(), "openfilm-e2e-proj2-"));
      const app2 = await OpenFilmApplication.create(
        projectDir2,
        "Isolated Project 2",
      );
      expect(app2.project.id).not.toBe(app.project.id);
      expect(app2.project.stories).toHaveLength(0);
      app2.catalog.close();
      await rm(projectDir2, { recursive: true, force: true });

      // 5. REOPEN PERSISTENCE
      app.catalog.close();
      const reopenedApp = await OpenFilmApplication.open(projectDir);
      expect(reopenedApp.project.title).toBe("Jiufen Mountain & Sea Journey");
      expect(
        reopenedApp.project.stories.some(
          (s) => s.id === "story-fault-injections",
        ),
      ).toBe(true);
      const reloadedRuns = await reopenedApp.pipeline.listRuns();
      expect(reloadedRuns.length).toBeGreaterThan(0);
      // Rebind app reference for teardown
      app = reopenedApp;

      // 6. VERSION RESTORE & OLD RUN INVALIDATION
      // Save checkpoint
      const checkpoint = await app.versions.create({
        name: "Checkpoint Alpha",
        description: "Pre-edit baseline",
        baseRevision: app.versions.currentRevision(),
        requestId: randomUUID(),
      });
      // Make edit that advances revision
      app.project.title = "Jiufen Mountain & Sea Journey (Edited Title)";
      await app.save();

      // Verify current revision is ahead
      expect(app.versions.currentRevision()).not.toBe(
        checkpoint.projectRevision,
      );

      // Restore checkpoint
      const currentRev = app.versions.currentRevision();
      await app.versions.restore(checkpoint.id, {
        baseRevision: currentRev,
        requestId: randomUUID(),
        confirmed: true,
      });
      expect(app.versions.currentRevision()).toBe(checkpoint.projectRevision);

      // An old run targeting the superseded revision is marked outdated
      const runForOldRev = {
        ...finalRetry,
        expectedRevision: "superseded_nonexistent_rev",
      };
      expect(isRunOutdated(runForOldRev, app.versions.currentRevision())).toBe(
        true,
      );
    });

    it("executes Journey 7: Creative Variants A/B Review, Single-Audio, Adoption, and Baseline Restoration", async () => {
      const baseStory: Story = {
        id: "story-ab-variants",
        title: "A/B 方案比較測試",
        targetDuration: 30,
        beats: photoAssets.map((p, idx) => ({
          id: `ab_b_${idx + 1}`,
          title: p.name,
          targetDuration: 5,
          selectedAssetIds: [p.id],
        })),
      };
      app.project.stories.push(baseStory);
      const compA: Composition = app.compose(baseStory.id);
      app.project.timelines = [compA];
      await app.save();

      // 1. Create Variant A (Baseline Variant) and Variant B (Tightening Beat 1 Pacing to 3.5s)
      const variantA = await app.creativeVariants.createVariant({
        name: "方案 A (基準方案)",
        intent: "維持原基準剪輯方案",
        scope: { type: "film" },
        baselineStoryId: baseStory.id,
        baselineCompositionId: compA.id,
      });

      const preview = app.creativeVariants.previewVariantImpact({
        name: "方案 B (節奏明快版)",
        intent: "縮短起步鏡頭，加快進入主題",
        scope: { type: "section", targetBeatId: "ab_b_1" },
        baselineStoryId: baseStory.id,
        baselineCompositionId: compA.id,
        modifications: {
          targetBeatId: "ab_b_1",
          targetDuration: 3.5,
        },
      });

      // Proves section isolation
      expect(preview.preservedSections.length).toBeGreaterThan(0);
      expect(
        preview.preservedSections.some((s) => s.sectionId === "ab_b_2"),
      ).toBe(true);

      const variantB = await app.creativeVariants.createVariant({
        name: "方案 B (節奏明快版)",
        intent: "縮短起步鏡頭，加快進入主題",
        scope: { type: "section", targetBeatId: "ab_b_1" },
        baselineStoryId: baseStory.id,
        baselineCompositionId: compA.id,
        modifications: {
          targetBeatId: "ab_b_1",
          targetDuration: 3.5,
        },
      });

      const list = await app.creativeVariants.listVariants();
      expect(list.some((v) => v.id === variantA.id)).toBe(true);
      expect(list.some((v) => v.id === variantB.id)).toBe(true);

      // 2. ZERO-RENDER A/B Comparison ("開比較不重新生成")
      const prevRenderCalls = app.pipeline.getServiceCallCounters().renderCalls;
      const comparison = await app.creativeVariants.compareVariants(
        variantA.id,
        variantB.id,
      );
      expect(app.pipeline.getServiceCallCounters().renderCalls).toBe(
        prevRenderCalls,
      ); // 0 render calls!
      expect(comparison.diff.baselineDuration).toBeCloseTo(30, 2);
      expect(comparison.diff.targetDuration).toBeCloseTo(28.5, 2);
      expect(comparison.diff.deltaSeconds).toBeCloseTo(-1.5, 2);
      expect(comparison.diff.beatDiffs[0]?.changed).toBe(true);
      expect(comparison.diff.beatDiffs[1]?.changed).toBe(false); // Section isolation!

      // 3. Adopt Variant B with Automatic Checkpoint
      const { checkpointVersionId, project: adoptedProject } =
        await app.creativeVariants.adoptVariant(variantB.id);

      expect(checkpointVersionId).toBeDefined();
      // Active composition is promoted to timelines[0]
      expect(adoptedProject.timelines[0]?.id).toBe(
        variantB.derivedCompositionId,
      );

      // 4. Safe Baseline Restore
      const { project: restoredProject } =
        await app.creativeVariants.restoreBaseline(
          variantB.id,
          checkpointVersionId,
        );
      expect(restoredProject.timelines[0]?.id).toBe(compA.id); // Rolled back to Baseline A!
    });

    it("verifies Collect Media and Export privacy contracts", async () => {
      // Unrelated private asset in catalog (must NOT be packaged when exporting current film)
      const privateFile = join(mediaDir, "private_unrelated.jpg");
      await writeFile(
        privateFile,
        Buffer.from("PRIVATE_PERSONAL_ASSET_DO_NOT_SHARE"),
      );
      const privateAsset: MediaAsset = {
        id: "private_asset_999",
        name: "private_unrelated.jpg",
        uri: pathToFileURL(privateFile).href,
        mediaType: "image",
        tags: ["private"],
        state: {},
        metadata: {},
      };
      app.catalog.upsertAsset(privateAsset);

      // Active composition only references photo_1 and photo_2
      const targetComp = app.project.timelines[0]!;
      const plan = await app.collectMedia.plan({
        scope: "current-film",
        compositionId: targetComp.id,
      });

      const packedAssetIds = plan.items.map((i) => i.resourceId);
      // Private asset MUST be strictly excluded
      expect(packedAssetIds).not.toContain("asset:private_asset_999");
    });
  },
);
