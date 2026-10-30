// SPDX-License-Identifier: Apache-2.0
export default {
  primaryColor: {
    applyHint: "Apply commits these values and updates the Monitor.",
    current:
      "Current warm/cool {temperature}, encoded SDR gain {exposure} EV, contrast {contrast}.",
    heading: "Primary color",
    description:
      "Warm/cool, gain and contrast on encoded SDR values. The gain uses EV units; calibrated scene exposure requires separate color management.",
    scope: "Apply setting to",
    scopes: {
      film: "Whole film",
      beat: "Scene",
      clip: "Clip",
      original: "Uncorrected",
    },
    temperature: "Warm / cool (−1 to 1)",
    exposure: "Encoded SDR gain (EV)",
    contrast: "Contrast (0.5 to 1.5)",
    apply: "Apply primary color",
    neutral: "Neutral values",
    inherit: "Inherit",
    effective: "Effective primary setting: {scope}",
    review: "Auto Match · statistical suggestion",
    statistical:
      "Compare brightness, warm/cool balance and contrast statistics before Film Look. Review the actual samples before applying. Use two opaque photo or flat video clips, up to 512 MiB per source.",
    reference: "Reference clip",
    measure: "Measure a suggestion",
    discard: "Discard / cancel",
    measuring: "Measuring local source samples…",
    failed:
      "Comparison unavailable. Check that both supported opaque sources are online, within 512 MiB each, and the film is saved. Measure again.",
    sample: "Sample",
    variants: {
      reference: "Reference",
      before: "Before primary",
      after: "Suggested primary",
    },
    median: "Median luma (0–255)",
    clipping: "Clipped sample pixels",
    proposed:
      "Suggested warm/cool {temperature}, encoded SDR gain {exposure} EV, contrast {contrast}.",
    reviewed: "I reviewed the reference, before and suggested samples.",
    applyClip: "Apply suggestion to this clip",
    warnings: {
      "statistical-suggestion":
        "Statistical suggestion; review differences in lighting and scene content.",
      "insufficient-evidence":
        "These samples are too dark, flat or clipped for a useful suggestion. Adjust manually.",
      "no-useful-match":
        "Measured improvement or edit eligibility is insufficient. Keep the current setting or adjust manually.",
    },
  },
};
