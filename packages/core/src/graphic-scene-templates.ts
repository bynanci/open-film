import { ApplicationError } from "./errors.js";
import type { PhotoLayout, ProjectContentLocale } from "./models.js";
import type { GraphicNode, GraphicScene } from "./graphic-scenes.js";

export const GRAPHIC_SCENE_TEMPLATE_IDS = [
  "conversation-card",
  "route-story",
  "photo-relationship",
] as const;
export type GraphicSceneTemplateId =
  (typeof GRAPHIC_SCENE_TEMPLATE_IDS)[number];

export const GRAPHIC_SCENE_TEMPLATE_LIMITS = Object.freeze({
  records: 8,
  messages: 4,
  sourceText: 16_384,
  totalSourceText: 262_144,
  citation: 256,
  routePoints: 32,
  waypoints: 8,
  gpxBytes: 4 * 1024 * 1024,
});

export interface ConversationSourceRecord {
  originalText: string;
  citation: string;
  attribution: "quoted" | "excerpt" | "adapted";
  excerpt?: { start: number; end: number };
}
export interface ConversationMessageBinding {
  id: string;
  speakerNodeId: string;
  textNodeId: string;
  sourceLabelNodeId?: string;
  source?: ConversationSourceRecord;
}
export interface ConversationCardTemplateRecord {
  version: 1;
  sceneId: string;
  templateId: "conversation-card";
  data: {
    locale: ProjectContentLocale;
    messages: ConversationMessageBinding[];
  };
}
export interface RouteStoryPoint {
  nodeId: string;
  latitude: number;
  longitude: number;
}
export interface RouteStoryWaypoint {
  id: string;
  label: string;
  latitude: number;
  longitude: number;
  markerNodeId: string;
  labelNodeId: string;
}
export interface RouteStoryTemplateRecord {
  version: 1;
  sceneId: string;
  templateId: "route-story";
  data: {
    source:
      | { kind: "manual" }
      | {
          kind: "gpx";
          fileName: string;
          sha256: string;
          trackName?: string;
        };
    points: RouteStoryPoint[];
    waypoints: RouteStoryWaypoint[];
  };
}
export interface PhotoRelationshipImageBinding {
  role: "focus" | "left" | "right" | "opening" | "closing";
  nodeId: string;
  assetId: string;
  contentHash?: string;
  layout: Pick<PhotoLayout, "preset" | "focalPoint" | "protectedRegion">;
}
export interface PhotoRelationshipTemplateRecord {
  version: 1;
  sceneId: string;
  templateId: "photo-relationship";
  data: {
    relationship: "focus-reveal" | "compare" | "bookends";
    photos: PhotoRelationshipImageBinding[];
  };
}
export type GraphicSceneTemplateRecord =
  | ConversationCardTemplateRecord
  | RouteStoryTemplateRecord
  | PhotoRelationshipTemplateRecord;

