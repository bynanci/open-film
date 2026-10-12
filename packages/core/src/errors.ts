/** Stable product errors; diagnostic English stays in detail for inspection. */
export const applicationErrorCodes = [
  "request.invalid",
  "request.tooLarge",
  "request.unsupported",
  "request.forbidden",
  "request.notFound",
  "workspace.unavailable",
  "workspace.invalidResponse",
  "workspace.closing",
  "project.required",
  "project.unavailable",
  "project.destinationInvalid",
  "jobs.busy",
  "jobs.notRunning",
  "media.notFound",
  "media.missing",
  "media.previewUnavailable",
  "media.unsupported",
  "media.relinkFailed",
  "media.relinkConflict",
  "story.mediaRequired",
  "story.scopeTooLarge",
  "story.invalid",
  "timeline.notFound",
  "timeline.conflict",
  "timeline.invalidEdit",
  "render.overMaximum",
  "render.failed",
  "import.failed",
  "export.failed",
  "captions.invalid",
  "captions.stale",
  "captions.failed",
  "captions.unavailable",
  "captions.srtTextUnsupported",
  "source.changed",
  "media.transcriptionFailed",
  "model.unavailable",
  "media.sceneFailed",
  "media.waveformFailed",
  "transcription.modelRequired",
  "transcription.modelInvalid",
  "transcription.runtimeUnavailable",
  "transcription.noAudio",
  "transcription.failed",
  "transcription.invalidOutput",
  "transcript.revisionConflict",
  "transcript.segmentNotFound",
  "transcript.alignmentStale",
  "transcript.invalidCommand",
  "glossary.entryConflict",
  "glossary.storageBusy",
  "review.providerUnavailable",
  "review.suggestionStale",
  "review.invalidOutput",
  "operation.failed",
] as const;
export type ApplicationErrorCode = (typeof applicationErrorCodes)[number];
export interface OpenFilmError {
  code: ApplicationErrorCode;
  params?: Record<string, string | number>;
  detail?: string;
}

export class ApplicationError extends Error implements OpenFilmError {
  override name = "ApplicationError";
  constructor(
    readonly code: ApplicationErrorCode,
    message: string,
    readonly status = 400,
    readonly params?: Record<string, string | number>,
    readonly detail: string = message,
  ) {
    super(message);
  }
}

export function errorInfo(
  error: unknown,
  fallback: ApplicationErrorCode = "operation.failed",
): OpenFilmError {
  const value =
    error !== null && typeof error === "object"
      ? (error as Partial<OpenFilmError>)
      : {};
  const code = applicationErrorCodes.includes(
    value.code as ApplicationErrorCode,
  )
    ? value.code!
    : fallback;
  const params =
    value.params &&
    typeof value.params === "object" &&
    !Array.isArray(value.params)
      ? Object.fromEntries(
          Object.entries(value.params).filter(
            ([, item]) =>
              typeof item === "string" ||
              (typeof item === "number" && Number.isFinite(item)),
          ),
        )
      : undefined;
  return {
    code,
    ...(params ? { params } : {}),
    detail:
      typeof value.detail === "string"
        ? value.detail
        : error instanceof Error
          ? error.message
          : String(error),
  };
}
