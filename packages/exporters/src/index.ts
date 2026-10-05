import type {
  Clip,
  Composition,
  MediaAsset,
  ProjectSettings,
  Track,
} from "@openfilm/core";

export type ExportFormat = "json" | "otio" | "fcpxml" | "edl";
export interface ExportResult {
  extension: string;
  content: string;
}

function xml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
function gcd(a: number, b: number): number {
  while (b) {
    const next = a % b;
    a = b;
    b = next;
  }
  return Math.abs(a);
}
function rational(seconds: number): string {
  const numerator = Math.round(seconds * 1000000),
    denominator = 1000000;
  const divisor = gcd(numerator, denominator);
  return numerator === 0
    ? "0s"
    : `${numerator / divisor}/${denominator / divisor}s`;
}

function rateFraction(rate: number): [number, number] {
  for (const numerator of [24000, 30000, 60000, 120000])
    if (Math.abs(rate - numerator / 1001) < 0.001) return [numerator, 1001];
  const numerator = Math.round(rate * 1000000),
    divisor = gcd(numerator, 1000000);
  return [numerator / divisor, 1000000 / divisor];
}

function rejectEdits(clip: Clip, format: string): void {
  const defaults = { scale: 1, rotation: 0, x: 0, y: 0, speed: 1, volume: 1 };
  for (const [key, value] of Object.entries(clip.transform ?? {}))
    if (value !== defaults[key as keyof typeof defaults])
      throw new Error(
        `${format} export cannot represent ${key} on clip ${clip.id}. Use JSON to preserve this edit or remove the transform.`,
      );
  if (clip.title !== undefined)
    throw new Error(
      `${format} export does not support generated titles. Use JSON or remove the title from clip ${clip.id}.`,
    );
  if (clip.transition)
    throw new Error(
      `${format} export does not support ${clip.transition.type} transitions. Use JSON or remove the transition from clip ${clip.id}.`,
    );
}

function sortedClips(track: Track): Clip[] {
  return [...track.clips].sort(
    (a, b) => a.timelineStart - b.timelineStart || a.id.localeCompare(b.id),
  );
}

function validate(
  composition: Composition,
  assets: MediaAsset[],
  settings: ProjectSettings,
): Map<string, MediaAsset> {
  if (!Number.isFinite(composition.duration) || composition.duration < 0)
    throw new Error("Composition duration must be finite and non-negative.");
  if (
    ![settings.width, settings.height, settings.frameRate].every(
      (value) => Number.isFinite(value) && value > 0,
    )
  )
    throw new Error(
      "Export dimensions and frame rate must be positive finite values.",
    );
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  for (const track of composition.tracks)
    for (const clip of track.clips) {
      const asset = byId.get(clip.assetId);
      if (!asset)
        throw new Error(
          `Clip ${clip.id} references missing media ${clip.assetId}; relink it before export.`,
        );
      if (!asset.uri)
        throw new Error(
          `Media ${asset.name} has no URI; relink it before export.`,
        );
      if (
        !Object.values(clip.transform ?? {}).every((value) =>
          Number.isFinite(value),
        )
      )
        throw new Error(
          `Clip ${clip.id} has non-finite transform values; correct them before export.`,
        );
      if (
        !Number.isFinite(clip.timelineStart) ||
        clip.timelineStart < 0 ||
        !Number.isFinite(clip.timelineDuration) ||
        clip.timelineDuration <= 0 ||
        clip.timelineStart + clip.timelineDuration > composition.duration + 1e-6
      )
        throw new Error(`Clip ${clip.id} has invalid timeline bounds.`);
      const sourceIn = clip.sourceIn ?? 0,
        sourceOut =
          clip.sourceOut ??
          sourceIn + clip.timelineDuration * (clip.transform?.speed ?? 1);
      if (
        ![sourceIn, sourceOut].every(Number.isFinite) ||
        sourceIn < 0 ||
        sourceOut <= sourceIn
      )
        throw new Error(`Clip ${clip.id} has invalid source bounds.`);
      if (
        asset.mediaType !== "image" &&
        asset.duration !== undefined &&
        sourceOut > asset.duration + 1e-6
      )
        throw new Error(
          `Clip ${clip.id} extends beyond source media ${asset.name}.`,
        );
    }
  return byId;
}