function fail(path: string, message: string): never {
  throw new ApplicationError("graphics.invalid", `${path}: ${message}`, 400);
}
type Data = Record<string, unknown>;
function object(value: unknown, path: string, fields: readonly string[]): Data {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Object.getOwnPropertySymbols(value).length
  )
    fail(path, "expected a plain JSON object");
  for (const [key, descriptor] of Object.entries(
    Object.getOwnPropertyDescriptors(value),
  )) {
    if (!fields.includes(key)) fail(`${path}.${key}`, "unknown field");
    if (!("value" in descriptor) || !descriptor.enumerable)
      fail(`${path}.${key}`, "expected JSON data, not an accessor");
  }
  return value as Data;
}
function array(value: unknown, path: string, maximum: number): unknown[] {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length > maximum ||
    Reflect.ownKeys(value).some(
      (key) =>
        typeof key !== "string" ||
        (key !== "length" && !/^(0|[1-9]\d*)$/u.test(key)),
    )
  )
    fail(path, `expected an undecorated array with at most ${maximum} items`);
  for (let index = 0; index < value.length; index++)
    if (
      !Object.hasOwn(value, index) ||
      !Object.hasOwn(
        Object.getOwnPropertyDescriptor(value, String(index)) ?? {},
        "value",
      )
    )
      fail(path, "expected dense JSON array data");
  return value;
}
function string(
  value: unknown,
  path: string,
  maximum: number,
  allowLineBreaks = false,
): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > maximum ||
    [...value].some((character) => {
      const code = character.codePointAt(0)!;
      return (
        (code < 32 && !(allowLineBreaks && (code === 9 || code === 10))) ||
        code === 127 ||
        (code >= 0xd800 && code <= 0xdfff)
      );
    })
  )
    fail(
      path,
      `expected bounded literal text of at most ${maximum} characters`,
    );
  return value;
}
function identifier(value: unknown, path: string): string {
  const result = string(value, path, 128);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/u.test(result))
    fail(path, "expected a stable identifier");
  return result;
}
function point(
  value: unknown,
  path: string,
): { latitude: number; longitude: number } {
  const data = object(value, path, ["latitude", "longitude"]);
  if (
    typeof data.latitude !== "number" ||
    !Number.isFinite(data.latitude) ||
    data.latitude < -90 ||
    data.latitude > 90 ||
    typeof data.longitude !== "number" ||
    !Number.isFinite(data.longitude) ||
    data.longitude < -180 ||
    data.longitude > 180
  )
    fail(path, "latitude/longitude are outside valid coordinate bounds");
  return {
    latitude: data.latitude as number,
    longitude: data.longitude as number,
  };
}
function sceneNodes(scene: GraphicScene): Map<string, GraphicNode> {
  const nodes = new Map<string, GraphicNode>();
  const visit = (entries: readonly GraphicNode[]) => {
    for (const node of entries) {
      nodes.set(node.id, node);
      if (node.type === "group") visit(node.children);
    }
  };
  visit(scene.nodes);
  return nodes;
}
function requireNode<T extends GraphicNode["type"]>(
  nodes: ReadonlyMap<string, GraphicNode>,
  id: unknown,
  path: string,
  type: T,
): Extract<GraphicNode, { type: T }> {
  const key = identifier(id, path);
  const node = nodes.get(key);
  if (!node || node.type !== type) fail(path, `must reference a ${type} node`);
  return node as Extract<GraphicNode, { type: T }>;
}

export function graphicSceneTemplateSourceLabel(
  locale: ProjectContentLocale,
  attribution: ConversationSourceRecord["attribution"],
  citation: string,
): string {
  const prefix = {
    "en-US": {
      quoted: "Quoted from",
      excerpt: "Excerpt from",
      adapted: "Adapted from",
    },
    "zh-TW": { quoted: "原文", excerpt: "節錄自", adapted: "改寫自" },
    "ja-JP": { quoted: "引用元", excerpt: "抜粋元", adapted: "翻案元" },
  }[locale][attribution];
  return `${prefix} · ${citation}`;
}

