import { runProcess } from "@openfilm/media";

export type FilterGraphFileOption =
  "-/filter_complex" | "-filter_complex_script";

/** Select the graph-file syntax supported by the installed FFmpeg CLI. */
export function filterGraphFileOptionForVersion(
  versionOutput: string,
): FilterGraphFileOption {
  const match = /^ffmpeg version (\d+)\./imu.exec(versionOutput);
  if (!match)
    throw new Error("Cannot determine FFmpeg filter-graph file syntax.");
  return Number(match[1]) >= 7 ? "-/filter_complex" : "-filter_complex_script";
}

let cachedFilterGraphFileOption: Promise<FilterGraphFileOption> | undefined;

/** Resolve once per process; FFmpeg 9 removed the deprecated script option. */
export async function getFilterGraphFileOption(): Promise<FilterGraphFileOption> {
  cachedFilterGraphFileOption ??= runProcess("ffmpeg", ["-version"], {
    timeoutMs: 10_000,
    maxOutputBytes: 16 * 1024,
  }).then(({ stdout, stderr }) =>
    filterGraphFileOptionForVersion(`${stdout.toString("utf8")}\n${stderr}`),
  );
  try {
    return await cachedFilterGraphFileOption;
  } catch (error) {
    cachedFilterGraphFileOption = undefined;
    throw error;
  }
}
