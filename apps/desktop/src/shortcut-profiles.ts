import { computed, ref, shallowRef } from "vue";

export type ShortcutScope = "source" | "record" | "timeline";
export type ShortcutModifier = "alt";
export const shortcutActionIds = [
  "source.playPause",
  "source.shuttleReverse",
  "source.stop",
  "source.shuttleForward",
  "source.stepBackward",
  "source.stepForward",
  "source.markIn",
  "source.markOut",
  "source.seekIn",
  "source.seekOut",
  "source.split",
  "source.addMarker",
  "record.playPause",
  "record.shuttleReverse",
  "record.stop",
  "record.shuttleForward",
  "record.stepBackward",
  "record.stepForward",
  "record.previousEdit",
  "record.nextEdit",
  "record.seekStart",
  "record.seekEnd",
  "record.split",
  "record.insert",
  "record.overwrite",
  "record.lift",
  "timeline.playPause",
  "timeline.delete",
  "timeline.deleteBackward",
  "timeline.lift",
  "timeline.slipBackward",
  "timeline.slipForward",
  "timeline.slideBackward",
  "timeline.slideForward",
  "timeline.stepBackward",
  "timeline.stepForward",
  "timeline.toggleGuides",
] as const;
export type ShortcutActionId = (typeof shortcutActionIds)[number];
export interface ShortcutBinding {
  code: string;
  modifiers: readonly ShortcutModifier[];
}
export interface ShortcutProfile {
  version: 1;
  name: string;
  bindings: Readonly<Record<ShortcutActionId, ShortcutBinding>>;
}
export interface ShortcutKeyEvent {
  code: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}
export interface ShortcutConflict {
  scope: ShortcutScope;
  code: string;
  modifiers: readonly ShortcutModifier[];
  actions: readonly ShortcutActionId[];
}

const profileFormat = "openfilm-shortcut-profile";
const maxProfileBytes = 16 * 1024;
const maxImportedProfiles = 16;
export const shortcutProfilesStorageKey = "openfilm.shortcut-profiles.v1";
const defaultBindings: Record<ShortcutActionId, ShortcutBinding> = {
  "source.playPause": { code: "Space", modifiers: [] },
  "source.shuttleReverse": { code: "KeyJ", modifiers: [] },
  "source.stop": { code: "KeyK", modifiers: [] },
  "source.shuttleForward": { code: "KeyL", modifiers: [] },
  "source.stepBackward": { code: "ArrowLeft", modifiers: [] },
  "source.stepForward": { code: "ArrowRight", modifiers: [] },
  "source.markIn": { code: "KeyI", modifiers: [] },
  "source.markOut": { code: "KeyO", modifiers: [] },
  "source.seekIn": { code: "Home", modifiers: [] },
  "source.seekOut": { code: "End", modifiers: [] },
  "source.split": { code: "KeyB", modifiers: [] },
  "source.addMarker": { code: "KeyM", modifiers: [] },
  "record.playPause": { code: "Space", modifiers: [] },
  "record.shuttleReverse": { code: "KeyJ", modifiers: [] },
  "record.stop": { code: "KeyK", modifiers: [] },
  "record.shuttleForward": { code: "KeyL", modifiers: [] },
  "record.stepBackward": { code: "ArrowLeft", modifiers: [] },
  "record.stepForward": { code: "ArrowRight", modifiers: [] },
  "record.previousEdit": { code: "ArrowUp", modifiers: [] },
  "record.nextEdit": { code: "ArrowDown", modifiers: [] },
  "record.seekStart": { code: "Home", modifiers: [] },
  "record.seekEnd": { code: "End", modifiers: [] },
  "record.split": { code: "KeyB", modifiers: [] },
  "record.insert": { code: "Comma", modifiers: [] },
  "record.overwrite": { code: "Period", modifiers: [] },
  "record.lift": { code: "Semicolon", modifiers: [] },
  "timeline.playPause": { code: "Space", modifiers: [] },
  "timeline.delete": { code: "Delete", modifiers: [] },
  "timeline.deleteBackward": { code: "Backspace", modifiers: [] },
  "timeline.lift": { code: "Semicolon", modifiers: [] },
  "timeline.slipBackward": { code: "BracketLeft", modifiers: [] },
  "timeline.slipForward": { code: "BracketRight", modifiers: [] },
  "timeline.slideBackward": { code: "BracketLeft", modifiers: ["alt"] },
  "timeline.slideForward": { code: "BracketRight", modifiers: ["alt"] },
  "timeline.stepBackward": { code: "ArrowLeft", modifiers: [] },
  "timeline.stepForward": { code: "ArrowRight", modifiers: [] },
  "timeline.toggleGuides": { code: "KeyG", modifiers: [] },
};

export const defaultShortcutProfile: ShortcutProfile = {
  version: 1,
  name: "OpenFilm Default",
  bindings: defaultBindings,
};

