// SPDX-License-Identifier: Apache-2.0
export default {
  looks: {
    heading: "Film look",
    description:
      "Choose a whole-film look, then adjust individual scenes or clips.",
    film: "Whole film",
    beat: "This scene",
    clip: "This clip",
    inherit: "Inherit",
    strength: "Strength",
    strengthLabel: "{scope} strength",
    resolved: "Showing {preset} · {source}",
    sources: {
      export: "this export",
      clip: "clip setting",
      beat: "scene setting",
      film: "whole-film setting",
      original: "original colors",
    },
    presets: {
      none: "Original",
      "soft-film": "Soft film",
      americana: "Americana",
      "clean-camera": "Clean camera",
      retro: "Retro",
      natural: "Natural",
      sport: "Sport",
    },
    hints: {
      none: "Keep the source colors.",
      "soft-film":
        "Fuji-inspired soft greens and gentle contrast for everyday memories.",
      americana:
        "Warmer color and deeper contrast for a bold travel-film feel.",
      "clean-camera":
        "Crisp detail and balanced contrast for a refined camera look.",
      retro: "Lifted shadows and restrained color for a faded-era feel.",
      natural: "A subtle, balanced finish that keeps familiar colors.",
      sport: "Vivid color and strong contrast for active moments.",
    },
    protected:
      "Unlock this clip or its source in Library before changing its look.",
    previewNote:
      "Looks affect photos and video only. The source view gives a quick idea of the look; use Render preview to check the finished picture, especially for video and HDR media.",
    exportHeading: "MP4 look",
    exportMode: "Look for this output",
    preserve: "Keep scene and clip looks",
    unify: "Use one look for this output",
    exportPreset: "Output look",
    exportStrength: "Output strength",
    exportOnly:
      "This output choice does not change your saved edit. Render preview uses the same choice.",
    uniformHint:
      "This output overrides scene and clip looks, including locked clips. Your project settings stay unchanged.",
    previewOverride:
      "Rendered preview: {preset} for the whole film. The editing monitor keeps your saved scene and clip looks.",
    interchange:
      "Editable exports keep saved look metadata. Recreate looks in your editing app; an MP4-only override is not included.",
  },
};
