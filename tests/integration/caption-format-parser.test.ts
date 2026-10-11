import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CaptionCue } from "@openfilm/core";
import { serializeCaptions } from "@openfilm/exporters";
import { runProcess } from "@openfilm/media";

function cue(startMs: number, endMs: number, text: string): CaptionCue {
  return {
    id: `cue-${startMs}`,
    startMs,
    endMs,
    text,
    clipId: "instance",
    assetId: "asset",
    transcriptId: "document",
    transcriptRevisionId: "revision",
    segmentId: `segment-${startMs}`,
    sourceIn: startMs / 1000,
    sourceOut: endMs / 1000,
  };
}

describe("caption exports accepted by the independent FFmpeg subtitle demuxers", () => {
  for (const format of ["srt", "vtt"] as const) {
    it(`${format} preserves millisecond timing, overlaps, Unicode and multiline block boundaries`, async () => {
      const directory = await mkdtemp(
        join(tmpdir(), "openfilm-caption-parser-"),
      );
      try {
        const cues = [
          cue(
            1,
            999,
            format === "srt"
              ? "十和田湖 & memories\r\n次の行"
              : "十和田湖 & memories <literal>\r\n次の行",
          ),
          cue(
            998,
            1001,
            format === "srt"
              ? "Overlapping speech\n\nThis remains literal text."
              : "Overlapping speech\n\n00:00:05.000 --> 00:00:06.000\nThis remains literal text.",
          ),
          cue(3_599_999, 3_600_001, "跨越一小時 — 日本語 — emoji 🎬"),
        ];
        const path = join(directory, `captions.${format}`);
        await writeFile(path, serializeCaptions(format, cues).content, "utf8");
        const output = await runProcess("ffprobe", [
          "-v",
          "error",
          "-show_streams",
          "-show_packets",
          "-select_streams",
          "s:0",
          "-show_entries",
          "stream=codec_name:packet=pts_time,duration_time,size",
          "-of",
          "json",
          path,
        ]);
        const parsed = JSON.parse(output.stdout.toString("utf8")) as {
          streams: { codec_name: string }[];
          packets: { pts_time: string; duration_time: string; size: string }[];
        };
        expect(parsed.streams.map((stream) => stream.codec_name)).toEqual([
          format === "srt" ? "subrip" : "webvtt",
        ]);
        expect(parsed.packets).toHaveLength(3);
        expect(
          parsed.packets.map((packet) => ({
            startMs: Math.round(Number(packet.pts_time) * 1000),
            durationMs: Math.round(Number(packet.duration_time) * 1000),
          })),
        ).toEqual(
          cues.map((item) => ({
            startMs: item.startMs,
            durationMs: item.endMs - item.startMs,
          })),
        );
        expect(parsed.packets.every((packet) => Number(packet.size) > 0)).toBe(
          true,
        );
        expect(output.stderr).toBe("");
        // Demuxer acceptance alone does not prove displayed text survives. In
        // particular FFmpeg's SubRip decoder does not decode HTML entities like
        // a browser's WebVTT parser does. Inspect its decoded ASS dialogue text.
        if (format === "srt") {
          const decoded = await runProcess("ffmpeg", [
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            path,
            "-f",
            "ass",
            "-",
          ]);
          const dialogue = decoded.stdout
            .toString("utf8")
            // ASS records use CRLF on older FFmpeg and LF on newer releases.
            // Remove the record delimiter, never trim or normalize cue content.
            .split(/\r?\n/u)
            .filter((line) => line.startsWith("Dialogue: "))
            .map((line) => line.split(",").slice(9).join(","));
          expect(dialogue).toEqual(
            cues.map((item) =>
              item.text
                .replace(/\r\n?/gu, "\n")
                .replace(/\n\n/gu, "\n\u00a0\n")
                .replace(/\n/gu, "\\N"),
            ),
          );
        }
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    });
  }

  it("SubRip rejects payloads that its decoder would hide, interpret or split into false cues", () => {
    for (const text of [
      "Keep <literal> visible",
      "<b>not styling</b>",
      "literal {\\an8} instruction",
      "00:00:05.000 --> 00:00:06.000",
      "00:00:05,000 --> 00:00:06,000",
      "+00:00:05,000 --> 00:00:06,000",
    ]) {
      expect(
        () => serializeCaptions("srt", [cue(0, 1000, text)]),
        text,
      ).toThrow(/WebVTT|vtt/u);
    }
  });
});
