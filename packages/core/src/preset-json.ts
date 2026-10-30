// SPDX-License-Identifier: Apache-2.0
import {
  PRESET_LIMITS,
  presetInvalid,
  validatePresetPackage,
  type PresetPackageV1,
} from "./presets.js";
/** Lexical preflight only; JSON.parse remains the JSON grammar authority. */
export function parsePresetPackage(
  document: string | Uint8Array,
): PresetPackageV1 {
  const bytes =
    typeof document === "string"
      ? new TextEncoder().encode(document)
      : document;
  if (bytes.byteLength > PRESET_LIMITS.packageBytes)
    presetInvalid("document", "package byte budget exceeded");
  let text: string;
  try {
    text =
      typeof document === "string"
        ? document
        : new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    presetInvalid("document", "invalid UTF-8");
  }
  if (text.charCodeAt(0) === 0xfeff)
    presetInvalid("document", "UTF-8 BOM is unsupported");
  const stack: { kind: string; keys: Set<string> }[] = [];
  let tokens = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (/[\s,:]/.test(c)) continue;
    if (c === "{" || c === "[") {
      stack.push({ kind: c, keys: new Set() });
      if (stack.length > PRESET_LIMITS.depth)
        presetInvalid("document", "depth budget exceeded");
      tokens++;
    } else if (c === "}" || c === "]") {
      const s = stack.pop();
      if (!s || s.kind !== (c === "}" ? "{" : "["))
        presetInvalid("document", "invalid JSON containers");
    } else if (c === '"') {
      const start = i;
      let closed = false;
      for (i++; i < text.length; i++) {
        if (text[i] === "\\") {
          i++;
          continue;
        }
        if (text[i] === '"') {
          closed = true;
          break;
        }
      }
      if (!closed) presetInvalid("document", "unterminated JSON string");
      let next = i + 1;
      while (/\s/.test(text[next] ?? "x")) next++;
      if (text[next] === ":" && stack.at(-1)?.kind === "{") {
        let key: string;
        try {
          key = JSON.parse(text.slice(start, i + 1)) as string;
        } catch {
          presetInvalid("document", "invalid JSON key");
        }
        const keys = stack.at(-1)!.keys;
        if (keys.has(key)) presetInvalid("document", "duplicate JSON key");
        keys.add(key);
      }
      tokens++;
    } else {
      while (i + 1 < text.length && !/[\s,\[\]{}:"]/.test(text[i + 1]!)) i++;
      tokens++;
    }
    if (tokens > PRESET_LIMITS.tokens)
      presetInvalid("document", "token budget exceeded");
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    presetInvalid("document", "invalid JSON");
  }
  return validatePresetPackage(value);
}
