import { intlLocale, type UiLocale } from "./locale";

/** Timecodes are deliberately stable across locales and use ASCII digits. */
export function formatDuration(
  value: number | undefined,
  options: { fractional?: boolean } = {},
): string {
  if (value === undefined || !Number.isFinite(value)) return "—";
  const fractional = options.fractional ?? true;
  const units = Math.max(0, Math.round(value * (fractional ? 10 : 1)));
  const seconds = fractional ? Math.floor(units / 10) : units;
  const fraction = fractional ? units % 10 : 0;
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}${fraction ? `.${fraction}` : ""}`;
}

export function localizedNumber(
  value: number,
  locale: UiLocale,
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(intlLocale(locale), options).format(value);
}

export function localizedDate(
  value: string | number | Date | undefined,
  locale: UiLocale,
  options?: Intl.DateTimeFormatOptions,
): string | undefined {
  if (value === undefined || value === "") return undefined;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return new Intl.DateTimeFormat(
    intlLocale(locale),
    options ?? { year: "numeric", month: "short", day: "numeric" },
  ).format(date);
}
