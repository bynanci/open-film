// Modified by OpenFilm contributors on 2026-10-26. See LICENSE/NOTICE.
export default {
  cutDesk: {
    record: "Record",
    source: "Source",
    active: "Active",
    playing: "Playing",
    paused: "Paused",
    play: "Play sequence",
    pause: "Pause sequence",
    transport: "Record transport",
    sequenceTimecode: "Sequence timecode",
    timebase: "Sequence timebase",
    dropFrame: "Drop-frame (DF)",
    nonDropFrame: "Non-drop-frame (NDF)",
    timebaseSaving: "Saving sequence timebase…",
    shortcuts:
      "Space play/pause · J K L shuttle · ← → frame · Shift+← → second · ↑ ↓ edit · Home/End bounds · B split",
    issues: {
      "not-ready": "Waiting for Record media…",
      "source-missing": "Record source is missing. Your edits are safe.",
      "source-inaccessible": "Record source cannot be accessed.",
      "decode-failed": "Record media could not be decoded.",
      "invalid-composition": "Record cannot preview this composition.",
      "audio-gain-unavailable":
        "Record cannot preview the requested audio gain.",
    },
  },
};
