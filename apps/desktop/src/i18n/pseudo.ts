import type { MessageTree } from "./coverage";

/** Preserve interpolation and plural syntax while stressing real label widths. */
export function pseudoText(value: string): string {
  const accents: Record<string, string> = {
    a: "á",
    e: "ë",
    i: "ï",
    o: "ø",
    u: "ü",
    A: "Á",
    E: "Ë",
    I: "Ï",
    O: "Ø",
    U: "Ü",
  };
  return value
    .split("|")
    .map((choice) => {
      const text = choice.trim();
      const expanded = text
        .split(/(\{[^}]+\})/g)
        .map((part) =>
          part.startsWith("{")
            ? part
            : part.replace(/[aeiouAEIOU]/g, (letter) => accents[letter]!),
        )
        .join("");
      const length = text.replace(/\{[^}]+\}/g, "").length;
      return `[ ${expanded} ${"·".repeat(Math.ceil(length * 0.35))} ]`;
    })
    .join(" | ");
}

export function pseudoMessages<T extends MessageTree>(messages: T): T {
  return Object.fromEntries(
    Object.entries(messages).map(([key, value]) => [
      key,
      typeof value === "string" ? pseudoText(value) : pseudoMessages(value),
    ]),
  ) as T;
}
