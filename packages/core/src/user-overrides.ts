import type { OpenFilmProject } from "./models.js";
import { ProjectValidationError } from "./validation.js";

export const PINNED_PROJECT_SCHEMA_VERSION = "1.1.0" as const;
export type UserLockedAttribute =
  "inOutRange" | "photoDepth" | "motionPreset" | "timing";
export interface UserOverrideState {
  version: 1;
  isUserPinned: boolean;
  lockedAttributes: UserLockedAttribute[];
  /** Diagnostic signed frame delta, never applied to the saved start. */
  manualOffset?: number;
}
export type OverrideTarget =
  { kind: "clip"; clipId: string } | { kind: "graphic-scene"; sceneId: string };
const attributes: UserLockedAttribute[] = [
  "inOutRange",
  "photoDepth",
  "motionPreset",
  "timing",
];
export function validateUserOverrideState(
  value: unknown,
  owner: "clip" | "graphic-scene",
): UserOverrideState {
  const fail = (key: string, message: string): never => {
    throw new ProjectValidationError(`userOverrides${key}`, message);
  };
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    fail("", "expected a plain object");
  const data = value as Record<string, unknown>;
  const keys = Reflect.ownKeys(data);
  for (const key of keys) {
    if (
      typeof key !== "string" ||
      !["version", "isUserPinned", "lockedAttributes", "manualOffset"].includes(
        key,
      )
    )
      fail("", "unknown key");
    const descriptor = Object.getOwnPropertyDescriptor(data, key)!;
    if (!descriptor.enumerable || !("value" in descriptor))
      fail(`.${String(key)}`, "expected enumerable JSON data");
  }
  for (const key of ["version", "isUserPinned", "lockedAttributes"])
    if (!Object.hasOwn(data, key))
      fail(`.${key}`, "expected an own JSON field");
  if (data.version !== 1) fail(".version", "unsupported override version");
  if (typeof data.isUserPinned !== "boolean")
    fail(".isUserPinned", "expected a boolean");
  const list = data.lockedAttributes;
  if (
    !Array.isArray(list) ||
    Object.getPrototypeOf(list) !== Array.prototype ||
    list.length > 4
  )
    fail(".lockedAttributes", "expected at most four attributes");
  const values = list as unknown[];
  for (const key of Reflect.ownKeys(values)) {
    if (key === "length") continue;
    if (typeof key !== "string" || !/^[0-3]$/.test(key))
      fail(".lockedAttributes", "expected a dense JSON array");
    const descriptor = Object.getOwnPropertyDescriptor(values, key)!;
    if (!descriptor.enumerable || !("value" in descriptor))
      fail(".lockedAttributes", "expected JSON data");
  }
  const seen = new Set<UserLockedAttribute>();
  for (let i = 0; i < values.length; i++) {
    const entry = Object.getOwnPropertyDescriptor(values, String(i));
    if (!entry || !("value" in entry))
      fail(`.lockedAttributes[${i}]`, "expected a dense array");
    const attribute = entry!.value as UserLockedAttribute;
    if (
      !attributes.includes(attribute) ||
      (owner === "clip"
        ? attribute === "photoDepth"
        : attribute === "inOutRange" || attribute === "motionPreset") ||
      seen.has(attribute)
    )
      fail(`.lockedAttributes[${i}]`, "invalid or duplicate owner attribute");
    seen.add(attribute);
  }
  if (
    data.isUserPinned
      ? !seen.has("timing")
      : seen.size !== 0 || Object.hasOwn(data, "manualOffset")
  )
    fail(
      ".lockedAttributes",
      "pins require timing; unpinned state must be empty",
    );
  if (
    Object.hasOwn(data, "manualOffset") &&
    !Number.isSafeInteger(data.manualOffset)
  )
    fail(".manualOffset", "expected a signed safe integer frame offset");
  return {
    version: 1,
    isUserPinned: data.isUserPinned as boolean,
    lockedAttributes: attributes.filter((a) => seen.has(a)),
    ...(Object.hasOwn(data, "manualOffset")
      ? { manualOffset: data.manualOffset as number }
      : {}),
  };
}
export function hasUserOverrideState(project: OpenFilmProject): boolean {
  return project.timelines.some(
    (c) =>
      c.tracks.some((t) =>
        t.clips.some((clip) => Object.hasOwn(clip, "userOverrides")),
      ) || c.graphicScenes?.some((s) => Object.hasOwn(s, "userOverrides")),
  );
}
