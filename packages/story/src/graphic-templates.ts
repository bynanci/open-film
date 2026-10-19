import {
  GRAPHIC_SCENE_LIMITS,
  GRAPHIC_SCENE_TEMPLATE_LIMITS,
  graphicSceneTemplateSourceLabel,
  validateGraphicSceneTemplates,
  validateGraphicScenes,
  type ConversationCardTemplateRecord,
  type GraphicNode,
  type GraphicScene,
  type GraphicSceneTemplateRecord,
  type PhotoRelationshipTemplateRecord,
  type ProjectContentLocale,
  type RouteStoryTemplateRecord,
} from "@openfilm/core";

export interface GraphicTemplateFrame {
  width: number;
  height: number;
}
interface SceneOptions {
  sceneId: string;
  start?: number;
  duration: number;
  frame: GraphicTemplateFrame;
  locale?: ProjectContentLocale;
}
interface ConversationSource {
  originalText: string;
  citation: string;
  attribution: "quoted" | "excerpt" | "adapted";
  excerpt?: { start: number; end: number };
}
export interface ConversationCardMessage {
  id: string;
  speaker: string;
  text: string;
  start?: number;
  end?: number;
  source?: ConversationSource;
}
export interface ConversationCardOptions extends SceneOptions {
  locale?: ProjectContentLocale;
  messages: ConversationCardMessage[];
}
export interface BuiltGraphicScene<T extends GraphicSceneTemplateRecord> {
  scene: GraphicScene;
  record: T;
}
export interface GpxCoordinate {
  latitude: number;
  longitude: number;
}
export interface GpxWaypoint extends GpxCoordinate {
  label: string;
}
export interface ParsedGpxRoute {
  fileName: string;
  sha256: string;
  trackName?: string;
  points: GpxCoordinate[];
  waypoints: GpxWaypoint[];
}
export interface RouteStoryOptions extends SceneOptions {
  locale?: ProjectContentLocale;
  route:
    | ParsedGpxRoute
    | {
        kind: "manual";
        points: GpxCoordinate[];
        waypoints?: GpxWaypoint[];
      };
}
export interface PhotoRelationshipPhoto {
  assetId: string;
  contentHash?: string;
  focalPoint?: { x: number; y: number };
  protectedRegion?: { x: number; y: number; width: number; height: number };
}
export interface PhotoRelationshipOptions extends SceneOptions {
  relationship: "focus-reveal" | "compare" | "bookends";
  photos: PhotoRelationshipPhoto[];
}

function bad(message: string): never {
  throw new Error(message);
}

function dimensions(options: SceneOptions): { start: number; end: number } {
  const start = options.start ?? 0;
  const end = start + options.duration;
  if (
    !Number.isFinite(start) ||
    start < 0 ||
    !Number.isFinite(options.duration) ||
    options.duration <= 0 ||
    !Number.isInteger(options.frame.width) ||
    options.frame.width <= 0 ||
    !Number.isInteger(options.frame.height) ||
    options.frame.height <= 0 ||
    options.frame.width * options.frame.height > GRAPHIC_SCENE_LIMITS.pixels ||
    options.frame.width > GRAPHIC_SCENE_LIMITS.dimension ||
    options.frame.height > GRAPHIC_SCENE_LIMITS.dimension ||
    options.sceneId.length > 100 ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/u.test(options.sceneId)
  )
    bad(
      "Provide a stable scene ID, positive duration and supported frame size.",
    );
  return { start, end };
}

function baseScene(
  options: SceneOptions,
  name: string,
  nodes: GraphicNode[],
): GraphicScene {
  const { start } = dimensions(options);
  const scene: GraphicScene = {
    version: 1,
    id: options.sceneId,
    name,
    start,
    duration: options.duration,
    zIndex: 0,
    nodes,
  };
  return validateGraphicScenes([scene], start + options.duration)[0]!;
}

