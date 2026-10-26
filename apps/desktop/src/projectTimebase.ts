import {
  resolveProjectTimebase,
  type ProjectSettings,
  type ProjectTimebaseV1,
} from "@openfilm/core";

export const DEFAULT_PROJECT_TIMEBASE_PRESET_ID = "30-ndf";

const presetValues: [string, string, number, number, boolean][] = [
  ["23.976-ndf", "fps23976Ndf", 24000, 1001, false],
  ["24-ndf", "fps24Ndf", 24, 1, false],
  ["25-ndf", "fps25Ndf", 25, 1, false],
  ["29.97-df", "fps2997Df", 30000, 1001, true],
  ["29.97-ndf", "fps2997Ndf", 30000, 1001, false],
  ["30-ndf", "fps30Ndf", 30, 1, false],
  ["50-ndf", "fps50Ndf", 50, 1, false],
  ["59.94-df", "fps5994Df", 60000, 1001, true],
  ["59.94-ndf", "fps5994Ndf", 60000, 1001, false],
  ["60-ndf", "fps60Ndf", 60, 1, false],
];
export const PROJECT_TIMEBASE_PRESETS: {
  id: string;
  labelKey: string;
  timebase: ProjectTimebaseV1;
}[] = presetValues.map(
  ([id, label, rateNumerator, rateDenominator, dropFrame]) => ({
    id,
    labelKey: `app.timebase.presets.${label}`,
    timebase: {
      version: 1,
      rateNumerator,
      rateDenominator,
      dropFrame,
    },
  }),
);

export function sameRateDropFrameChoice(
  settings: ProjectSettings,
): ProjectTimebaseV1 | undefined {
  const timebase = resolveProjectTimebase(settings);
  if (
    timebase.rateDenominator !== 1001 ||
    ![30000, 60000].includes(timebase.rateNumerator)
  )
    return undefined;
  return { ...timebase, dropFrame: !timebase.dropFrame };
}
