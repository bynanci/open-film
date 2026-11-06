import { describe, expect, it } from "vitest";
import { filterGraphFileOptionForVersion } from "../src/filter-graph-cli.js";

describe("FFmpeg filter graph file syntax", () => {
  it("uses the legacy file option before FFmpeg 7", () => {
    expect(
      filterGraphFileOptionForVersion(
        "ffmpeg version 6.1.1-3ubuntu5 Copyright (c) FFmpeg developers\n",
      ),
    ).toBe("-filter_complex_script");
  });

  it("uses generic option-file syntax for FFmpeg 7 and newer", () => {
    expect(filterGraphFileOptionForVersion("ffmpeg version 7.1.5\n")).toBe(
      "-/filter_complex",
    );
    expect(
      filterGraphFileOptionForVersion("ffmpeg version 9.0.2-full_build\n"),
    ).toBe("-/filter_complex");
  });

  it("fails closed on an unknown version string", () => {
    expect(() =>
      filterGraphFileOptionForVersion("FFmpeg build unknown"),
    ).toThrow("Cannot determine FFmpeg filter-graph file syntax.");
  });
});