const supportedCodes = new Set([
  "Space",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
  "Delete",
  "Backspace",
  "Tab",
  "Comma",
  "Period",
  "Semicolon",
  "BracketLeft",
  "BracketRight",
  ...Array.from(
    { length: 26 },
    (_, index) => `Key${String.fromCharCode(65 + index)}`,
  ),
  ...Array.from({ length: 10 }, (_, index) => `Digit${index}`),
]);
const reservedAltCodes = new Set([
  "Tab",
  "Escape",
  "F4",
  "Space",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new Error(`Unsupported ${label} field.`);
}

function actionScope(action: ShortcutActionId): ShortcutScope {
  return action.slice(0, action.indexOf(".")) as ShortcutScope;
}

function parseBinding(value: unknown): ShortcutBinding {
  if (!isRecord(value)) throw new Error("Invalid shortcut binding.");
  exactKeys(value, ["code", "modifiers"], "shortcut binding");
  if (typeof value.code !== "string" || !supportedCodes.has(value.code))
    throw new Error("Unsupported shortcut key code.");
  if (!Array.isArray(value.modifiers))
    throw new Error("Invalid shortcut modifiers.");
  if (
    value.modifiers.some((modifier) => modifier !== "alt") ||
    new Set(value.modifiers).size !== value.modifiers.length
  )
    throw new Error("Unsupported shortcut modifier.");
  const modifiers = [...value.modifiers] as ShortcutModifier[];
  if (
    value.code === "Tab" ||
    (modifiers.includes("alt") && reservedAltCodes.has(value.code))
  )
    throw new Error("Reserved browser or operating-system shortcut.");
  return { code: value.code, modifiers };
}

function bindingKey(binding: ShortcutBinding): string {
  return `${binding.modifiers.join("+")}+${binding.code}`;
}

function detectShortcutConflicts(
  bindings: Readonly<Partial<Record<ShortcutActionId, ShortcutBinding>>>,
): ShortcutConflict[] {
  const seen = new Map<string, ShortcutActionId[]>();
  for (const action of shortcutActionIds) {
    const binding = bindings[action];
    if (!binding) continue;
    const scope = actionScope(action);
    const key = `${scope}:${bindingKey(binding)}`;
    const actions = seen.get(key) ?? [];
    actions.push(action);
    seen.set(key, actions);
  }
  return [...seen.entries()]
    .filter(([, actions]) => actions.length > 1)
    .map(([key, actions]) => {
      const binding = bindings[actions[0]!]!;
      return {
        scope: key.slice(0, key.indexOf(":")) as ShortcutScope,
        code: binding.code,
        modifiers: binding.modifiers,
        actions,
      };
    });
}

export function parseShortcutProfile(serialized: string): ShortcutProfile {
  if (
    typeof serialized !== "string" ||
    new TextEncoder().encode(serialized).byteLength > maxProfileBytes
  )
    throw new Error("Shortcut profile exceeds the 16 KiB import limit.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized) as unknown;
  } catch {
    throw new Error("Shortcut profile is not valid JSON.");
  }
  if (!isRecord(parsed)) throw new Error("Invalid shortcut profile.");
  exactKeys(parsed, ["format", "version", "name", "bindings"], "profile");
  if (parsed.format !== profileFormat || parsed.version !== 1)
    throw new Error("Unsupported shortcut profile format or version.");
  if (
    typeof parsed.name !== "string" ||
    !parsed.name.trim() ||
    parsed.name.trim().length > 64 ||
    [...parsed.name].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 0x1f || codePoint === 0x7f;
    })
  )
    throw new Error(
      "Shortcut profile name must contain 1 to 64 printable characters.",
    );
  if (!isRecord(parsed.bindings))
    throw new Error("Shortcut profile bindings must be an object.");

  const bindings: Record<ShortcutActionId, ShortcutBinding> = {
    ...defaultBindings,
  };
  for (const [action, binding] of Object.entries(parsed.bindings)) {
    if (!shortcutActionIds.includes(action as ShortcutActionId))
      throw new Error(`Unsupported shortcut action: ${action}.`);
    bindings[action as ShortcutActionId] = parseBinding(binding);
  }
  const conflicts = detectShortcutConflicts(bindings);
  if (conflicts.length) {
    const conflict = conflicts[0]!;
    throw new Error(
      `Shortcut conflict in ${conflict.scope}: ${conflict.actions.join(", ")}.`,
    );
  }
  return {
    version: 1,
    name: parsed.name.trim(),
    bindings,
  };
}

export function serializeShortcutProfile(profile: ShortcutProfile): string {
  const bindings: Record<string, ShortcutBinding> = {};
  for (const action of shortcutActionIds)
    bindings[action] = profile.bindings[action];
  const validated = parseShortcutProfile(
    JSON.stringify({
      format: profileFormat,
      version: profile.version,
      name: profile.name,
      bindings,
    }),
  );
  return `${JSON.stringify(
    {
      format: profileFormat,
      version: 1,
      name: validated.name,
      bindings: Object.fromEntries(
        shortcutActionIds.map((action) => [action, validated.bindings[action]]),
      ),
    },
    null,
    2,
  )}\n`;
}

