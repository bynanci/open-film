export type ExportWarningTranslationKey =
  | "warningUserPins"
  | "warningGraphicScenes"
  | "warningTrack"
  | "warningSpeed"
  | "warningDiptych"
  | "warningClipEdits";

export function classifyExportWarning(
  warning: string,
): ExportWarningTranslationKey | undefined {
  if (warning.startsWith("Foreign NLEs do not enforce user pins"))
    return "warningUserPins";
  if (warning.startsWith("GraphicScene animation and compositing"))
    return "warningGraphicScenes";
  if (/^Track .+: (titles|overlay) semantics/.test(warning))
    return "warningTrack";
  if (/^Clip .+: native OTIO plays an unretimed cut excerpt/.test(warning))
    return "warningSpeed";
  if (/^Clip .+: the native OTIO cut displays primary photo/.test(warning))
    return "warningDiptych";
  if (/^Clip .+: .* are METADATA ONLY/.test(warning)) return "warningClipEdits";
  return undefined;
}
