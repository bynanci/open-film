export interface MessageTree {
  [key: string]: string | MessageTree;
}

export function flattenMessages(
  messages: MessageTree,
  prefix = "",
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(messages)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") result[path] = value;
    else Object.assign(result, flattenMessages(value, path));
  }
  return result;
}

export function placeholders(message: string): string[] {
  return [
    ...new Set(
      [...message.matchAll(/\{([A-Za-z][\w]*)\}/g)].map((match) => match[1]!),
    ),
  ].sort();
}

/** Check catalog shape and interpolation contracts before shipping any locale. */
export function translationProblems(
  baseline: MessageTree,
  candidate: MessageTree,
): string[] {
  const expected = flattenMessages(baseline);
  const actual = flattenMessages(candidate);
  const problems: string[] = [];
  for (const [key, value] of Object.entries(expected)) {
    if (!(key in actual)) problems.push(`Missing key: ${key}`);
    else if (
      JSON.stringify(placeholders(value)) !==
      JSON.stringify(placeholders(actual[key]!))
    )
      problems.push(`Placeholder mismatch: ${key}`);
    else if (!actual[key]!.trim()) problems.push(`Empty translation: ${key}`);
  }
  for (const key of Object.keys(actual))
    if (!(key in expected)) problems.push(`Orphan key: ${key}`);
  return problems;
}