function assertId(id: string): void {
  if (id.length > 96 || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/u.test(id))
    bad("Template object IDs must be stable identifiers.");
}

function textNode(
  id: string,
  text: string,
  bounds: { x: number; y: number; width: number; height: number },
  start: number,
  end: number,
  fontSize: number,
  zIndex: number,
): GraphicNode {
  return {
    id,
    type: "text",
    ...bounds,
    opacity: 1,
    zIndex,
    start,
    end,
    text,
    fontSize,
    fontWeight: 400,
    animation: {
      enter: {
        duration: Math.min(0.4, (end - start) / 3),
        easing: "ease-out",
        from: { opacity: 0, y: bounds.y + 18 },
      },
    },
  };
}

function estimatedTextLines(text: string, fontSize: number, width: number) {
  let lines = 0;
  for (const paragraph of text.split("\n")) {
    let used = 0;
    for (const character of Array.from(paragraph)) {
      const units =
        /\p{Mark}/u.test(character) ||
        character === "\u200d" ||
        character === "\ufe0e" ||
        character === "\ufe0f"
          ? 0
          : /\s/u.test(character)
            ? 0.4
            : /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Extended_Pictographic}\uFF01-\uFF60]/u.test(
                  character,
                )
              ? 1.1
              : /[WM@#%&]/u.test(character)
                ? 1
                : /[mw]/iu.test(character)
                  ? 0.9
                  : /[ilI.,'`:;|!]/u.test(character)
                    ? 0.4
                    : /[\p{Script=Latin}\p{Number}]/u.test(character)
                      ? 0.7
                      : 0.8;
      const advance = fontSize * units;
      if (used > 0 && used + advance > width) {
        lines++;
        used = 0;
      }
      used += advance;
    }
    lines++;
  }
  return Math.max(1, lines);
}

/** Keep template text inside its saved GraphicScene bounds before it reaches render. */
function fitTextFontSize(
  text: string,
  bounds: { width: number; height: number },
  preferred: number,
  path: string,
) {
  // Leave headroom for wider local glyphs, real word wrapping and the
  // renderer's measured ascent/descent. This is intentionally conservative;
  // the renderer remains the final authority when it shapes the saved text.
  for (let fontSize = preferred; fontSize >= 6; fontSize--) {
    const lines = estimatedTextLines(text, fontSize, bounds.width);
    const estimatedHeight = fontSize * (1.3 + Math.max(0, lines - 1) * 1.45);
    if (estimatedHeight <= bounds.height) return fontSize;
  }
  bad(
    `${path} is too long for this frame and message count. Shorten it or use a larger frame.`,
  );
}

function validateBuilt<T extends GraphicSceneTemplateRecord>(
  scene: GraphicScene,
  record: T,
): BuiltGraphicScene<T> {
  const scenes = validateGraphicScenes([scene], scene.start + scene.duration);
  const records = validateGraphicSceneTemplates([record], scenes);
  return { scene: scenes[0]!, record: records[0] as T };
}

const templateNames: Record<
  ProjectContentLocale,
  { conversation: string; route: string; photos: string }
> = {
  "en-US": {
    conversation: "Conversation Card",
    route: "Route Story",
    photos: "Photo Relationship",
  },
  "zh-TW": { conversation: "對話卡片", route: "路線故事", photos: "照片關係" },
  "ja-JP": {
    conversation: "会話カード",
    route: "ルートストーリー",
    photos: "写真のつながり",
  },
};