/** Export preserves source references; this adapter never touches original media. */
export function exportTimeline(
  format: ExportFormat,
  composition: Composition,
  assets: MediaAsset[],
  settings: ProjectSettings = { width: 1920, height: 1080, frameRate: 30 },
): ExportResult {
  if (!["json", "otio", "fcpxml", "edl"].includes(format))
    throw new Error(`Unsupported timeline export format: ${String(format)}.`);
  const byId = validate(composition, assets, settings);
  if (format === "json") {
    const used = new Set(
      composition.tracks.flatMap((track) =>
        track.clips.map((clip) => clip.assetId),
      ),
    );
    return {
      extension: "json",
      content:
        JSON.stringify(
          {
            schemaVersion: "1.0.0",
            composition,
            assets: assets.filter((asset) => used.has(asset.id)),
            settings,
          },
          null,
          2,
        ) + "\n",
    };
  }
  for (const track of composition.tracks) {
    if (track.type === "titles" || track.type === "overlay")
      throw new Error(
        `${format} export does not support ${track.type} tracks. Use JSON to retain all edits.`,
      );
    let end = 0;
    for (const clip of sortedClips(track)) {
      rejectEdits(clip, format);
      if (clip.timelineStart < end - 1e-6)
        throw new Error(
          `${format} cannot export overlapping clips in track ${track.id}. Split them onto separate tracks or use JSON.`,
        );
      if (
        Math.abs(
          (clip.sourceOut ?? (clip.sourceIn ?? 0) + clip.timelineDuration) -
            (clip.sourceIn ?? 0) -
            clip.timelineDuration,
        ) > 1e-6
      )
        throw new Error(
          `${format} cannot export source/timeline durations that imply an unsupported speed change on clip ${clip.id}.`,
        );
      end = clip.timelineStart + clip.timelineDuration;
    }
  }
  if (format === "otio")
    return {
      extension: "otio",
      content:
        JSON.stringify(otio(composition, byId, settings), null, 2) + "\n",
    };
  if (format === "fcpxml")
    return {
      extension: "fcpxml",
      content: fcpxml(composition, byId, settings),
    };
  return { extension: "edl", content: edl(composition, byId, settings) };
}

function otio(
  composition: Composition,
  assets: Map<string, MediaAsset>,
  settings: ProjectSettings,
): unknown {
  const [numerator, denominator] = rateFraction(settings.frameRate),
    rate = numerator / denominator;
  const time = (seconds: number): unknown => ({
    OTIO_SCHEMA: "RationalTime.1",
    value: seconds * rate,
    rate,
  });
  const range = (start: number, duration: number): unknown => ({
    OTIO_SCHEMA: "TimeRange.1",
    start_time: time(start),
    duration: time(duration),
  });
  const tracks = composition.tracks.map((track) => {
    const children: unknown[] = [];
    let end = 0;
    for (const clip of sortedClips(track)) {
      if (clip.timelineStart > end + 1e-6)
        children.push({
          OTIO_SCHEMA: "Gap.1",
          name: "",
          effects: [],
          markers: [],
          metadata: {},
          source_range: range(0, clip.timelineStart - end),
        });
      const asset = assets.get(clip.assetId)!;
      children.push({
        OTIO_SCHEMA: "Clip.1",
        name: asset.name,
        metadata: {
          openfilm: { clipId: clip.id, assetId: asset.id, beatId: clip.beatId },
        },
        effects: [],
        markers: [],
        source_range: range(clip.sourceIn ?? 0, clip.timelineDuration),
        media_reference: {
          OTIO_SCHEMA: "ExternalReference.1",
          name: asset.name,
          target_url: asset.uri,
          available_range: range(
            0,
            Math.max(
              asset.duration ?? 0,
              (clip.sourceIn ?? 0) + clip.timelineDuration,
            ),
          ),
          metadata: { openfilm: { mediaType: asset.mediaType } },
        },
      });
      end = clip.timelineStart + clip.timelineDuration;
    }
    if (composition.duration > end + 1e-6)
      children.push({
        OTIO_SCHEMA: "Gap.1",
        name: "",
        effects: [],
        markers: [],
        metadata: {},
        source_range: range(0, composition.duration - end),
      });
    return {
      OTIO_SCHEMA: "Track.1",
      name: track.id,
      kind: track.type === "video" ? "Video" : "Audio",
      children,
      effects: [],
      markers: [],
      metadata: { openfilm: { trackType: track.type } },
      source_range: null,
    };
  });
  return {
    OTIO_SCHEMA: "Timeline.1",
    name: composition.id,
    metadata: {
      openfilm: {
        compositionId: composition.id,
        storyId: composition.storyId,
        settings,
      },
    },
    global_start_time: time(0),
    tracks: {
      OTIO_SCHEMA: "Stack.1",
      name: "tracks",
      metadata: {},
      children: tracks,
      effects: [],
      markers: [],
      source_range: range(0, composition.duration),
    },
  };
}

