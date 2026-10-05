import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { copyFile, mkdir, utimes } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const execute = promisify(execFile);
const ffmpeg = async (args) =>
  execute(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
      "-threads",
      "1",
      ...args,
    ],
    { maxBuffer: 1024 * 1024 },
  );

/** Public-domain procedural shapes, test-pattern video and synthesized audio. */
export async function generateSampleMedia(directory) {
  await mkdir(directory, { recursive: true });
  await ffmpeg([
    "-f",
    "lavfi",
    "-i",
    "color=c=0x246a75:s=320x180,drawbox=x=40:y=30:w=100:h=120:color=0xf7c88b:t=fill",
    "-frames:v",
    "1",
    "-threads",
    "1",
    "-update",
    "1",
    "-y",
    join(directory, "01-photo.png"),
  ]);
  await copyFile(
    join(directory, "01-photo.png"),
    join(directory, "02-photo-copy.png"),
  );
  await ffmpeg([
    "-f",
    "lavfi",
    "-i",
    "color=c=0x33466b:s=320x180,drawbox=x=160:y=40:w=110:h=90:color=0xe08875:t=fill",
    "-frames:v",
    "1",
    "-threads",
    "1",
    "-update",
    "1",
    "-y",
    join(directory, "03-evening.png"),
  ]);
  await ffmpeg([
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=320x180:rate=24",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000",
    "-t",
    "3",
    "-c:v",
    "libx264",
    "-threads",
    "1",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-metadata",
    "creation_time=2024-06-15T12:00:00Z",
    "-movflags",
    "+faststart",
    "-y",
    join(directory, "04-motion.mp4"),
  ]);
  await ffmpeg([
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=660:sample_rate=48000",
    "-t",
    "2",
    "-c:a",
    "pcm_s16le",
    "-y",
    join(directory, "05-tone.wav"),
  ]);
  const files = [
    "01-photo.png",
    "02-photo-copy.png",
    "03-evening.png",
    "04-motion.mp4",
    "05-tone.wav",
  ];
  for (let index = 0; index < files.length; index++) {
    const time = new Date(Date.UTC(2024, 5, 15, 12, index));
    await utimes(join(directory, files[index]), time, time);
  }
  return files.map((file) => join(directory, file));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const destination =
    process.argv[2] ?? fileURLToPath(new URL("./generated/", import.meta.url));
  await generateSampleMedia(destination);
  console.log(`Generated five original test assets in ${destination}`);
}
