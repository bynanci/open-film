import app from "../modules/app/en-US";
import editor from "../modules/editor/en-US";
import media from "../modules/media/en-US";
import precision from "../modules/precision/en-US";
import transcript from "../modules/transcript/en-US";
import system from "./system-en-US";

export default {
  ...system,
  ...app,
  ...editor,
  ...media,
  ...precision,
  ...transcript,
  captions: {
    title: "Captions",
    description:
      "Create subtitle files from the corrected transcripts in this edit. Your film and original media stay unchanged.",
    composition: "Current edit",
    sourceTrack: "Spoken-content track",
    chooseTrack: "Choose one track",
    noTracks: "This edit has no video or audio tracks for captions.",
    singleTrack:
      "Choose the one video, audio or music track that contains the speech you want to caption.",
    generate: "Generate captions",
    cancel: "Cancel",
    checkStatus: "Check for changes",
    previewOnly:
      "Text and timing preview only. Captions are separate files and are not burned into the video.",
    preview: "Caption preview",
    cueCount: "No captions | {count} caption | {count} captions",
    noCues:
      "No usable captions were found. Review the notices, correct or transcribe the source, then generate again.",
    blocked: "Resolve the blocking issues and generate again before exporting.",
    asset: "Source",
    revision: "Transcript revision",
    clip: "Clip",
    previous: "Previous",
    next: "Next",
    page: "{from}–{to} of {total}",
    attention: "Review before exporting",
    exportSrt: "Export SRT",
    exportVtt: "Export WebVTT",
    saved: "Caption files saved.",
    download: "Download captions",
    downloadManifest: "Download source record",
    trackTypes: {
      video: "Video",
      audio: "Audio",
      music: "Music",
    },
    severity: {
      warning: "Notice:",
      error: "Cannot export:",
    },
    status: {
      idle: "Choose a track to begin.",
      loading: "Preparing caption files…",
      ready:
        "Ready to export. The source snapshot will be checked again when you export.",
      attention:
        "Captions need your review. Read the notices before exporting.",
      stale:
        "This edit or its source transcript has changed. Generate captions again.",
      failed:
        "Captions could not be prepared. See the reason below and try again.",
      cancelled: "Cancelled. You can generate captions again.",
    },
    issues: {
      TRACK_UNSUPPORTED:
        "This track cannot provide captions. Choose a video, audio or music track.",
      TIMING_UNSUPPORTED:
        "This clip uses timing that cannot be mapped safely. Use supported, positive fixed speed and generate again.",
      SOURCE_UNAVAILABLE:
        "This source is offline or unavailable. Its captions are omitted; reconnect it and generate again.",
      TRANSCRIPT_MISSING:
        "This source has no usable transcript. Its captions are omitted; transcribe it and generate again.",
      TRANSCRIPT_STALE:
        "This transcript belongs to a different source version. Its captions are omitted; review the current source and transcribe again.",
      MEDIA_UNSUPPORTED:
        "This media cannot provide spoken captions and is omitted.",
      MUTED_CLIP: "This clip is muted. Its captions are omitted.",
      PARTIAL_SEGMENT:
        "The edit cuts through a transcript segment. The whole segment is omitted because the retained words cannot be identified reliably.",
      ALIGNMENT_STALE:
        "The text has been corrected. Segment timing is used; word timing is not treated as precise.",
      TIMING_ESTIMATED:
        "This segment uses estimated timing. Listen to the film to check its caption timing.",
      INVALID_SEGMENT:
        "This transcript segment has invalid timing. Correct it before exporting.",
      INVALID_TEXT:
        "This segment contains invalid text. Correct it before exporting.",
      EMPTY_TEXT: "An empty transcript segment is omitted.",
      TEXT_ESCAPED:
        "Special text needs format-safe handling. Choose WebVTT if SRT cannot preserve it.",
      ZERO_DURATION:
        "This segment has no remaining duration after output timing is rounded and is omitted.",
      OVERLAP:
        "These captions overlap. Both are retained; playback depends on the subtitle player.",
      MUSIC_SOURCE:
        "A music track was selected. Confirm it contains the speech you want to caption.",
      LIMIT_EXCEEDED:
        "This selection exceeds the supported caption limit. Choose a smaller edit or track.",
      unknown: "This caption needs review. See the source record for details.",
    },
  },
  errors: {
    ...system.errors,
    captions: {
      srtTextUnsupported:
        "This text contains formatting syntax SRT cannot preserve reliably. Export WebVTT instead.",
      invalid:
        "This caption selection cannot be exported. Review its notices and choose a supported track.",
      stale:
        "The edit or its transcript has changed. Generate captions again before exporting.",
      failed:
        "Caption files could not be saved. Check the project location and available space, then try again.",
      unavailable:
        "This caption snapshot is no longer available. Generate captions again.",
    },
  },
};
