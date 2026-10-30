// SPDX-License-Identifier: Apache-2.0
import { stat } from "node:fs/promises";
import { resolveTitleFont, type TitleOverlayOptions } from "@openfilm/render";
import { readPinnedTestFonts } from "./render-qa-fonts.js";

/** Explicit D7A admission when selected; otherwise retain admitted platform fixtures. */
export async function titleTestFontOptions(): Promise<
  Required<Pick<TitleOverlayOptions, "fontPathForStyle">>
> {
  if (process.env.OPENFILM_TEST_FONT_ROOT) {
    const fonts = await readPinnedTestFonts();
    return {
      fontPathForStyle: (style) => {
        const serif = /serif/iu.test(style?.fontFamily ?? ""),
          bold = (style?.fontWeight ?? 400) >= 600;
        return fonts[
          serif
            ? bold
              ? "serifBold"
              : "serifRegular"
            : bold
              ? "sansBold"
              : "sansRegular"
        ].path;
      },
    };
  }
  const regular = (
    await resolveTitleFont({ fontFamily: "Noto Sans CJK TC", fontWeight: 400 })
  ).font.path;
  // Existing Windows fixtures stage the admitted Bold sibling beside Regular;
  // an explicit path prevents the global Regular override from hiding Bold.
  const candidate = regular.replace(/Regular(?=\.[^.]+$)/u, "Bold");
  const bold = (
    await resolveTitleFont(
      { fontFamily: "Noto Sans CJK TC", fontWeight: 700 },
      {
        fontPath: await stat(candidate).then(
          () => candidate,
          () => regular,
        ),
      },
    )
  ).font.path;
  return {
    fontPathForStyle: (style) =>
      (style?.fontWeight ?? 400) >= 600 ? bold : regular,
  };
}
