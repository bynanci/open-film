import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);
const ffmpeg = (args) =>
  execute("ffmpeg", ["-v", "error", "-nostdin", "-threads", "1", ...args], {
    maxBuffer: 4 * 1024 * 1024,
  });

/** Generate CC0 calibration pictures and synthetic tones, never personal media. */
export async function generatePhotoFilmQualityMedia(directory) {
  const root = resolve(directory);
  await mkdir(root, { recursive: true });
  const specifications = [
    {
      id: "portrait-center",
      width: 600,
      height: 900,
      color: "0x283e51",
      subjects: [[0.5, 0.43]],
    },
    {
      id: "portrait-left",
      width: 600,
      height: 900,
      color: "0x45624a",
      subjects: [[0.32, 0.45]],
    },
    {
      id: "landscape-pair",
      width: 1200,
      height: 675,
      color: "0x78604b",
      subjects: [
        [0.25, 0.5],
        [0.75, 0.5],
      ],
    },
    {
      id: "landscape-detail",
      width: 1200,
      height: 675,
      color: "0x244f68",
      subjects: [[0.63, 0.52]],
    },
    {
      id: "square-detail",
      width: 800,
      height: 800,
      color: "0x6f4557",
      subjects: [[0.55, 0.45]],
    },
    {
      id: "far-apart-subjects",
      width: 1600,
      height: 600,
      color: "0x3a475b",
      subjects: [
        [0.06, 0.5],
        [0.94, 0.5],
      ],
    },
    {
      id: "portrait-right",
      width: 600,
      height: 900,
      color: "0x62633a",
      subjects: [[0.68, 0.44]],
    },
    {
      id: "landscape-closing",
      width: 1200,
      height: 675,
      color: "0x514467",
      subjects: [[0.5, 0.48]],
    },
  ];
  const files = [];
  for (const specification of specifications) {
    const { id, width, height, color, subjects } = specification;
    // Geometric markers have bright heads and dark crosshairs so crop and motion
    // are inspectable. They are not a face-detector or optical-quality fixture.
    const filters = [
      `color=c=${color}:s=${width}x${height}`,
      `drawgrid=w=${Math.round(width / 10)}:h=${Math.round(height / 10)}:t=2:c=white@0.15`,
    ];
    const head = Math.round(Math.min(width, height) * 0.09);
    for (const [x, y] of subjects) {
      const cx = Math.round(width * x);
      const cy = Math.round(height * y);
      filters.push(
        `drawbox=x=${cx - head / 2}:y=${cy - head / 2}:w=${head}:h=${head}:color=0xffdc82:t=fill`,
        `drawbox=x=${cx - head / 2}:y=${cy + head / 2}:w=${head}:h=${Math.round(head * 1.7)}:color=0x99d6d1:t=fill`,
        `drawbox=x=${cx - 2}:y=${cy - head / 2}:w=4:h=${head}:color=black:t=fill`,
        `drawbox=x=${cx - head / 2}:y=${cy - 2}:w=${head}:h=4:color=black:t=fill`,
      );
    }
    const path = join(root, `${id}.png`);
    await ffmpeg([
      "-f",
      "lavfi",
      "-i",
      filters.join(","),
      "-frames:v",
      "1",
      "-threads",
      "1",
      "-update",
      "1",
      "-y",
      path,
    ]);
    files.push({ id, path, mediaType: "image", width, height, subjects });
  }
  const music = join(root, "synthetic-music.wav");
  await ffmpeg([
    "-f",
    "lavfi",
    "-i",
    "aevalsrc=0.15*sin(2*PI*220*t)+0.08*sin(2*PI*330*t):s=48000",
    "-t",
    "20",
    "-ac",
    "2",
    "-c:a",
    "pcm_s16le",
    "-y",
    music,
  ]);
  files.push({
    id: "synthetic-music",
    path: music,
    mediaType: "audio",
    duration: 20,
  });
  const narration = join(root, "synthetic-narration.wav");
  await ffmpeg([
    "-f",
    "lavfi",
    "-i",
    "aevalsrc=0.28*sin(2*PI*185*t)*(0.5+0.5*sin(2*PI*4*t))*between(mod(t\\,1)\\,0.1\\,0.8):s=48000",
    "-t",
    "8",
    "-ac",
    "1",
    "-c:a",
    "pcm_s16le",
    "-y",
    narration,
  ]);
  files.push({
    id: "synthetic-narration",
    path: narration,
    mediaType: "audio",
    duration: 8,
  });
  for (const file of files) {
    const bytes = await readFile(file.path);
    file.sha256 = createHash("sha256").update(bytes).digest("hex");
    file.bytes = bytes.length;
  }
  const manifest = {
    version: 1,
    license: "CC0-1.0",
    synthetic: true,
    generator: "fixtures/photo-film-quality/generate.mjs",
    provenance:
      "FFmpeg geometric calibration pictures, synthesized music and speech-shaped tones. No photographs, recorded speech or private media.",
    limitations: [
      "Subject markers do not validate real face detection or photographic aesthetics.",
      "Narration is a gated tone without words; it cannot establish speech intelligibility or listening quality.",
    ],
    files: files.map(({ path, ...file }) => ({
      ...file,
      path: path.slice(root.length + 1).replaceAll("\\", "/"),
    })),
  };
  await writeFile(
    join(root, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return { root, files, manifest };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await generatePhotoFilmQualityMedia(
    process.argv[2] ?? "/tmp/openfilm-photo-quality-evidence/media",
  );
  console.log(
    `Generated ${result.files.length} CC0 calibration assets in ${result.root}`,
  );
}
