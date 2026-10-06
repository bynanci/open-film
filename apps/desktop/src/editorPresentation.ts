import type { MediaType } from "@openfilm/core";
import type { TimelineCommand } from "@openfilm/solver";

export function clipControls(type?: MediaType) {
  return {
    duration: type === "image",
    trim: !!type && type !== "image",
    speed: type === "video" || type === "360-video",
    volume: !!type && type !== "image",
    visual: !!type && type !== "audio",
  };
}

/** Semantic keys keep user-authored names separate from translated UI prose. */
export function shorteningAction(command?: TimelineCommand) {
  return command?.type === "delete"
    ? "remove"
    : command?.type === "duration"
      ? "photo"
      : "trim";
}