function fcpxml(
  composition: Composition,
  assets: Map<string, MediaAsset>,
  settings: ProjectSettings,
): string {
  const used = [
    ...new Set(
      composition.tracks.flatMap((track) =>
        track.clips.map((clip) => clip.assetId),
      ),
    ),
  ];
  const refs = new Map(used.map((id, index) => [id, `r${index + 2}`]));
  const [numerator, denominator] = rateFraction(settings.frameRate);
  const resourceLines = used.map((id) => {
    const asset = assets.get(id)!;
    const clips = composition.tracks
      .flatMap((track) => track.clips)
      .filter((clip) => clip.assetId === id);
    const available = Math.max(
      asset.duration ?? 0,
      ...clips.map((clip) => (clip.sourceIn ?? 0) + clip.timelineDuration),
    );
    const audio = asset.mediaType === "audio";
    return `      <asset id="${refs.get(id)!}" name="${xml(asset.name)}" start="0s" duration="${rational(available)}" hasVideo="${audio ? 0 : 1}" hasAudio="${audio ? 1 : 0}"${audio ? ' audioSources="1" audioChannels="2"' : ' format="r1"'}><media-rep kind="original-media" src="${xml(asset.uri)}"/></asset>`;
  });
  const primary =
    composition.tracks.find((track) => track.type === "video") ??
    composition.tracks[0];
  const secondary = composition.tracks.filter((track) => track !== primary);
  const clipXml = (clip: Clip, lane?: number): string =>
    `            <asset-clip name="${xml(assets.get(clip.assetId)!.name)}" ref="${refs.get(clip.assetId)!}" offset="${rational(clip.timelineStart)}" start="${rational(clip.sourceIn ?? 0)}" duration="${rational(clip.timelineDuration)}"${lane === undefined ? "" : ` lane="${lane}"`}/>`;
  let end = 0;
  const spine: string[] = [];
  for (const clip of primary ? sortedClips(primary) : []) {
    if (clip.timelineStart > end + 1e-6)
      spine.push(
        `            <gap name="Gap" offset="${rational(end)}" start="0s" duration="${rational(clip.timelineStart - end)}"/>`,
      );
    spine.push(clipXml(clip));
    end = clip.timelineStart + clip.timelineDuration;
  }
  if (composition.duration > end + 1e-6)
    spine.push(
      `            <gap name="Gap" offset="${rational(end)}" start="0s" duration="${rational(composition.duration - end)}"/>`,
    );
  // Connected clips are nested inside a full-duration gap. Their offsets are
  // relative to that gap's start (zero), so secondary track timing is retained.
  if (secondary.length) {
    const connected = secondary.flatMap((track, index) =>
      sortedClips(track).map((clip) =>
        clipXml(clip, track.type === "video" ? index + 2 : -(index + 1)),
      ),
    );
    // The primary spine remains a single connected storyline on lane 1.
    const primaryChildren = spine
      .map((line) => line.replace(/^ {12}/, "              "))
      .join("\n");
    spine.splice(
      0,
      spine.length,
      `            <gap name="OpenFilm tracks" offset="0s" start="0s" duration="${rational(composition.duration)}">`,
      `              <spine lane="1" offset="0s">\n${primaryChildren}\n              </spine>`,
      ...connected,
      "            </gap>",
    );
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE fcpxml>\n<fcpxml version="1.10">\n  <resources>\n    <format id="r1" name="OpenFilm ${settings.width}x${settings.height}" frameDuration="${denominator}/${numerator}s" width="${settings.width}" height="${settings.height}"/>\n${resourceLines.join("\n")}\n  </resources>\n  <library>\n    <event name="OpenFilm">\n      <project name="${xml(composition.id)}">\n        <sequence format="r1" duration="${rational(composition.duration)}" tcStart="0s" tcFormat="NDF" audioLayout="stereo" audioRate="48k">\n          <spine>\n${spine.join("\n")}\n          </spine>\n        </sequence>\n      </project>\n    </event>\n  </library>\n</fcpxml>\n`;
}

function edl(
  composition: Composition,
  assets: Map<string, MediaAsset>,
  settings: ProjectSettings,
): string {
  const populated = composition.tracks.filter((track) => track.clips.length);
  if (populated.length !== 1 || populated[0]!.type !== "video")
    throw new Error(
      "EDL supports one video cut track. Use OTIO, FCPXML, or JSON for multiple tracks/audio.",
    );
  if (!Number.isInteger(settings.frameRate) || settings.frameRate > 60)
    throw new Error(
      "EDL export currently supports integer non-drop frame rates up to 60 fps. Use OTIO or FCPXML for fractional rates.",
    );
  const rate = settings.frameRate;
  const code = (seconds: number): string => {
    const frames = Math.round(seconds * rate);
    if (Math.abs(frames / rate - seconds) > 1e-6)
      throw new Error(
        "EDL cannot preserve sub-frame clip boundaries. Align edits to frames or use OTIO/FCPXML/JSON.",
      );
    if (seconds >= 86400)
      throw new Error(
        "EDL timecodes must fit within 24 hours. Use OTIO or FCPXML.",
      );
    return [
      Math.floor(frames / (rate * 3600)),
      Math.floor(frames / (rate * 60)) % 60,
      Math.floor(frames / rate) % 60,
      frames % rate,
    ]
      .map((value) => String(value).padStart(2, "0"))
      .join(":");
  };
  const lines = [
    `TITLE: ${composition.id.replace(/[\r\n]/g, " ")}`,
    "FCM: NON-DROP FRAME",
    "",
  ];
  let event = 0,
    end = 0;
  const gap = (start: number, duration: number): void => {
    if (duration <= 1e-6) return;
    if (++event > 999)
      throw new Error(
        "CMX3600 EDL supports at most 999 events; use OTIO or FCPXML.",
      );
    lines.push(
      `${String(event).padStart(3, "0")}  BL       V     C        ${code(0)} ${code(duration)} ${code(start)} ${code(start + duration)}`,
      "* BLACK GAP",
      "",
    );
  };
  sortedClips(populated[0]!).forEach((clip, index) => {
    const asset = assets.get(clip.assetId)!;
    if (asset.mediaType !== "video" && asset.mediaType !== "360-video")
      throw new Error(
        "EDL cannot describe still-image holds. Use OTIO, FCPXML, or JSON for images.",
      );
    gap(end, clip.timelineStart - end);
    if (++event > 999)
      throw new Error(
        "CMX3600 EDL supports at most 999 events; use OTIO or FCPXML.",
      );
    const reel = `R${String(index + 1).padStart(7, "0")}`;
    lines.push(
      `${String(event).padStart(3, "0")}  ${reel} V     C        ${code(clip.sourceIn ?? 0)} ${code((clip.sourceIn ?? 0) + clip.timelineDuration)} ${code(clip.timelineStart)} ${code(clip.timelineStart + clip.timelineDuration)}`,
      `* FROM CLIP NAME: ${asset.name.replace(/[\r\n]/g, " ")}`,
      `* SOURCE FILE: ${asset.uri.replace(/[\r\n]/g, " ")}`,
      "",
    );
    end = clip.timelineStart + clip.timelineDuration;
  });
  gap(end, composition.duration - end);
  return lines.join("\n");
}