/** Strict, bounded provenance data tied to already-admitted GraphicScene nodes. */
export function validateGraphicSceneTemplates(
  value: unknown,
  scenes: readonly GraphicScene[],
  knownAssets?: readonly string[],
): GraphicSceneTemplateRecord[] {
  if (value === undefined) return [];
  const entries = array(
    value,
    "graphicSceneTemplates",
    GRAPHIC_SCENE_TEMPLATE_LIMITS.records,
  );
  const byScene = new Map(scenes.map((scene) => [scene.id, scene]));
  const seenScenes = new Set<string>();
  const known = knownAssets ? new Set(knownAssets) : undefined;
  let sourceCharacters = 0;
  const validated: GraphicSceneTemplateRecord[] = [];
  for (const [index, raw] of entries.entries()) {
    const path = `graphicSceneTemplates[${index}]`;
    const entry = object(raw, path, [
      "version",
      "sceneId",
      "templateId",
      "data",
    ]);
    if (entry.version !== 1) fail(`${path}.version`, "unsupported version");
    const sceneId = identifier(entry.sceneId, `${path}.sceneId`);
    const scene = byScene.get(sceneId);
    if (!scene)
      fail(`${path}.sceneId`, "does not reference a saved GraphicScene");
    if (seenScenes.has(sceneId))
      fail(path, "duplicate template record for scene");
    seenScenes.add(sceneId);
    const nodes = sceneNodes(scene);
    if (entry.templateId === "conversation-card") {
      const data = object(entry.data, `${path}.data`, ["locale", "messages"]);
      const locales = ["en-US", "zh-TW", "ja-JP"];
      if (typeof data.locale !== "string" || !locales.includes(data.locale))
        fail(`${path}.data.locale`, "unsupported content locale");
      const messages = array(
        data.messages,
        `${path}.data.messages`,
        GRAPHIC_SCENE_TEMPLATE_LIMITS.messages,
      );
      if (!messages.length) fail(`${path}.data.messages`, "requires a message");
      const ids = new Set<string>();
      for (const [messageIndex, rawMessage] of messages.entries()) {
        const messagePath = `${path}.data.messages[${messageIndex}]`;
        const message = object(rawMessage, messagePath, [
          "id",
          "speakerNodeId",
          "textNodeId",
          "sourceLabelNodeId",
          "source",
        ]);
        const id = identifier(message.id, `${messagePath}.id`);
        if (ids.has(id)) fail(messagePath, "duplicate message ID");
        ids.add(id);
        requireNode(
          nodes,
          message.speakerNodeId,
          `${messagePath}.speakerNodeId`,
          "text",
        );
        const textNode = requireNode(
          nodes,
          message.textNodeId,
          `${messagePath}.textNodeId`,
          "text",
        );
        if (message.source !== undefined) {
          const source = object(message.source, `${messagePath}.source`, [
            "originalText",
            "citation",
            "attribution",
            "excerpt",
          ]);
          const originalText = string(
            source.originalText,
            `${messagePath}.source.originalText`,
            GRAPHIC_SCENE_TEMPLATE_LIMITS.sourceText,
            true,
          );
          sourceCharacters += originalText.length;
          if (sourceCharacters > GRAPHIC_SCENE_TEMPLATE_LIMITS.totalSourceText)
            fail(messagePath, "total source text limit exceeded");
          const citation = string(
            source.citation,
            `${messagePath}.source.citation`,
            GRAPHIC_SCENE_TEMPLATE_LIMITS.citation,
          );
          if (
            !["quoted", "excerpt", "adapted"].includes(
              String(source.attribution),
            )
          )
            fail(`${messagePath}.source.attribution`, "unknown attribution");
          let excerpt: { start: number; end: number } | undefined;
          if (source.excerpt !== undefined) {
            const range = object(
              source.excerpt,
              `${messagePath}.source.excerpt`,
              ["start", "end"],
            );
            if (
              !Number.isSafeInteger(range.start) ||
              !Number.isSafeInteger(range.end) ||
              (range.start as number) < 0 ||
              (range.end as number) <= (range.start as number) ||
              (range.end as number) > originalText.length
            )
              fail(
                `${messagePath}.source.excerpt`,
                "invalid source text range",
              );
            excerpt = {
              start: range.start as number,
              end: range.end as number,
            };
          }
          const attribution =
            source.attribution as ConversationSourceRecord["attribution"];
          if (
            attribution === "quoted" &&
            (excerpt || textNode.text !== originalText)
          )
            fail(
              `${messagePath}.source`,
              "quoted text must match the full original",
            );
          if (
            attribution === "excerpt" &&
            (!excerpt ||
              (excerpt.start === 0 && excerpt.end === originalText.length) ||
              textNode.text !== originalText.slice(excerpt.start, excerpt.end))
          )
            fail(
              `${messagePath}.source`,
              "excerpt must match its exact original range",
            );
          const labelId = identifier(
            message.sourceLabelNodeId,
            `${messagePath}.sourceLabelNodeId`,
          );
          const label = requireNode(
            nodes,
            labelId,
            `${messagePath}.sourceLabelNodeId`,
            "text",
          );
          if (
            label.text !==
            graphicSceneTemplateSourceLabel(
              data.locale as ProjectContentLocale,
              attribution,
              citation,
            )
          )
            fail(
              `${messagePath}.sourceLabelNodeId`,
              "source label is inconsistent",
            );
        } else if (message.sourceLabelNodeId !== undefined) {
          fail(
            `${messagePath}.sourceLabelNodeId`,
            "requires a source citation",
          );
        }
      }
      validated.push(
        structuredClone(entry) as unknown as ConversationCardTemplateRecord,
      );
      continue;
    }
    if (entry.templateId === "route-story") {
      const data = object(entry.data, `${path}.data`, [
        "source",
        "points",
        "waypoints",
      ]);
      const source = object(
        data.source,
        `${path}.data.source`,
        data.source &&
          typeof data.source === "object" &&
          "kind" in data.source &&
          (data.source as { kind?: unknown }).kind === "gpx"
          ? ["kind", "fileName", "sha256", "trackName"]
          : ["kind"],
      );
      if (source.kind !== "manual" && source.kind !== "gpx")
        fail(`${path}.data.source.kind`, "expected manual or gpx");
      if (source.kind === "gpx") {
        const fileName = string(
          source.fileName,
          `${path}.data.source.fileName`,
          255,
        );
        if (fileName === "." || fileName === ".." || /[\\/]/u.test(fileName))
          fail(
            `${path}.data.source.fileName`,
            "expected a file name without a path",
          );
        if (
          typeof source.sha256 !== "string" ||
          !/^[a-f0-9]{64}$/u.test(source.sha256)
        )
          fail(`${path}.data.source.sha256`, "expected a SHA-256 digest");
        if (source.trackName !== undefined)
          string(source.trackName, `${path}.data.source.trackName`, 128);
      }
      const points = array(
        data.points,
        `${path}.data.points`,
        GRAPHIC_SCENE_TEMPLATE_LIMITS.routePoints,
      );
      if (points.length < 2)
        fail(`${path}.data.points`, "route needs at least two points");
      const pointIds = new Set<string>();
      for (const [pointIndex, rawPoint] of points.entries()) {
        const pointPath = `${path}.data.points[${pointIndex}]`;
        const routePoint = object(rawPoint, pointPath, [
          "nodeId",
          "latitude",
          "longitude",
        ]);
        const nodeId = identifier(routePoint.nodeId, `${pointPath}.nodeId`);
        if (pointIds.has(nodeId)) fail(pointPath, "duplicate route point node");
        pointIds.add(nodeId);
        const routeNode = requireNode(
          nodes,
          nodeId,
          `${pointPath}.nodeId`,
          "shape",
        );
        if (routeNode.shape !== "ellipse")
          fail(`${pointPath}.nodeId`, "route point must be an ellipse");
        point(
          { latitude: routePoint.latitude, longitude: routePoint.longitude },
          pointPath,
        );
      }
      const waypoints = array(
        data.waypoints,
        `${path}.data.waypoints`,
        GRAPHIC_SCENE_TEMPLATE_LIMITS.waypoints,
      );
      const waypointIds = new Set<string>();
      for (const [waypointIndex, rawWaypoint] of waypoints.entries()) {
        const waypointPath = `${path}.data.waypoints[${waypointIndex}]`;
        const waypoint = object(rawWaypoint, waypointPath, [
          "id",
          "label",
          "latitude",
          "longitude",
          "markerNodeId",
          "labelNodeId",
        ]);
        const id = identifier(waypoint.id, `${waypointPath}.id`);
        if (waypointIds.has(id)) fail(waypointPath, "duplicate waypoint ID");
        waypointIds.add(id);
        string(waypoint.label, `${waypointPath}.label`, 128);
        point(
          { latitude: waypoint.latitude, longitude: waypoint.longitude },
          waypointPath,
        );
        const marker = requireNode(
          nodes,
          waypoint.markerNodeId,
          `${waypointPath}.markerNodeId`,
          "shape",
        );
        if (marker.shape !== "ellipse")
          fail(
            `${waypointPath}.markerNodeId`,
            "waypoint marker must be an ellipse",
          );
        const label = requireNode(
          nodes,
          waypoint.labelNodeId,
          `${waypointPath}.labelNodeId`,
          "text",
        );
        if (label.text !== waypoint.label)
          fail(`${waypointPath}.labelNodeId`, "waypoint label is inconsistent");
      }
      validated.push(
        structuredClone(entry) as unknown as RouteStoryTemplateRecord,
      );
      continue;
    }
    if (entry.templateId === "photo-relationship") {
      const data = object(entry.data, `${path}.data`, [
        "relationship",
        "photos",
      ]);
      const relationship = data.relationship;
      if (
        !["focus-reveal", "compare", "bookends"].includes(String(relationship))
      )
        fail(`${path}.data.relationship`, "unknown photo relationship");
      const expectedRoles =
        relationship === "focus-reveal"
          ? ["focus"]
          : relationship === "compare"
            ? ["left", "right"]
            : ["opening", "closing"];
      const photos = array(data.photos, `${path}.data.photos`, 2);
      if (photos.length !== expectedRoles.length)
        fail(`${path}.data.photos`, "photo count does not match relationship");
      const usedNodes = new Set<string>();
      const usedAssets = new Set<string>();
      for (const [photoIndex, rawPhoto] of photos.entries()) {
        const photoPath = `${path}.data.photos[${photoIndex}]`;
        const photo = object(rawPhoto, photoPath, [
          "role",
          "nodeId",
          "assetId",
          "contentHash",
          "layout",
        ]);
        if (photo.role !== expectedRoles[photoIndex])
          fail(
            `${photoPath}.role`,
            "photo role order does not match relationship",
          );
        const nodeId = identifier(photo.nodeId, `${photoPath}.nodeId`);
        if (usedNodes.has(nodeId)) fail(photoPath, "duplicate image node");
        usedNodes.add(nodeId);
        const assetId = identifier(photo.assetId, `${photoPath}.assetId`);
        const image = requireNode(
          nodes,
          nodeId,
          `${photoPath}.nodeId`,
          "image",
        );
        if (image.assetId !== assetId)
          fail(`${photoPath}.assetId`, "does not match its Image node");
        if (known && !known.has(assetId))
          fail(`${photoPath}.assetId`, "unknown image asset");
        usedAssets.add(assetId);
        if (
          photo.contentHash !== undefined &&
          (typeof photo.contentHash !== "string" ||
            !/^[a-f0-9]{64}$/u.test(photo.contentHash))
        )
          fail(`${photoPath}.contentHash`, "expected a SHA-256 digest");
        const layout = object(photo.layout, `${photoPath}.layout`, [
          "preset",
          "focalPoint",
          "protectedRegion",
        ]);
        if (layout.preset !== "contain" && layout.preset !== "hero")
          fail(`${photoPath}.layout.preset`, "expected contain or hero");
        if (layout.focalPoint !== undefined) {
          const focal = object(
            layout.focalPoint,
            `${photoPath}.layout.focalPoint`,
            ["x", "y"],
          );
          if (
            ![focal.x, focal.y].every(
              (item) =>
                typeof item === "number" &&
                Number.isFinite(item) &&
                item >= 0 &&
                item <= 1,
            )
          )
            fail(
              `${photoPath}.layout.focalPoint`,
              "coordinates must be between 0 and 1",
            );
        }
        if (layout.protectedRegion !== undefined) {
          const region = object(
            layout.protectedRegion,
            `${photoPath}.layout.protectedRegion`,
            ["x", "y", "width", "height"],
          );
          if (
            ![region.x, region.y, region.width, region.height].every(
              (item) => typeof item === "number" && Number.isFinite(item),
            )
          )
            fail(
              `${photoPath}.layout.protectedRegion`,
              "expected finite region values",
            );
          const { x, y, width, height } = region as {
            x: number;
            y: number;
            width: number;
            height: number;
          };
          if (
            x < 0 ||
            y < 0 ||
            width <= 0 ||
            height <= 0 ||
            x + width > 1 + 1e-9 ||
            y + height > 1 + 1e-9
          )
            fail(
              `${photoPath}.layout.protectedRegion`,
              "region must fit inside the image",
            );
        }
      }
      if (relationship === "compare" && usedAssets.size !== 2)
        fail(`${path}.data.photos`, "comparison requires two different photos");
      validated.push(
        structuredClone(entry) as unknown as PhotoRelationshipTemplateRecord,
      );
      continue;
    }
    fail(`${path}.templateId`, "unknown story template");
  }
  return validated;
}

/** Returns a cloned node map for callers that need safe template-aware edits. */
export function graphicSceneTemplateNodes(
  scene: GraphicScene,
): Map<string, GraphicNode> {
  return sceneNodes(scene);
}
