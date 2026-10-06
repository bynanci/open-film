import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { ProviderRegistry } from "@openfilm/analysis";
import { hashFile, runProcess } from "@openfilm/media";
import type { MediaAsset } from "@openfilm/core";
import { LocalWhisperProvider, validateWhisperResult } from "../src/index.js";

const python = process.env.OPENFILM_TEST_PYTHON ?? "python3";
const fixture = fileURLToPath(
  new URL("../../../tests/fixtures/whisper-protocol.py", import.meta.url),
);
const model = fileURLToPath(
  new URL("../../../tests/fixtures/whisper-model", import.meta.url),
);
let directory: string;
let work: string;
let asset: MediaAsset;
let sourceHash: string;

function provider(runnerPath = fixture) {
  return new LocalWhisperProvider({
    pythonPath: python,
    modelPath: model,
    runnerPath,
    temporaryDirectory: work,
  });
}
async function script(name: string, body: string) {
  const path = join(directory, name);
  await writeFile(path, body);
  return path;
}
const result = {
  text: "A memory",
  language: "en",
  execution: "cpu",
  model: "unit-not-asr",
  version: "fixture/1",
  segments: [
    {
      id: "segment-1",
      start: 0.1,
      end: 0.8,
      text: "A memory",
      words: [
        { start: 0.1, end: 0.3, text: " A", confidence: 0.9 },
        { start: 0.3, end: 0.8, text: " memory" },
      ],
    },
  ],
};

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "openfilm-whisper-tests-"));
  work = join(directory, "owned temporary files");
  await mkdir(work);
  const audio = join(directory, "回憶  # & $(literal).wav");
  await runProcess("ffmpeg", [
    "-v",
    "error",
    "-nostdin",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=2",
    "-ar",
    "48000",
    "-ac",
    "2",
    "-threads",
    "1",
    "-y",
    audio,
  ]);
  sourceHash = await hashFile(audio);
  asset = {
    id: "audio",
    name: "回憶  # & $(literal).wav",
    uri: pathToFileURL(audio).href,
    mediaType: "audio",
    duration: 2,
    state: {},
    tags: [],
    metadata: {},
  };
});
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("local Whisper provider protocol (not speech accuracy)", () => {
  it("runs the production fallback/word/offline Python unit suite", async () => {
    const tests = fileURLToPath(
      new URL("./test_whisper_runner.py", import.meta.url),
    );
    const output = await runProcess(python, ["-B", tests]);
    expect(output.stderr).toContain("Ran 9 tests");
    expect(output.stderr).toContain("OK");
  });
  it("passes bounded Unicode terminology as process data without rewriting output", async () => {
    const path = await script(
      "hints.py",
      `import json,sys
assert json.loads(sys.argv[sys.argv.index('--prompt-hints')+1]) == ['台積電', 'OpenFilm # & $(literal)']
print(json.dumps({'event':'result','result':${JSON.stringify(result)}}))
`,
    );
    const output = await provider(path).transcribe(asset, {
      promptHints: ["台積電", "OpenFilm # & $(literal)"],
    });
    expect(output.text).toBe("A memory");
    expect(provider().capabilities.supportsPromptHints).toBe(true);
    expect(await readdir(work)).toEqual([]);
  });
  it.each(
    [
      Array(51).fill("term"),
      [""],
      ["x".repeat(201)],
      Array(11).fill("x".repeat(200)),
      [["term"]],
      ["bad\nline"],
    ].map((hints) => [hints]),
  )(
    "rejects invalid terminology context before launching a child (%j)",
    async (hints) => {
      await expect(
        provider().transcribe(asset, { promptHints: hints as string[] }),
      ).rejects.toMatchObject({ code: "request.invalid" });
      expect(await readdir(work)).toEqual([]);
    },
  );
  it("registers locally, extracts actual PCM, returns timed words, and removes temporary media", async () => {
    const local = provider();
    expect(await local.available()).toEqual({
      available: true,
      model: "fixture-protocol-not-asr",
    });
    const registry = new ProviderRegistry();
    registry.register(local);
    const stages: string[] = [];
    const progress: number[] = [];
    const transcript = await registry.transcribe(local.id, asset, {
      language: "en",
      execution: "cpu",
      onStage: (value) => stages.push(value),
      onProgress: (value) => progress.push(value),
    });
    expect(transcript.text).toContain("Our favorite memory");
    expect(transcript.model).toBe("fixture-protocol-not-asr");
    expect(transcript.version).toBe("fixture-protocol/1");
    expect(transcript.segments).toHaveLength(2);
    expect(transcript.segments?.[0]?.words?.[0]).toMatchObject({
      text: "Our",
      confidence: 0.9,
    });
    expect(stages).toEqual([
      "extracting-audio",
      "loading-model",
      "transcribing",
      "post-processing",
    ]);
    expect(progress.at(-1)).toBe(1);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
    expect(await readdir(work)).toEqual([]);
    expect(await hashFile(fileURLToPath(asset.uri))).toBe(sourceHash);
  });
  it.each(["auto", "zh", "ja"] as const)(
    "preserves the requested %s language across process arguments",
    async (language) => {
      const transcript = await provider().transcribe(asset, { language });
      expect(transcript.language).toBe(language === "auto" ? "en" : language);
      if (language === "zh") expect(transcript.text).toContain("回憶");
      if (language === "ja") expect(transcript.text).toContain("思い出");
    },
  );
  it("fails on a missing local model and reports an unavailable Python runtime", async () => {
    await expect(
      new LocalWhisperProvider({
        modelPath: join(directory, "not-installed"),
      }).transcribe(asset),
    ).rejects.toMatchObject({ code: "transcription.modelInvalid" });
    const unavailable = new LocalWhisperProvider({
      modelPath: model,
      pythonPath: join(directory, "no-python"),
    });
    expect(await unavailable.available()).toMatchObject({ available: false });
    await expect(unavailable.transcribe(asset)).rejects.toMatchObject({
      code: "transcription.runtimeUnavailable",
    });
  });
  it("detects a genuinely silent video container with no audio stream", async () => {
    const video = join(directory, "silent.mp4");
    await runProcess("ffmpeg", [
      "-v",
      "error",
      "-nostdin",
      "-f",
      "lavfi",
      "-i",
      "color=black:s=32x32:d=1",
      "-c:v",
      "libx264",
      "-threads",
      "1",
      "-y",
      video,
    ]);
    await expect(
      provider().transcribe({
        ...asset,
        name: "silent.mp4",
        uri: pathToFileURL(video).href,
        mediaType: "video",
      }),
    ).rejects.toMatchObject({ code: "transcription.noAudio" });
    expect(await readdir(work)).toEqual([]);
  });
  it("keeps delayed audio and internal packet gaps aligned to original source seconds", async () => {
    const delayed = join(directory, "delayed.mp4");
    await runProcess("ffmpeg", [
      "-v",
      "error",
      "-nostdin",
      "-f",
      "lavfi",
      "-i",
      "color=black:s=32x32:d=3",
      "-itsoffset",
      "1",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=1",
      "-map",
      "0:v",
      "-map",
      "1:a",
      "-c:v",
      "libx264",
      "-c:a",
      "aac",
      "-threads",
      "1",
      "-y",
      delayed,
    ]);
    const delayedResult = await provider().transcribe({
      ...asset,
      uri: pathToFileURL(delayed).href,
      mediaType: "video",
      duration: 3,
    });
    expect(delayedResult.segments?.[0]?.start).toBeGreaterThan(1);
    expect(delayedResult.segments?.[0]?.words?.[0]?.start).toBeGreaterThan(1);
    expect(delayedResult.segments?.at(-1)?.end).toBeLessThan(2.1);

    const gapped = join(directory, "packet-gap.mkv");
    await runProcess("ffmpeg", [
      "-v",
      "error",
      "-nostdin",
      "-f",
      "lavfi",
      "-i",
      "color=black:s=32x32:d=3",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=2",
      "-filter:a",
      "asetpts=PTS+gte(T\\,1)/TB",
      "-c:v",
      "libx264",
      "-c:a",
      "pcm_s16le",
      "-threads",
      "1",
      "-y",
      gapped,
    ]);
    const gappedResult = await provider().transcribe({
      ...asset,
      uri: pathToFileURL(gapped).href,
      mediaType: "video",
      duration: 3,
    });
    // The fixture uses 95% of actual extracted PCM; dropping the one-second gap
    // would incorrectly end its timed words near 1.9 instead of 2.85 seconds.
    expect(gappedResult.segments?.at(-1)?.end).toBeGreaterThan(2.8);
    expect(gappedResult.segments?.at(-1)?.end).toBeLessThanOrEqual(3);
  });
  it.each([
    { name: "single", duration: 1, gaps: [0.4], pulses: [0.6] },
    {
      name: "repeated",
      duration: 2,
      gaps: [0.4, 0.8, 1.2],
      pulses: [0.6, 1, 1.6],
    },
  ])(
    "passes source-clock pulse times to the runner across $name 50ms packet gaps (diagnostic, not ASR)",
    async ({ name, duration, gaps, pulses }) => {
      const source = join(directory, `short-packet-gaps-${name}.mkv`);
      const pulseExpression = pulses
        .map((time) => `between(t\\,${time}\\,${time + 0.01})`)
        .join("+");
      const gapExpression = gaps
        .map((time) => `between(t\\,${time}\\,${(time + 0.04).toFixed(2)})`)
        .join("+");
      await runProcess("ffmpeg", [
        "-v",
        "error",
        "-nostdin",
        "-f",
        "lavfi",
        "-i",
        `color=c=black:s=96x64:r=25:d=${duration}`,
        "-f",
        "lavfi",
        "-i",
        `aevalsrc=if(${pulseExpression}\\,0.75\\,0.5):s=8000:d=${duration}`,
        "-filter:a",
        `asetnsamples=n=80,aselect=not(${gapExpression})`,
        "-c:v",
        "ffv1",
        "-c:a",
        "pcm_s16le",
        "-threads",
        "1",
        "-y",
        source,
      ]);
      // Read the real provider-extracted 16kHz WAV. This runner reports pulse
      // sample positions, independently of the provider's FFmpeg arguments.
      const diagnostic = await script(
        `audio-clock-${name}.py`,
        `import argparse, json, struct, wave
parser = argparse.ArgumentParser(description="PCM timing diagnostic, not ASR")
for option in ["model", "audio", "language", "execution"]:
    parser.add_argument("--" + option)
args = parser.parse_args()
with wave.open(args.audio, "rb") as stream:
    rate = stream.getframerate()
    assert rate == 16000 and stream.getnchannels() == 1 and stream.getsampwidth() == 2
    data = stream.readframes(stream.getnframes())
samples = [value[0] for value in struct.iter_unpack("<h", data)]
segments = []
start = None
for index, sample in enumerate(samples + [0]):
    if sample > 0.625 * 32768:
        if start is None:
            start = index / rate
    elif start is not None:
        end = index / rate
        segments.append({"id": "pulse-" + str(len(segments)), "start": start, "end": end,
                         "text": "pulse", "words": [{"start": start, "end": end, "text": "pulse"}]})
        start = None
print(json.dumps({"event": "result", "result": {
    "text": f"{len(samples) / rate:.3f}s diagnostic PCM", "language": "en", "execution": "cpu",
    "model": "audio-clock-diagnostic-not-asr", "version": "diagnostic/1", "segments": segments}}), flush=True)
`,
      );
      const transcript = await provider(diagnostic).transcribe(
        {
          ...asset,
          uri: pathToFileURL(source).href,
          mediaType: "video",
          duration,
        },
        { execution: "cpu" },
      );
      expect(transcript.model).toBe("audio-clock-diagnostic-not-asr");
      expect(transcript.segments).toHaveLength(pulses.length);
      for (const [index, time] of pulses.entries()) {
        expect(transcript.segments?.[index]?.start).toBeCloseTo(time, 3);
        expect(transcript.segments?.[index]?.words?.[0]?.start).toBeCloseTo(
          time,
          3,
        );
      }
      expect(transcript.text).toBe(`${duration.toFixed(3)}s diagnostic PCM`);
      expect(await readdir(work)).toEqual([]);
    },
  );
  it("propagates structured process failures and rejects malformed/duplicate results", async () => {
    const failed = await script(
      "error.py",
      'import json,sys\nprint(json.dumps({"event":"error","code":"transcription.runtimeUnavailable","detail":"Optional engine is absent"}),flush=True)\nsys.exit(1)\n',
    );
    await expect(provider(failed).transcribe(asset)).rejects.toMatchObject({
      code: "transcription.runtimeUnavailable",
      detail: "Optional engine is absent",
    });
    const malformed = await script(
      "malformed.py",
      'print("not-json",flush=True)\n',
    );
    await expect(provider(malformed).transcribe(asset)).rejects.toMatchObject({
      code: "transcription.invalidOutput",
    });
    const duplicate = await script(
      "duplicate.py",
      `import json\nvalue=json.loads(${JSON.stringify(JSON.stringify({ event: "result", result }))})\nprint(json.dumps(value),flush=True)\nprint(json.dumps(value),flush=True)\n`,
    );
    await expect(provider(duplicate).transcribe(asset)).rejects.toMatchObject({
      code: "transcription.invalidOutput",
    });
    expect(await readdir(work)).toEqual([]);
  });
  it("rejects an execution array received from the process instead of publishing it", async () => {
    const malformed = await script(
      "execution-array.py",
      `import json\nvalue=json.loads(${JSON.stringify(JSON.stringify({ event: "result", result: { ...result, execution: ["cpu"] } }))})\nprint(json.dumps(value),flush=True)\n`,
    );
    await expect(provider(malformed).transcribe(asset)).rejects.toMatchObject({
      code: "transcription.invalidOutput",
    });
    expect(await readdir(work)).toEqual([]);
  });
  it("cancels and reaps an owned Python process before removing its temporary WAV", async () => {
    const pidPath = join(directory, "python.pid");
    const waiting = await script(
      "waiting.py",
      `import os,pathlib,signal,time\nsignal.signal(signal.SIGTERM,signal.SIG_IGN)\npathlib.Path(${JSON.stringify(pidPath)}).write_text(str(os.getpid()))\nprint('{"event":"stage","stage":"transcribing"}',flush=True)\ntime.sleep(60)\n`,
    );
    const controller = new AbortController();
    const running = provider(waiting).transcribe(asset, {
      signal: controller.signal,
    });
    // Attach a rejection observer before cancellation to avoid unhandled promises.
    const rejected = expect(running).rejects.toMatchObject({
      name: "AbortError",
    });
    for (let attempt = 0; attempt < 100; attempt++) {
      if (
        await stat(pidPath).then(
          () => true,
          () => false,
        )
      )
        break;
      await delay(20);
    }
    const pid = Number(await readFile(pidPath, "utf8"));
    controller.abort();
    await rejected;
    expect(() => process.kill(pid, 0)).toThrow();
    expect(await readdir(work)).toEqual([]);
  });
  it("rejects an already cancelled request before creating any temporary files", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      provider().transcribe(asset, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(await readdir(work)).toEqual([]);
  });
  it("rejects a source replaced during inference and keeps the extracted cache disposable", async () => {
    const source = join(directory, "changing.wav");
    await writeFile(source, await readFile(fileURLToPath(asset.uri)));
    await expect(
      provider().transcribe(
        { ...asset, uri: pathToFileURL(source).href },
        {
          onStage: (stage) => {
            if (stage === "transcribing")
              appendFileSync(source, "source changed");
          },
        },
      ),
    ).rejects.toMatchObject({ code: "source.changed" });
    expect(await readdir(work)).toEqual([]);
  });
});

