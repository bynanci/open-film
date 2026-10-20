// SPDX-License-Identifier: Apache-2.0
export default {
  exportQuality: {
    heading: "Output picture",
    savedFrame: "Video size & frame rate",
    frame: "{width} × {height} · {frameRate} fps",
    source: "Source media",
    originals: "Original photos and videos",
    quality: "MP4 quality",
    captionTrack: "Burn captions into MP4",
    captionTrackAutomatic: "First saved caption track",
    captionTrackNone: "No burned captions",
    captionTrackHint: "SRT and WebVTT remain separate downloadable files.",
    standard: "Standard",
    highDetail: "High detail",
    standardHint: "Balanced file size and export time.",
    highDetailHint:
      "Less compression. Exports take longer and files are usually larger.",
    frameUnchanged:
      "Quality changes compression only; your saved frame and edit stay unchanged.",
    limits:
      "It cannot restore missing detail or recover detail lost when a photo was enlarged.",
  },
  exportProfiles: {
    heading: "Delivery frame",
    description:
      "Choose an output aspect ratio without changing the saved Composition. Preview uses a real rendered frame.",
    ratio: "Aspect ratio",
    framing: "Fit",
    contain: "Contain with black bars",
    crop: "Center crop",
    frameTime: "Preview time (seconds)",
    outputFrameRate: "{frameRate} fps",
    cropWarning:
      "Center crop can trim people, graphic cards, or subtitle safe areas. Preview the exact frame and confirm before exporting.",
    letterboxWarning:
      "The saved Composition is fitted with black bars to preserve its complete frame.",
    alphaWarning: "PNG output is opaque; transparent export is not supported.",
    noAudioRoles:
      "No narration, music, ambience, or dialogue clips apply, so no role stems were created.",
    previewFrame: "Preview export frame",
    renderingPreview: "Rendering preview…",
    saveStill: "Save still PNG",
    cancel: "Cancel export",
    confirmCrop: "I reviewed the preview and want to export this center crop.",
    previewAlt: "Rendered export frame at {time} seconds",
    previewDetails: "{width} × {height} · {time}s · frame {frame}",
    stillSaved: "Still frame saved",
    downloadStill: "Download {filename}",
    downloadReceipt: "Download source and render receipt",
    audioHeading: "Audio delivery",
    audioDescription:
      "WAV mix and role stems follow the current clips, fades, gain, mute, and ducking. Files share the Composition time range.",
    saveMix: "Save full mix WAV",
    saveStems: "Save role stems",
    exportingAudio: "Exporting audio…",
    audioSaved: "Audio export ready",
    audioFile:
      "{role}: {filename} · {duration}s · {sampleRate} Hz · {channels} channels · {samples} samples",
    roles: {
      mix: "Full mix",
      narration: "Narration",
      music: "Music",
      ambience: "Ambience",
      dialogue: "Dialogue",
    },
  },
};
