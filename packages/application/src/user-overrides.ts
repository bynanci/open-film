import {
  hasUserOverrideState,
  PINNED_PROJECT_SCHEMA_VERSION,
  type OpenFilmProject,
} from "@openfilm/core";
/** Promotion is published with the existing project transaction; never mutate the live project. */
export function promotePinnedProject(
  project: OpenFilmProject,
): OpenFilmProject {
  const candidate = structuredClone(project);
  if (hasUserOverrideState(candidate))
    candidate.schemaVersion = PINNED_PROJECT_SCHEMA_VERSION;
  return candidate;
}
