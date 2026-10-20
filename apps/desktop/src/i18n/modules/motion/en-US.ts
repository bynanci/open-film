export default {
  motion: {
    chooseScene: "Select the linked M8A scene",
    states: {
      preview: "Preview",
      accepted: "Accepted",
      prepared: "Recovering import",
      imported: "Imported",
      restored: "Restored",
      revoked: "Revoked",
    },
    clear: "Discard all unimported motion previews",
    heading: "Motion candidates",
    localOnly:
      "Local review only. Remote generation is disabled. Prefer environments without people.",
    provider: "Candidate source",
    fixture: "Local camera fixture (not AI)",
    external: "Imported external video",
    loadVideos: "Load Library videos",
    externalNotice:
      "Import videos into Library first. Select 1–3. Their relationship to the original is your declaration; no upload occurs.",
    prompt: "Intent (stored as hash)",
    negative: "Constraints (stored as hash)",
    scene: "Linked M8A scene",
    original: "Original photo",
    people: "Contains people or important real details",
    warning:
      "Motion may deform identity, expressions or details. Manually compare every candidate. No preservation guarantee.",
    consent:
      "I approve this local candidate job; original media stays unchanged.",
    generate: "Preview candidates",
    cancel: "Cancel / revoke these previews",
    failed:
      "Operation failed or became stale. Check the saved revision and source, then retry with a new preview.",
    compareTime: "M8A comparison time",
    compareM8a: "Show M8A frame at this time",
    reviewed:
      "I manually checked identity, details, edges and color. This does not guarantee fidelity.",
    candidate: "Candidate {number}",
    free: "Free local fixture; expires after 24 hours or revoke.",
    unknownCost: "External generation cost and provenance are user declared.",
    accept: "Accept after review",
    import: "Replace selected photo clip",
    restore: "Restore original photo / M8A",
  },
};
