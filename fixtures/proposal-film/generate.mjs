import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, utimes, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);
const require = createRequire(import.meta.url);
const exiftool = join(
  dirname(require.resolve("exiftool-vendored.pl/package.json")),
  "bin",
  "exiftool",
);

const ffmpeg = (args) =>
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
    { maxBuffer: 4 * 1024 * 1024 },
  );
const tag = (path, tags) =>
  execute("perl", [exiftool, "-overwrite_original", ...tags, path], {
    maxBuffer: 1024 * 1024,
  });

/** @typedef {{id:string,path:string,kind:string,synthetic:true,expected:Record<string,unknown>,sha256?:string,bytes?:number}} FixtureFile */

/**
 * Generate a small, entirely synthetic reference library. No camera originals,
 * faces, downloaded music or copyrighted footage are used.
 * @param {string} directory
 * @param {{includeRaw?:boolean}} options
 */
export async function generateProposalMedia(directory, options = {}) {
  const root = resolve(directory);
  const mediaDirectory = join(root, "media");
  const rawDirectory = join(root, "raw");
  await mkdir(mediaDirectory, { recursive: true });
  if (options.includeRaw !== false)
    await mkdir(rawDirectory, { recursive: true });
  /** @type {FixtureFile[]} */
  const files = [];
  /** @type {Record<string,string>} */
  const byId = {};
  const add = (id, path, kind, expected = {}) => {
    files.push({ id, path, kind, synthetic: true, expected });
    byId[id] = path;
    return path;
  };
  const image = async (filename, portrait = false, shift = 0) => {
    const path = join(mediaDirectory, filename);
    const size = portrait ? "180x320" : "320x180";
    await ffmpeg([
      "-f",
      "lavfi",
      "-i",
      `color=c=${portrait ? "0x33466b" : "0x246a75"}:s=${size},drawbox=x=${40 + shift}:y=30:w=${portrait ? 80 : 100}:h=120:color=0xf7c88b:t=fill`,
      "-frames:v",
      "1",
      "-threads",
      "1",
      "-update",
      "1",
      "-y",
      path,
    ]);
    return path;
  };
  const clip = async (filename, frequency, capturedAt) => {
    const path = join(mediaDirectory, filename);
    await ffmpeg([
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=320x180:rate=24",
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=${frequency}:sample_rate=48000`,
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
      `creation_time=${capturedAt}`,
      "-movflags",
      "+faststart",
      "-y",
      path,
    ]);
    return path;
  };
  const dateTags = (minute) => [
    `-DateTimeOriginal=2024:06:15 20:${String(minute).padStart(2, "0")}:00`,
    "-OffsetTimeOriginal=+08:00",
    "-Artist=OpenFilm synthetic fixture",
    "-Copyright=CC0 1.0; generated geometric calibration media",
  ];

  const landscape = add(
    "landscape",
    await image("01-opening-landscape.jpg"),
    "image",
    {
      width: 320,
      height: 180,
      capturedAt: "2024-06-15T12:01:00.000Z",
      timezone: "+08:00",
    },
  );
  await tag(landscape, dateTags(1));
  const similar = add(
    "similar",
    await image("02-opening-similar.jpg", false, 4),
    "image",
    { similarTo: "landscape", exactDuplicate: false },
  );
  await tag(similar, dateTags(2));
  const duplicate = add(
    "duplicate",
    join(mediaDirectory, "03-exact-copy.jpg"),
    "image",
    { exactDuplicateOf: "landscape" },
  );
  await copyFile(landscape, duplicate);
  const portrait = add(
    "portrait",
    await image("04-portrait.jpg", true),
    "image",
    { width: 180, height: 320 },
  );
  await tag(portrait, dateTags(4));
  add("missing-metadata", await image("05-no-metadata.png"), "image", {
    captureSource: "filesystem:mtime",
    filesystemTimestamp: "2024-06-15T12:05:00.000Z",
  });

  const pixelPhoto = add(
    "pixel-photo",
    await image("06-pixel-portrait.jpg", true, 8),
    "image",
    {
      device: "Google Pixel 8 Pro",
      capturedAt: "2024-06-15T12:06:00.000Z",
      timezone: "+08:00",
      orientation: 6,
      gps: { latitude: 37.4219999, longitude: -122.0840575 },
      motionPhoto: "metadata-reference",
    },
  );
  await tag(pixelPhoto, [
    ...dateTags(6),
    "-Make=Google",
    "-Model=Pixel 8 Pro",
    "-Software=Google Camera synthetic fixture",
    "-Orientation#=6",
    "-GPSLatitude=37.4219999",
    "-GPSLatitudeRef=N",
    "-GPSLongitude=122.0840575",
    "-GPSLongitudeRef=W",
    "-XMP-GCamera:MicroVideo=1",
    "-XMP-GCamera:MicroVideoVersion=1",
    "-XMP-GCamera:MicroVideoOffset=0",
  ]);
  const pixelVideo = add(
    "pixel-video",
    await clip("07-pixel-motion.mp4", 440, "2024-06-15T12:07:00Z"),
    "video",
    {
      device: "Google Pixel 8 Pro",
      duration: 3,
      width: 320,
      height: 180,
      frameRate: 24,
    },
  );
  await tag(pixelVideo, [
    "-Keys:Make=Google",
    "-Keys:Model=Pixel 8 Pro",
    "-Keys:Software=Google Camera synthetic fixture",
    "-QuickTime:CreateDate=2024:06:15 12:07:00",
    "-Keys:CreationDate=2024:06:15 20:07:00+08:00",
  ]);

  const rawPhotoName = "IMG_20240615_120800_00_001.insp";
  const rawVideoName = "VID_20240615_120900_00_001.insv";
  const instaPhoto = add(
    "insta360-photo",
    await image("08-insta360-export.jpg", false, 16),
    "image",
    {
      device: "Insta360 X4",
      level: 1,
      associatedRaw: `../raw/${rawPhotoName}`,
    },
  );
  await tag(instaPhoto, [
    ...dateTags(8),
    "-Make=Insta360",
    "-Model=X4",
    "-Software=Insta360 Studio synthetic fixture",
    `-XMP-xmpMM:DerivedFromFilePath=../raw/${rawPhotoName}`,
  ]);
  const instaVideo = add(
    "insta360-video",
    await clip("09-insta360-export.mp4", 550, "2024-06-15T12:09:00Z"),
    "video",
    {
      device: "Insta360 X4",
      level: 1,
      duration: 3,
      associatedRaw: `../raw/${rawVideoName}`,
    },
  );
  await tag(instaVideo, [
    "-Keys:Make=Insta360",
    "-Keys:Model=X4",
    "-Keys:Software=Insta360 Studio synthetic fixture",
    `-XMP-xmpMM:DerivedFromFilePath=../raw/${rawVideoName}`,
  ]);
  const audio = add(
    "music",
    join(mediaDirectory, "10-generated-melody.wav"),
    "audio",
    {
      duration: 8,
      provenance: "Two synthesized sine waves; no recorded performance",
    },
  );
  await ffmpeg([
    "-f",
    "lavfi",
    "-i",
    "aevalsrc=0.12*sin(2*PI*330*t)+0.08*sin(2*PI*440*t):s=48000",
    "-t",
    "8",
    "-c:a",
    "pcm_s16le",
    "-y",
    audio,
  ]);

  if (options.includeRaw !== false) {
    const rawPhoto = add(
      "insta360-raw-photo",
      join(rawDirectory, rawPhotoName),
      "simulated-360-image",
      {
        requiresReframedExport: true,
        provenance:
          "Ordinary generated JPEG copied with .insp extension; recognition only",
      },
    );
    await copyFile(instaPhoto, rawPhoto);
    const rawVideo = add(
      "insta360-raw-video",
      join(rawDirectory, rawVideoName),
      "simulated-360-video",
      {
        requiresReframedExport: true,
        provenance:
          "Ordinary generated H.264 MP4 copied with .insv extension; recognition only",
      },
    );
    await copyFile(instaVideo, rawVideo);

    // A TIFF IFD with width/height and genuine DNG/EXIF tags, deliberately without
    // pixel strips. ExifTool can inspect it; no real-camera demosaic is implied.
    const dng = add(
      "pixel-dng",
      join(rawDirectory, "raw-pixel.dng"),
      "metadata-only-dng",
      {
        previewSupported: false,
        device: "Google Pixel 8 Pro",
        width: 16,
        height: 16,
        capturedAt: "2024-06-15T12:11:00.000Z",
        timezone: "+08:00",
      },
    );
    const tiff = Buffer.alloc(38);
    tiff.write("II");
    tiff.writeUInt16LE(42, 2);
    tiff.writeUInt32LE(8, 4);
    tiff.writeUInt16LE(2, 8);
    [256, 257].forEach((id, index) => {
      const at = 10 + index * 12;
      tiff.writeUInt16LE(id, at);
      tiff.writeUInt16LE(4, at + 2);
      tiff.writeUInt32LE(1, at + 4);
      tiff.writeUInt32LE(16, at + 8);
    });
    await writeFile(dng, tiff);
    await tag(dng, [
      ...dateTags(11),
      "-Make=Google",
      "-Model=Pixel 8 Pro",
      "-DNGVersion=1.4.0.0",
      "-DNGBackwardVersion=1.1.0.0",
      "-UniqueCameraModel=Google Pixel 8 Pro (synthetic metadata only)",
    ]);
    const sidecarPhoto = add(
      "pixel-sidecar-photo",
      join(rawDirectory, "pixel-sidecar.MP.jpg"),
      "image",
      { motionPhoto: "sidecar", experimental: true },
    );
    const sidecarVideo = add(
      "pixel-sidecar-video",
      join(rawDirectory, "pixel-sidecar.MP.mp4"),
      "video",
      { motionPhotoSidecarOf: "pixel-sidecar-photo" },
    );
    await copyFile(pixelPhoto, sidecarPhoto);
    await copyFile(pixelVideo, sidecarVideo);
  }

  for (let index = 0; index < files.length; index++) {
    const file = files[index];
    const timestamp =
      file.id === "missing-metadata"
        ? new Date("2024-06-15T12:05:00Z")
        : new Date(Date.UTC(2024, 5, 15, 12, index + 1));
    await utimes(file.path, timestamp, timestamp);
    const bytes = await readFile(file.path);
    file.sha256 = createHash("sha256").update(bytes).digest("hex");
    file.bytes = bytes.length;
  }
  const manifestPath = join(root, "manifest.json");
  await writeFile(
    manifestPath,
    `${JSON.stringify({ schemaVersion: 1, title: "OpenFilm generated proposal reference media", license: "CC0-1.0", synthetic: true, generatedBy: "fixtures/proposal-film/generate.mjs", provenance: "FFmpeg geometric frames and synthesized audio; simulated device tags written with ExifTool. No captured camera originals.", limitations: ["Raw .insv/.insp are recognition fixtures, not stitched or reframed 360 camera data.", "The DNG fixture contains metadata only and cannot validate real camera demosaicing.", "Motion Photo detection is experimental; no embedded video extraction is demonstrated."], files: files.map(({ path, ...file }) => ({ ...file, path: relative(root, path).replaceAll("\\", "/") })) }, null, 2)}\n`,
  );
  return { root, mediaDirectory, rawDirectory, files, byId, manifestPath };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const output =
    process.argv[2] ?? fileURLToPath(new URL("./generated/", import.meta.url));
  const result = await generateProposalMedia(output);
  console.log(
    `Generated ${result.files.length} CC0 fixtures in ${result.root}; import ${result.mediaDirectory}. Manifest: ${basename(result.manifestPath)}`,
  );
}
