type Params = Record<string, string | number>;
export type Translate = (key: string, params?: Params) => string;

/** Preserve error values; translate at display time so open messages switch too. */
export function translateError(
  error: unknown,
  translate: Translate,
  hasKey: (key: string) => boolean,
): string {
  const record =
    typeof error === "object" && error !== null
      ? (error as { code?: unknown; params?: unknown })
      : {};
  const key =
    typeof record.code === "string"
      ? `errors.${record.code}`
      : "errors.operation.failed";
  const params: Params = { name: translate("common.file") };
  if (typeof record.params === "object" && record.params !== null) {
    for (const [name, value] of Object.entries(record.params))
      if (typeof value === "string" || typeof value === "number")
        params[name] = value;
  }
  return translate(hasKey(key) ? key : "errors.operation.failed", params);
}

export function errorDetail(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const record = error as {
      detail?: unknown;
      developerMessage?: unknown;
      message?: unknown;
    };
    for (const value of [
      record.detail,
      record.developerMessage,
      record.message,
    ])
      if (typeof value === "string" && value) return value;
  }
  return typeof error === "string" ? error : "";
}
