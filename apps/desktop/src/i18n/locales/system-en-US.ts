// Modified by OpenFilm contributors on 2026-10-18. Preexisting portions retain
// Apache-2.0 grants; current OpenFilm first-party code is Apache-2.0. See LICENSE/NOTICE.
export default {
  common: {
    unknownDate: "Capture date unknown",
    file: "This file",
    filesCount: "No files | {count} file | {count} files",
    unavailable: "Unavailable",
    technicalDetails: "Technical details",
  },
  errors: {
    presets: {
      invalid:
        "This preset contains unsupported or invalid data. Review the indicated field.",
      unsupported:
        "This preset version is unsupported. Keep the original package and use a compatible version.",
      conflict:
        "The preset conflicts with an installed release or protected authored content. Review the target and its selections.",
      stale:
        "The recipe, project or source changed. Review the current target again.",
      storageBusy:
        "Another or unverified process owns preset storage. Retry when it finishes.",
      storageUnavailable:
        "Local preset storage could not be verified. Saved films remain usable; review backup recovery.",
      recoveryUnavailable:
        "A safe preset backup recovery is unavailable. Inspect or archive the existing recovery copy.",
    },
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
      timebaseConflict:
        "This film changed or its timed content needs rate conform. Reopen the film and review its timebase.",
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
    proxy: {
      quotaExceeded:
        "Managed preview storage is full. Review cleanup or increase the preview quota.",
      storageUnavailable:
        "Preview storage is unavailable. Check drive access and try again.",
      stale: "Preview storage changed. Refresh it and review the action again.",
      protected:
        "This preview is protected or in use. Keep its source online and review its protection before cleanup.",
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
      audioTimingConflict:
        "The independent sound range conflicts with this edit. Adjust or explicitly reset sound timing first.",
      audioCaptionConflict:
        "This edit would change source-linked caption timing. Edit or delete the affected captions in the same batch.",

      pinConflict:
        "A pinned edit cannot fit this change. Release its user pin explicitly or adjust neighboring clips.",
      lockedClipConflict:
        "Cannot ripple edit because locked media is in the affected range. Unlock the clips or sources first.",

      primaryColorLocked:
        "Changing primary color would affect {count} protected clips. Unlock the clips or sources first.",
      titleRunsConflict:
        "Update the language boundary with this text edit, or explicitly remove its independent run styling.",
      lookLocked:
        "Changing this look would affect {count} protected clips. Unlock those clips or sources first, or adjust an unlocked clip.",
      notFound:
        "This edit is no longer available. Open the latest version of your film.",
      conflict:
        "The saved film changed while you were editing. Review the newer version or reapply your saved draft.",
      invalidEdit:
        "This change doesn't fit the source or story limits. Check the trim, duration and locked memories.",
      graphicRangeConflict:
        "Shortening the edit would exclude saved graphics. Adjust or remove the affected scenes first, then retry.",
      captionRangeConflict:
        "Shortening the edit would exclude saved captions. Adjust or delete the affected captions first, then retry.",
    },
    title: { busy: "Wait for the current text preview to finish, then retry." },
    graphics: {
      invalid:
        "Check the graphic scene fields, timing and supported primitives.",
      resourceLimit:
        "This graphic scene exceeds its resource limit. Reduce its size, duration or number of layers.",
      unavailable:
        "A graphic image or local font is unavailable. Check the source and try again.",
      stale: "This graphic frame is stale. Wait for the latest edit to save.",
      busy: "A graphic frame is being prepared. Try again shortly.",
      sourceChanged:
        "The original photo, mask or background no longer matches its saved receipt. Restore the local asset or recreate the depth setup.",
      maskInvalid:
        "The foreground mask can't be decoded as a supported local image. Choose another mask and try again.",
      maskMismatch:
        "The foreground mask dimensions don't match the original photo. Choose a same-size mask and try again.",
      maskEmpty:
        "The foreground mask contains no visible subject. Choose a mask with an opaque foreground.",
      maskMissing:
        "The foreground mask is offline. Reconnect it or choose another local mask.",
      backgroundMissing:
        "The background fill is offline. Reconnect it or choose another local background.",
      protectedRegion:
        "The protected subject would be cropped by this depth setup. Adjust the protected area or use the original photo.",
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
      draftStale:
        "This source list changed in another view. Review the latest list before continuing.",
      batchNotReady:
        "This import batch is not ready for analysis. Finish or retry source verification first.",
      sourceUnavailable:
        "A selected source is no longer readable. Reconnect or select it again before continuing.",
    },
    analysis: {
      scopeStale:
        "The verified analysis scope changed. Start a new analysis from the latest source list.",
      resultStale:
        "This analysis result no longer matches the saved sources or story. Review the latest result.",
    },
    export: {
      directoryUnavailable:
        "Cannot publish a directory package at this location. Choose a ZIP package or another disk.",
      stemsUnavailable:
        "Cannot publish a stem directory at this location. Choose a WAV mix or another disk.",
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
    transcript: {
      revisionConflict:
        "The transcript changed while you were editing. Your local draft is preserved; load the newer revision before continuing.",
      segmentNotFound:
        "This transcript segment is no longer available. Reload the current transcript.",
      alignmentStale:
        "This text was edited. Word timing is historical and cannot be used as precise alignment.",
      invalidCommand:
        "This transcript change is invalid. Check the selected text, segment and split time.",
      unreliableTiming:
        "Transcript ripple requires verified timing; estimated timing cannot be automatically ripple-edited.",
      rippleConflict:
        "Transcript ripple edit conflicts with locked media or user pins.",
    },
    continuity: {
      invalidProposal:
        "The continuity review proposal is invalid or contains malformed data. Refresh diagnostics to continue.",
      staleProposal:
        "The timeline or story changed after this continuity diagnostic was generated. Refresh diagnostics before accepting.",
      conflict:
        "Continuity adjustment conflicts with locked clips, user pins, or protected media.",
    },
    microPreview: {
      invalidProposal:
        "The scene micro-preview proposal is invalid or contains malformed data. Refresh preview to continue.",
      staleProposal:
        "The timeline or transition changed after this micro-preview was generated. Refresh preview before accepting.",
      conflict:
        "The micro-preview transition conflicts with locked clips or protected boundaries.",
    },
    glossary: {
      storageBusy:
        "Another OpenFilm window or process is updating your global glossary. Try again after it finishes.",
      entryConflict:
        "A glossary term changed or conflicts with another entry. Reload the glossary and try again.",
    },
    review: {
      cleanupFailed:
        "Comparison images could not be removed. Retry cleanup, or close and reopen this project.",
      providerUnavailable:
        "A language review provider is unavailable or needs text consent. Glossary suggestions are still available.",
      suggestionStale:
        "The transcript changed after this suggestion was created. Find new suggestions before applying a correction.",
      invalidOutput:
        "The review result was invalid and was not applied. Completed valid suggestions remain available.",
    },
    operation: {
      failed:
        "This action couldn't finish. Your saved work is safe. Try again or open the technical details.",
    },
  },
};