/** A local-only, source-aware text composition using ordinary GraphicScene nodes. */
export function createConversationCard(
  options: ConversationCardOptions,
): BuiltGraphicScene<ConversationCardTemplateRecord> {
  dimensions(options);
  const locale = options.locale ?? "en-US";
  const messages = options.messages;
  if (
    !Array.isArray(messages) ||
    messages.length < 1 ||
    messages.length > GRAPHIC_SCENE_TEMPLATE_LIMITS.messages
  )
    bad("Conversation cards need one to four messages.");
  const width = options.frame.width;
  const height = options.frame.height;
  const contentWidth = width * 0.76;
  const slotHeight = (height * 0.76) / messages.length;
  const nodes: GraphicNode[] = [
    {
      id: `${options.sceneId}.card`,
      type: "shape",
      shape: "rect",
      fill: "#172033",
      x: 0,
      y: 0,
      width: contentWidth,
      height: height * 0.76,
      opacity: 0.96,
      zIndex: 0,
      start: 0,
      end: options.duration,
    },
  ];
  const bindings: ConversationCardTemplateRecord["data"]["messages"] = [];
  const ids = new Set<string>();
  for (const [index, message] of messages.entries()) {
    assertId(message.id);
    if (ids.has(message.id)) bad("Conversation message IDs must be unique.");
    ids.add(message.id);
    if (
      typeof message.speaker !== "string" ||
      !message.speaker.trim() ||
      [...message.speaker].length > 128
    )
      bad("Each message needs a speaker label of at most 128 characters.");
    if (
      typeof message.text !== "string" ||
      !message.text.trim() ||
      [...message.text].length > GRAPHIC_SCENE_LIMITS.text ||
      message.text.split("\n").length > 8
    )
      bad(
        "Message text must fit the eight-line, 512-character GraphicScene limit.",
      );
    const slotStart = (options.duration * index) / messages.length;
    const slotEnd = (options.duration * (index + 1)) / messages.length;
    const start = message.start ?? slotStart;
    const end = message.end ?? slotEnd;
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 0 ||
      end > options.duration ||
      end <= start
    )
      bad("Message time must be inside the template scene.");
    const slotTop = -height * 0.38 + slotHeight * index;
    const speakerBounds = {
      x: -contentWidth * 0.43,
      y: slotTop + slotHeight * 0.12,
      width: contentWidth * 0.86,
      height: slotHeight * 0.24,
    };
    const textBounds = message.source
      ? {
          x: -contentWidth * 0.43,
          y: slotTop + slotHeight * 0.49,
          width: contentWidth * 0.86,
          height: slotHeight * 0.44,
        }
      : {
          x: -contentWidth * 0.43,
          y: slotTop + slotHeight * 0.6,
          width: contentWidth * 0.86,
          height: slotHeight * 0.7,
        };
    const speakerNodeId = `${options.sceneId}.${message.id}.speaker`;
    const textNodeId = `${options.sceneId}.${message.id}.text`;
    nodes.push(
      textNode(
        speakerNodeId,
        message.speaker,
        speakerBounds,
        start,
        end,
        fitTextFontSize(
          message.speaker,
          speakerBounds,
          Math.max(6, Math.round(height * 0.033)),
          "Speaker label",
        ),
        2 + index * 3,
      ),
    );
    nodes.push(
      textNode(
        textNodeId,
        message.text,
        textBounds,
        start,
        end,
        fitTextFontSize(
          message.text,
          textBounds,
          Math.max(6, Math.round(height * 0.048)),
          "Message text",
        ),
        3 + index * 3,
      ),
    );
    const binding: ConversationCardTemplateRecord["data"]["messages"][number] =
      {
        id: message.id,
        speakerNodeId,
        textNodeId,
      };
    if (message.source) {
      const source = structuredClone(message.source);
      const sourceLabelNodeId = `${options.sceneId}.${message.id}.source`;
      const label = graphicSceneTemplateSourceLabel(
        locale,
        source.attribution,
        source.citation,
      );
      nodes.push(
        textNode(
          sourceLabelNodeId,
          label,
          {
            x: -contentWidth * 0.43,
            y: slotTop + slotHeight * 0.86,
            width: contentWidth * 0.86,
            height: slotHeight * 0.22,
          },
          start,
          end,
          fitTextFontSize(
            label,
            { width: contentWidth * 0.86, height: slotHeight * 0.22 },
            Math.max(6, Math.round(height * 0.021)),
            "Source label",
          ),
          4 + index * 3,
        ),
      );
      binding.sourceLabelNodeId = sourceLabelNodeId;
      binding.source = source;
    }
    bindings.push(binding);
  }
  const scene = baseScene(options, templateNames[locale].conversation, nodes);
  return validateBuilt(scene, {
    version: 1,
    sceneId: scene.id,
    templateId: "conversation-card",
    data: { locale, messages: bindings },
  });
}