export function resolveShortcutAction(
  profile: ShortcutProfile,
  scope: ShortcutScope,
  event: ShortcutKeyEvent,
): ShortcutActionId | null {
  if (event.ctrlKey || event.metaKey) return null;
  const modifiers = event.altKey ? ["alt"] : [];
  for (const action of shortcutActionIds) {
    if (actionScope(action) !== scope) continue;
    const binding = profile.bindings[action];
    if (
      binding.code === event.code &&
      binding.modifiers.length === modifiers.length &&
      binding.modifiers.every((modifier) => modifiers.includes(modifier))
    )
      return action;
  }
  return null;
}

export function formatShortcutBinding(binding: ShortcutBinding): string {
  const symbols: Readonly<Record<string, string>> = {
    Space: "Space",
    ArrowLeft: "←",
    ArrowRight: "→",
    ArrowUp: "↑",
    ArrowDown: "↓",
    Comma: ",",
    Period: ".",
    Semicolon: ";",
    BracketLeft: "[",
    BracketRight: "]",
  };
  const key =
    symbols[binding.code] ??
    (binding.code.startsWith("Key") ? binding.code.slice(3) : binding.code);
  return [
    ...binding.modifiers.map((modifier) =>
      modifier === "alt" ? "Alt" : modifier,
    ),
    key,
  ].join(" + ");
}

interface StoredProfile {
  id: string;
  profile: ShortcutProfile;
}

function loadStoredProfiles(): {
  activeId: string;
  profiles: StoredProfile[];
} {
  try {
    const raw = globalThis.localStorage?.getItem(shortcutProfilesStorageKey);
    if (!raw || new TextEncoder().encode(raw).byteLength > 512 * 1024)
      return { activeId: "default", profiles: [] };
    const parsed: unknown = JSON.parse(raw);
    if (
      !isRecord(parsed) ||
      parsed.version !== 1 ||
      typeof parsed.activeId !== "string" ||
      !Array.isArray(parsed.profiles)
    )
      return { activeId: "default", profiles: [] };
    const profiles: StoredProfile[] = [];
    const ids = new Set<string>();
    for (const entry of parsed.profiles.slice(0, maxImportedProfiles)) {
      if (
        !isRecord(entry) ||
        typeof entry.id !== "string" ||
        !/^custom-[a-z0-9-]{1,80}$/.test(entry.id) ||
        ids.has(entry.id)
      )
        continue;
      try {
        const profile = parseShortcutProfile(JSON.stringify(entry.profile));
        profiles.push({ id: entry.id, profile });
        ids.add(entry.id);
      } catch {
        /* Ignore a stored profile that no longer satisfies the current contract. */
      }
    }
    return {
      activeId:
        parsed.activeId === "default" || ids.has(parsed.activeId)
          ? parsed.activeId
          : "default",
      profiles,
    };
  } catch {
    return { activeId: "default", profiles: [] };
  }
}

const stored = loadStoredProfiles();
const savedProfiles = shallowRef(stored.profiles);
const activeId = ref(stored.activeId);
let profileCounter = 0;

export const activeShortcutProfileId = computed(() => activeId.value);
export const activeShortcutProfile = computed(
  () =>
    savedProfiles.value.find((item) => item.id === activeId.value)?.profile ??
    defaultShortcutProfile,
);

export function listShortcutProfiles(): readonly {
  id: string;
  name: string;
}[] {
  return [
    { id: "default", name: defaultShortcutProfile.name },
    ...savedProfiles.value.map(({ id, profile }) => ({
      id,
      name: profile.name,
    })),
  ];
}

function persistProfiles(): void {
  try {
    globalThis.localStorage?.setItem(
      shortcutProfilesStorageKey,
      JSON.stringify({
        version: 1,
        activeId: activeId.value,
        profiles: savedProfiles.value.map(({ id, profile }) => ({
          id,
          profile: JSON.parse(serializeShortcutProfile(profile)) as unknown,
        })),
      }),
    );
  } catch {
    /* An active session profile remains usable when private storage is unavailable. */
  }
}

export function importShortcutProfile(serialized: string): StoredProfile {
  const profile = parseShortcutProfile(serialized);
  if (savedProfiles.value.length >= maxImportedProfiles)
    throw new Error("A maximum of 16 imported shortcut profiles is supported.");
  profileCounter += 1;
  const id = `custom-${Date.now().toString(36)}-${profileCounter.toString(36)}`;
  const imported = { id, profile };
  savedProfiles.value = [...savedProfiles.value, imported];
  persistProfiles();
  return imported;
}

export function setActiveShortcutProfile(id: string): void {
  if (id !== "default" && !savedProfiles.value.some((item) => item.id === id))
    return;
  activeId.value = id;
  persistProfiles();
}

export function removeShortcutProfile(id: string): void {
  if (id === "default") return;
  const next = savedProfiles.value.filter((item) => item.id !== id);
  if (next.length === savedProfiles.value.length) return;
  savedProfiles.value = next;
  if (activeId.value === id) activeId.value = "default";
  persistProfiles();
}
