/** Shared Unicode safety check for persisted captions, mapping and exports. */
export const MAX_CAPTION_TEXT_LENGTH = 20_000;
export const MAX_CAPTION_CUE_COUNT = 100_000;
export const MAX_CAPTION_TEXT_CHARACTERS = 8_000_000;
export const MAX_CAPTION_TIME_MS = 359_999_999;

export function isCaptionTextValid(text: string): boolean {
  return (
    typeof text === "string" &&
    text.length <= MAX_CAPTION_TEXT_LENGTH &&
    ![...text].some((character) => {
      const code = character.charCodeAt(0);
      return (code < 32 && ![9, 10, 13].includes(code)) || code === 127;
    }) &&
    !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
      text,
    )
  );
}
