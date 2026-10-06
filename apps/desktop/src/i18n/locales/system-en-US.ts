export default {
  common: {
    unknownDate: "Capture date unknown",
    file: "This file",
    filesCount: "No files | {count} file | {count} files",
    unavailable: "Unavailable",
    technicalDetails: "Technical details",
  },
  errors: {
    request: {
      invalid: "Check the entered values and try again.",
      tooLarge:
        "This selection is too large. Choose fewer files or a smaller file and try again.",
      unsupported:
        "This request isn't supported. Choose a supported file or action.",
      forbidden:
        "OpenFilm couldn't access this location. Choose a local folder you can read and write.",
      notFound:
        "This item is no longer available. Refresh the workspace and try again.",
    },
    workspace: {
      unavailable:
        "OpenFilm's local workspace isn't available. Restart OpenFilm to reconnect; your saved work is safe.",
      invalidResponse:
        "OpenFilm couldn't read the workspace response. Restart OpenFilm and try again.",
      closing:
        "OpenFilm is closing the workspace. Wait for it to finish before trying again.",
    },
    project: {
      required: "Create or open a film to continue.",
      unavailable:
        "This film can't be opened. Reconnect its drive or choose its current location.",
      destinationInvalid:
        "The film couldn't be saved here. Choose a writable folder in Advanced settings.",
    },
    jobs: {
      busy: "A task is still using this film. Wait for it to finish or cancel it in Activity.",
      notRunning:
        "This task has already finished. Refresh Activity to see its result.",
    },
    media: {
      notFound:
        "This memory is no longer in the library. Refresh the library to continue.",
      missing:
        "{name} is offline. Your edits are safe. Choose Find File to reconnect it.",
      previewUnavailable:
        "A preview isn't available for this file. Reconnect it or add it again to rebuild its preview.",
      unsupported:
        "This source can't be played here. Add a supported photo or a reframed video export.",
      relinkFailed:
        "OpenFilm couldn't reconnect these files. Check the folder and try Find File or Find Folder again.",
      relinkConflict:
        "The selected file doesn't match the original. Review the match before replacing it.",
      transcriptionFailed:
        "The transcript couldn't be created. Check the source audio and local transcription setup, then try again. Technical details may explain the failure.",
      sceneFailed:
        "Scene changes couldn't be detected. Check that the source video is available and playable, then try again or open the technical details.",
      waveformFailed:
        "The waveform couldn't be created. Check that the source has a playable audio track, then try again or open the technical details.",
    },
    story: {
      mediaRequired: "Add some memories before creating a story.",
      scopeTooLarge:
        "Choose a smaller group of memories for this story, then try again.",
      invalid:
        "The story couldn't be saved. Check its selected memories and duration limits.",
    },
    timeline: {
      notFound:
        "This edit is no longer available. Open the latest version of your film.",
      conflict:
        "The saved film changed while you were editing. Review the newer version or reapply your saved draft.",
      invalidEdit:
        "This change doesn't fit the source or story limits. Check the trim, duration and locked memories.",
    },
    render: {
      overMaximum:
        "Your film is over its maximum length. Use Fit to Duration or shorten a few clips before exporting.",
      failed:
        "The film couldn't be rendered. Check offline files and unsupported media, then try again.",
    },
    import: {
      failed:
        "Some memories couldn't be added. Check their locations and file types, then try again.",
    },
    export: {
      failed:
        "The film couldn't be exported. Check the destination, available space and media, then try again.",
    },
    source: {
      changed:
        "A source file changed. Add it again or reconnect the original before continuing.",
    },
    model: {
      unavailable:
        "The local transcription model isn't available. Configure an installed model, then try again. Other editing tools remain available.",
    },
    transcription: {
      modelRequired:
        "Choose an installed local Whisper model before transcribing. OpenFilm does not download model files automatically.",
      modelInvalid:
        "The configured model can't be used. Check its path and file format, then choose a supported local Whisper model.",
      runtimeUnavailable:
        "The local transcription runtime isn't available. Install and configure the supported Whisper runtime, then restart OpenFilm.",
      noAudio:
        "This source has no usable audio track. Choose a video or recording with speech to create a transcript.",
      failed:
        "Transcription couldn't finish. Check the source audio and model setup, then try again or open the technical details.",
      invalidOutput:
        "The transcription result had invalid text or timing and wasn't saved. Check the provider setup and try again.",
    },
    operation: {
      failed:
        "This action couldn't finish. Your saved work is safe. Try again or open the technical details.",
    },
  },
};