function xmlText(value: string): string {
  if (/&(?!#x[0-9a-f]+;|#[0-9]+;|(?:amp|lt|gt|quot|apos);)/iu.test(value))
    bad("GPX contains an unknown XML entity.");
  const decoded = value.replace(
    /&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos);/giu,
    (_match, entity: string) => {
      const named: Record<string, string> = {
        amp: "&",
        lt: "<",
        gt: ">",
        quot: '"',
        apos: "'",
      };
      if (entity[0] !== "#") return named[entity.toLowerCase()]!;
      const code =
        entity[1]?.toLowerCase() === "x"
          ? Number.parseInt(entity.slice(2), 16)
          : Number.parseInt(entity.slice(1), 10);
      if (
        !Number.isInteger(code) ||
        code <= 0 ||
        code > 0x10ffff ||
        (code >= 0xd800 && code <= 0xdfff)
      )
        bad("GPX contains an invalid XML character reference.");
      return String.fromCodePoint(code);
    },
  );
  return decoded;
}

function attributes(raw: string): Record<string, string> {
  const values: Record<string, string> = {};
  let remaining = raw.trim();
  while (remaining) {
    const match =
      /^([A-Za-z_][A-Za-z0-9_.:-]*)\s*=\s*("([^"]*)"|'([^']*)')\s*/u.exec(
        remaining,
      );
    if (!match) bad("GPX is not well-formed XML.");
    if (Object.hasOwn(values, match[1]!))
      bad("GPX contains a duplicate XML attribute.");
    values[match[1]!] = xmlText(match[3] ?? match[4] ?? "");
    remaining = remaining.slice(match[0].length);
  }
  return values;
}

function coordinate(
  latitude: string | undefined,
  longitude: string | undefined,
): GpxCoordinate {
  if (
    latitude === undefined ||
    longitude === undefined ||
    !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/u.test(latitude) ||
    !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/u.test(longitude)
  )
    bad("GPX route contains a malformed coordinate.");
  const lat = Number(latitude),
    lon = Number(longitude);
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    lat < -90 ||
    lat > 90 ||
    lon < -180 ||
    lon > 180
  )
    bad("GPX route contains a coordinate outside valid bounds.");
  return { latitude: lat, longitude: lon };
}

