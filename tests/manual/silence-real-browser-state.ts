// SPDX-License-Identifier: Apache-2.0
// QA-only session-copy guard; no project mutation or application authority.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

export interface ProjectCloseObservation {
  projectId: string;
  kind: "http-project-close" | "owned-server-close";
  status: number | "closed";
  identityObservedAt: number;
  startedAt: number;
  finishedAt: number;
}

export function assertSessionProjectState(
  originalText: string,
  currentText: string,
  projectId: string,
  closes: readonly ProjectCloseObservation[],
) {
  const original = JSON.parse(originalText) as Record<string, unknown>;
  const current = JSON.parse(currentText) as Record<string, unknown>;
  for (const project of [original, current]) {
    assert(project && typeof project === "object" && !Array.isArray(project));
    assert.equal(project.id, projectId, "Actual project identity must match");
  }
  const canonicalTime = (value: unknown) => {
    assert(
      typeof value === "string" &&
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value),
      "Root updatedAt must be canonical ISO UTC",
    );
    const milliseconds = Date.parse(value);
    assert(Number.isFinite(milliseconds));
    assert.equal(new Date(milliseconds).toISOString(), value);
    return milliseconds;
  };
  const originalTime = canonicalTime(original.updatedAt);
  const currentTime = canonicalTime(current.updatedAt);
  const { updatedAt: originalUpdatedAt, ...originalContent } = original;
  const { updatedAt: currentUpdatedAt, ...currentContent } = current;
  assert.deepStrictEqual(
    currentContent,
    originalContent,
    "Only root updatedAt may change",
  );
  const rootUpdatedAtChanged = originalUpdatedAt !== currentUpdatedAt;
  const closeObservation = rootUpdatedAtChanged
    ? closes.find(
        (close) =>
          close.projectId === projectId &&
          ((close.kind === "http-project-close" && close.status === 200) ||
            (close.kind === "owned-server-close" &&
              close.status === "closed")) &&
          [close.identityObservedAt, close.startedAt, close.finishedAt].every(
            Number.isSafeInteger,
          ) &&
          close.identityObservedAt <= close.startedAt &&
          close.startedAt <= close.finishedAt &&
          currentTime >= close.startedAt &&
          currentTime <= close.finishedAt,
      )
    : undefined;
  if (rootUpdatedAtChanged) {
    assert(
      currentTime >= originalTime,
      "Save timestamp must not move backwards",
    );
    assert(
      closeObservation,
      "Changed root updatedAt requires an observed successful close for this actual project",
    );
  }
  const hash = (text: string) =>
    createHash("sha256").update(text).digest("hex");
  const originalTextSha256 = hash(originalText);
  const currentTextSha256 = hash(currentText);
  return {
    originalTextSha256,
    currentTextSha256,
    originalUpdatedAt,
    currentUpdatedAt,
    rootUpdatedAtChanged,
    closeObservation: closeObservation ?? null,
  };
}