describe("speech result validation", () => {
  it("preserves source seconds and word spacing without mutation", () => {
    const snapshot = structuredClone(result);
    expect(validateWhisperResult(result, 2)).toEqual(result);
    expect(result).toEqual(snapshot);
    expect(
      validateWhisperResult({ ...result, text: "", segments: [] }, 2).segments,
    ).toEqual([]);
  });
  it.each([
    { ...result, segments: [{ ...result.segments[0], end: 3 }] },
    { ...result, segments: [{ ...result.segments[0], words: [] }] },
    {
      ...result,
      segments: [
        {
          ...result.segments[0],
          words: [{ start: -1, end: 0.3, text: "bad" }],
        },
      ],
    },
    {
      ...result,
      segments: [
        { ...result.segments[0], words: [{ start: 0.1, end: 1, text: "bad" }] },
      ],
    },
    {
      ...result,
      segments: [
        {
          ...result.segments[0],
          words: [{ start: 0.1, end: 0.3, text: "bad", confidence: 2 }],
        },
      ],
    },
    { ...result, segments: [] },
    { ...result, execution: "remote" },
    { ...result, execution: ["cpu"] },
    { ...result, execution: ["gpu"] },
    { ...result, segments: [result.segments[0], result.segments[0]] },
  ])(
    "rejects invalid timing, word timestamps or execution provenance %#",
    (value) => {
      expect(() => validateWhisperResult(value, 2)).toThrow();
    },
  );
});