/** Parse selected GPX bytes only. DTDs/entities, external references and arbitrary XML declarations are rejected. */
export async function parseGpxRoute(
  bytes: Uint8Array,
  fileName: string,
): Promise<ParsedGpxRoute> {
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.byteLength > GRAPHIC_SCENE_TEMPLATE_LIMITS.gpxBytes
  )
    bad("Selected GPX exceeds the 4 MiB import limit.");
  if (
    !fileName ||
    fileName.length > 255 ||
    /[\\/]/u.test(fileName) ||
    fileName === "." ||
    fileName === ".."
  )
    bad("GPX source must have a file name without a path.");
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true })
      .decode(bytes)
      .replace(/^\uFEFF/u, "");
  } catch {
    return bad("GPX must be valid UTF-8 XML.");
  }
  if (/<!|<\?(?!xml\s)/iu.test(source))
    bad("GPX DTDs, entities and processing instructions are not accepted.");
  source = source.replace(
    /^\s*<\?xml\s+version\s*=\s*(["'])1\.[01]\1(?:\s+encoding\s*=\s*(["'])UTF-8\2)?\s*\?>/iu,
    "",
  );
  const tags = /<([^<>]+)>/gu;
  const stack: Array<{ name: string; text: string }> = [];
  const points: GpxCoordinate[] = [];
  const waypoints: GpxWaypoint[] = [];
  let root = false,
    rootClosed = false,
    trackCount = 0,
    segmentCount = 0,
    routeCount = 0;
  let trackName: string | undefined;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = tags.exec(source))) {
    const rawText = source.slice(last, match.index);
    if (rawText.includes(">")) bad("GPX is not well-formed XML.");
    const decodedText = xmlText(rawText);
    if (stack.length) stack.at(-1)!.text += decodedText;
    else if (decodedText.trim()) bad("GPX is not well-formed XML.");
    last = tags.lastIndex;
    const body = match[1]!.trim();
    if (!body || body.startsWith("!") || body.startsWith("?"))
      bad(
        "GPX DTDs, entities, comments and processing instructions are not accepted.",
      );
    const closing = body.startsWith("/");
    const selfClosing = !closing && body.endsWith("/");
    const content = body.replace(/^\//u, "").replace(/\/$/u, "").trim();
    const nameMatch = /^([A-Za-z_][A-Za-z0-9_.:-]*)(?:\s+([\s\S]*))?$/u.exec(
      content,
    );
    if (!nameMatch) bad("GPX is not well-formed XML.");
    const name = nameMatch[1]!;
    const local = name.split(":").at(-1)!.toLowerCase();
    if (closing) {
      if (nameMatch[2] || stack.at(-1)?.name !== name)
        bad("GPX is not well-formed XML.");
      const frame = stack.pop()!;
      const value = frame.text.trim();
      const parent = stack.at(-1);
      const parentLocal = parent?.name.split(":").at(-1)?.toLowerCase();
      if (local === "name" && parentLocal === "wpt" && value) {
        const point = (parent as unknown as { coordinate?: GpxCoordinate })
          .coordinate;
        if (point) {
          if (waypoints.length >= GRAPHIC_SCENE_TEMPLATE_LIMITS.waypoints)
            bad("GPX supports at most eight named waypoints.");
          if (value.length > 128)
            bad("GPX waypoint names may contain at most 128 characters.");
          waypoints.push({ ...point, label: value });
        }
      }
      if (
        local === "name" &&
        (parentLocal === "trk" || parentLocal === "rte") &&
        value &&
        trackName === undefined
      ) {
        if (value.length > 128)
          bad("GPX route names may contain at most 128 characters.");
        trackName = value;
      }
      if (local === "gpx") rootClosed = true;
      continue;
    }
    const attrs = attributes(nameMatch[2] ?? "");
    if (!root) {
      if (local !== "gpx") bad("GPX root element must be gpx.");
      root = true;
    } else if (rootClosed) bad("GPX is not well-formed XML.");
    if (local === "trk") trackCount++;
    if (local === "trkseg") segmentCount++;
    if (local === "rte") routeCount++;
    if (local === "trkpt" || local === "rtept") {
      const parentLocal = stack.at(-1)?.name.split(":").at(-1)?.toLowerCase();
      if (
        (local === "trkpt" && parentLocal !== "trkseg") ||
        (local === "rtept" && parentLocal !== "rte")
      )
        bad("GPX route points must belong to one track segment or one route.");
      points.push(coordinate(attrs.lat, attrs.lon));
    }
    const next = { name, text: "" } as {
      name: string;
      text: string;
      coordinate?: GpxCoordinate;
    };
    if (local === "wpt") next.coordinate = coordinate(attrs.lat, attrs.lon);
    if (!selfClosing) stack.push(next);
    else if (local === "gpx") rootClosed = true;
    else if (local === "trkseg" || local === "trk" || local === "rte") {
      /* Empty route containers are checked below. */
    }
  }
  const trailing = source.slice(last);
  if (
    trailing.includes("<") ||
    trailing.includes(">") ||
    xmlText(trailing).trim() ||
    stack.length ||
    !root ||
    !rootClosed
  )
    bad("GPX is not well-formed XML.");
  if (
    (!trackCount && !routeCount) ||
    trackCount > 1 ||
    segmentCount > 1 ||
    routeCount > 1 ||
    (trackCount && routeCount) ||
    (trackCount && segmentCount !== 1) ||
    (routeCount && segmentCount !== 0)
  )
    bad("GPX route must contain exactly one track segment or one route.");
  if (points.length < 2) bad("GPX must contain at least two route points.");
  const simplified =
    points.length <= GRAPHIC_SCENE_TEMPLATE_LIMITS.routePoints
      ? points
      : Array.from(
          { length: GRAPHIC_SCENE_TEMPLATE_LIMITS.routePoints },
          (_, index) =>
            points[
              Math.round(
                (index * (points.length - 1)) /
                  (GRAPHIC_SCENE_TEMPLATE_LIMITS.routePoints - 1),
              )
            ]!,
        );
  const digestInput = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const hash = await globalThis.crypto.subtle.digest("SHA-256", digestInput);
  const sha256 = [...new Uint8Array(hash)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  return {
    fileName,
    sha256,
    ...(trackName ? { trackName } : {}),
    points: simplified,
    waypoints,
  };
}

function mapCoordinates(
  points: readonly GpxCoordinate[],
  frame: GraphicTemplateFrame,
): Array<{ x: number; y: number }> {
  const lats = points.map((point) => point.latitude),
    lons = points.map((point) => point.longitude);
  const minLat = Math.min(...lats),
    maxLat = Math.max(...lats),
    minLon = Math.min(...lons),
    maxLon = Math.max(...lons);
  const padX = frame.width * 0.14,
    padY = frame.height * 0.16;
  const usableWidth = frame.width - padX * 2,
    usableHeight = frame.height - padY * 2;
  const spanLon = maxLon - minLon || 1,
    spanLat = maxLat - minLat || 1;
  const aspect = usableWidth / usableHeight;
  const routeAspect = spanLon / spanLat;
  const mapWidth =
    routeAspect > aspect ? usableWidth : usableHeight * routeAspect;
  const mapHeight =
    routeAspect > aspect ? usableWidth / routeAspect : usableHeight;
  const offsetX = (frame.width - mapWidth) / 2;
  const offsetY = (frame.height - mapHeight) / 2;
  return points.map((point) => ({
    x:
      offsetX +
      ((point.longitude - minLon) / spanLon) * mapWidth -
      frame.width / 2,
    y:
      frame.height / 2 -
      offsetY -
      ((point.latitude - minLat) / spanLat) * mapHeight,
  }));
}

const routeNames: Record<
  ProjectContentLocale,
  { imported: string; manual: string }
> = {
  "en-US": { imported: "Route Story", manual: "Manual Route Story" },
  "zh-TW": { imported: "路線故事", manual: "手動路線故事" },
  "ja-JP": { imported: "ルートストーリー", manual: "手動ルートストーリー" },
};

/** Create a deterministic path reveal from explicit GPX points or user-entered coordinates. */
export function createRouteStory(
  options: RouteStoryOptions,
): BuiltGraphicScene<RouteStoryTemplateRecord> {
  dimensions(options);
  const imported = "sha256" in options.route;
  const route = options.route;
  const points = route.points;
  const waypoints = "waypoints" in route ? route.waypoints : [];
  if (
    !Array.isArray(points) ||
    points.length < 2 ||
    points.length > GRAPHIC_SCENE_TEMPLATE_LIMITS.routePoints
  )
    bad("A route needs two to 32 explicit points.");
  if (
    !Array.isArray(waypoints) ||
    waypoints.length > GRAPHIC_SCENE_TEMPLATE_LIMITS.waypoints
  )
    bad("A route supports at most eight named waypoints.");
  const positions = mapCoordinates([...points, ...waypoints], options.frame);
  const nodes: GraphicNode[] = [];
  const routePoints: RouteStoryTemplateRecord["data"]["points"] = [];
  points.forEach((point, index) => {
    coordinate(String(point.latitude), String(point.longitude));
    const nodeId = `${options.sceneId}.point.${index + 1}`;
    const start = (options.duration * index) / points.length;
    nodes.push({
      id: nodeId,
      type: "shape",
      shape: "ellipse",
      fill: "#53d6c8",
      x: positions[index]!.x,
      y: positions[index]!.y,
      width: 22,
      height: 22,
      opacity: 1,
      zIndex: index,
      start,
      end: options.duration,
      animation: {
        enter: {
          duration: Math.min(0.3, (options.duration - start) / 3),
          easing: "ease-out",
          from: { opacity: 0 },
        },
      },
    });
    routePoints.push({
      nodeId,
      latitude: point.latitude,
      longitude: point.longitude,
    });
  });
  const waypointBindings: RouteStoryTemplateRecord["data"]["waypoints"] = [];
  waypoints.forEach((waypoint, index) => {
    coordinate(String(waypoint.latitude), String(waypoint.longitude));
    if (!waypoint.label.trim() || [...waypoint.label].length > 128)
      bad("Waypoint labels must contain at most 128 characters.");
    const markerNodeId = `${options.sceneId}.waypoint.${index + 1}.marker`;
    const labelNodeId = `${options.sceneId}.waypoint.${index + 1}.label`;
    const markerPosition = positions[points.length + index]!;
    const timeline = (options.duration * (index + 1)) / (waypoints.length + 1);
    nodes.push({
      id: markerNodeId,
      type: "shape",
      shape: "ellipse",
      fill: "#ffcf70",
      x: markerPosition.x,
      y: markerPosition.y,
      width: 30,
      height: 30,
      opacity: 1,
      zIndex: 40 + index,
      start: timeline,
      end: options.duration,
    });
    nodes.push(
      textNode(
        labelNodeId,
        waypoint.label,
        {
          x: markerPosition.x,
          y: markerPosition.y - 38,
          width: Math.min(options.frame.width * 0.3, 420),
          height: 44,
        },
        timeline,
        options.duration,
        Math.max(8, Math.round(options.frame.height * 0.026)),
        50 + index,
      ),
    );
    waypointBindings.push({
      id: `${options.sceneId}.waypoint.${index + 1}`,
      label: waypoint.label,
      latitude: waypoint.latitude,
      longitude: waypoint.longitude,
      markerNodeId,
      labelNodeId,
    });
  });
  const sceneName =
    routeNames[options.locale ?? "en-US"][imported ? "imported" : "manual"];
  const scene = baseScene(options, sceneName, nodes);
  const record: RouteStoryTemplateRecord = {
    version: 1,
    sceneId: scene.id,
    templateId: "route-story",
    data: {
      source: imported
        ? {
            kind: "gpx",
            fileName: (route as ParsedGpxRoute).fileName,
            sha256: (route as ParsedGpxRoute).sha256,
            ...((route as ParsedGpxRoute).trackName
              ? { trackName: (route as ParsedGpxRoute).trackName }
              : {}),
          }
        : { kind: "manual" },
      points: routePoints,
      waypoints: waypointBindings,
    },
  };
  return validateBuilt(scene, record);
}

function fitFocus(value: { x: number; y: number } | undefined): {
  x: number;
  y: number;
} {
  const point = value ?? { x: 0.5, y: 0.5 };
  if (
    ![point.x, point.y].every(
      (axis) => Number.isFinite(axis) && axis >= 0 && axis <= 1,
    )
  )
    bad("Photo focal points must be normalized inside the image.");
  return point;
}

/** Bind ordinary still-image nodes to explicit relationship and focus metadata. */
export function createPhotoRelationship(
  options: PhotoRelationshipOptions,
): BuiltGraphicScene<PhotoRelationshipTemplateRecord> {
  dimensions(options);
  const expected = options.relationship === "focus-reveal" ? 1 : 2;
  if (options.photos.length !== expected)
    bad("Choose the required number of photos for this relationship.");
  if (
    options.relationship === "compare" &&
    options.photos[0]!.assetId === options.photos[1]!.assetId
  )
    bad("A comparison requires two different photos.");
  const roles: PhotoRelationshipTemplateRecord["data"]["photos"][number]["role"][] =
    options.relationship === "focus-reveal"
      ? ["focus"]
      : options.relationship === "compare"
        ? ["left", "right"]
        : ["opening", "closing"];
  const imageBindings: PhotoRelationshipTemplateRecord["data"]["photos"] = [];
  const nodes: GraphicNode[] = [];
  options.photos.forEach((photo, index) => {
    if (!photo.assetId.trim()) bad("Choose a local catalog photo.");
    const focalPoint = fitFocus(photo.focalPoint);
    if (
      photo.contentHash !== undefined &&
      !/^[a-f0-9]{64}$/u.test(photo.contentHash)
    )
      bad("Photo source hash must be SHA-256.");
    const layout: PhotoRelationshipTemplateRecord["data"]["photos"][number]["layout"] =
      {
        preset: options.relationship === "compare" ? "contain" : "hero",
        focalPoint,
        ...(photo.protectedRegion
          ? { protectedRegion: structuredClone(photo.protectedRegion) }
          : {}),
      };
    const nodeId = `${options.sceneId}.photo.${index + 1}`;
    let x = 0,
      y = 0,
      width = options.frame.width,
      height = options.frame.height;
    let start = 0,
      end = options.duration;
    let animation: GraphicNode["animation"];
    if (options.relationship === "compare") {
      const gutter = Math.max(12, options.frame.width * 0.012);
      width = options.frame.width / 2 - gutter * 1.5;
      height = options.frame.height * 0.78;
      x = index === 0 ? -(width / 2 + gutter / 2) : width / 2 + gutter / 2;
      y = -options.frame.height * 0.04;
      animation = {
        enter: {
          duration: 0.6,
          easing: "ease-out",
          from: { opacity: 0, y: y + options.frame.height * 0.05 },
        },
      };
    } else if (options.relationship === "bookends") {
      start = index === 0 ? 0 : options.duration / 2;
      end = index === 0 ? options.duration / 2 : options.duration;
      animation = {
        enter: {
          duration: Math.min(0.7, (end - start) / 3),
          easing: "ease-in-out",
          from: { opacity: 0 },
        },
      };
    } else {
      const focusX = (focalPoint.x - 0.5) * options.frame.width;
      const focusY = (0.5 - focalPoint.y) * options.frame.height;
      animation = {
        enter: {
          duration: Math.min(0.9, options.duration / 3),
          easing: "ease-out",
          from: {
            x: focusX,
            y: focusY,
            width: options.frame.width * 0.28,
            height: options.frame.height * 0.28,
            opacity: 0.25,
          },
        },
      };
    }
    nodes.push({
      id: nodeId,
      type: "image",
      assetId: photo.assetId,
      x,
      y,
      width,
      height,
      opacity: 1,
      zIndex: index,
      start,
      end,
      animation,
    });
    imageBindings.push({
      role: roles[index]!,
      nodeId,
      assetId: photo.assetId,
      ...(photo.contentHash ? { contentHash: photo.contentHash } : {}),
      layout,
    });
  });
  const locale = options.locale ?? "en-US";
  const scene = baseScene(options, templateNames[locale].photos, nodes);
  return validateBuilt(scene, {
    version: 1,
    sceneId: scene.id,
    templateId: "photo-relationship",
    data: { relationship: options.relationship, photos: imageBindings },
  });
}
