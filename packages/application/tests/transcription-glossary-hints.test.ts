import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it, vi } from "vitest";
import type { MediaAsset } from "@openfilm/core";
import { hashFile, runProcess } from "@openfilm/media";
import { LocalWhisperProvider } from "@openfilm/provider-whisper";
import { OpenFilmApplication } from "../src/index.js";

it.each([
  ["line feed", "\n"],
  ["carriage return", "\r"],
  ["tab", "\t"],
])(
  "preserves reviewable glossary %s content without passing invalid Whisper hints",
  async (_name, separator) => {
    const root = await mkdtemp(join(tmpdir(), "openfilm-glossary-hints-"));
    let application: OpenFilmApplication | undefined;
    try {
      const source = join(root, "spoken.wav");
      await runProcess("ffmpeg", [
        "-v",
        "error",
        "-nostdin",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=1",
        "-threads",
        "1",
        "-y",
        source,
      ]);
      const sourceHash = await hashFile(source);
      const asset: MediaAsset = {
        id: "source",
        uri: pathToFileURL(source).href,
        name: "spoken.wav",
        mediaType: "audio",
        duration: 1,
        contentHash: sourceHash,
        metadata: {},
        tags: [],
        state: {},
      };
      const directory = join(root, "film.openfilm");
      const runtime = { userDataDirectory: join(root, "user-data") };
      application = await OpenFilmApplication.create(
        directory,
        "Glossary hint protocol fixture, not ASR quality",
        {},
        runtime,
      );
      application.catalog.upsertAsset(asset);
      const replacement = `shared${separator}memory`;
      const originalTerm = application.knowledge.glossaryUpsert({
        scope: "project",
        source: "memory",
        replacement,
      });
      const safeTerm = application.knowledge.glossaryUpsert({
        scope: "project",
        source: "day",
        replacement: "day together",
      });
      const temporaryDirectory = join(root, "work");
      await mkdir(temporaryDirectory);
      // Exercise the real adapter's hint validation and PCM extraction. The
      // deterministic Python fixture tests the protocol, never recognition quality.
      const provider = new LocalWhisperProvider({
        pythonPath: process.env.OPENFILM_TEST_PYTHON ?? "python3",
        runnerPath: resolve("tests/fixtures/whisper-protocol.py"),
        modelPath: resolve("tests/fixtures/whisper-model"),
        temporaryDirectory,
      });
      const transcribe = vi.spyOn(provider, "transcribe");
      application.intelligence.registerTranscriptionProvider(provider);
      const job = await application.analyzeIntelligence(asset.id, {
        operation: "transcribe",
        language: "en",
        execution: "cpu",
      });
      expect(job.status, JSON.stringify(job.errors)).toBe("completed");
      expect(transcribe).toHaveBeenCalledOnce();
      expect(transcribe.mock.calls[0]?.[1]?.promptHints).toEqual([
        safeTerm.replacement,
      ]);
      const transcript = await application.transcriptEditor.get(asset.id);
      expect(transcript.document?.provenance).toMatchObject({
        providerId: provider.id,
        version: "1",
        providerVersion: "fixture-protocol/1",
        model: "fixture-protocol-not-asr",
        sourceHash,
      });
      expect(transcript.document?.segments.length).toBe(2);
      for (const segment of transcript.document!.segments) {
        expect(segment.words?.length).toBeGreaterThan(0);
        expect(segment.words!.every((word) => word.start < word.end)).toBe(
          true,
        );
      }
      const review = await application.runKnowledgeReview(asset.id, {
        source: "glossary",
      });
      expect(review.status).toBe("completed");
      const suggestions = await application.knowledge.suggestionsList(asset.id);
      expect(
        suggestions.suggestions.some((suggestion) =>
          suggestion.after.includes(replacement),
        ),
      ).toBe(true);
      expect(await application.transcriptEditor.get(asset.id)).toEqual(
        transcript,
      );
      application.close();
      application = await OpenFilmApplication.open(directory, runtime);
      expect(application.knowledge.glossaryList("project")).toContainEqual(
        originalTerm,
      );
      expect(await application.transcriptEditor.get(asset.id)).toEqual(
        transcript,
      );
    } finally {
      application?.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);
