export function graphicSceneAgentReceiptKey(
  projectId: string,
  compositionId: string,
): string {
  return `openfilm.graphic-agent:${JSON.stringify([projectId, compositionId])}`;
}

/** A stored receipt must keep the edit barrier up before the review panel mounts. */
export function hasGraphicSceneAgentReceipt(
  projectId: string,
  compositionId: string,
): boolean {
  try {
    return (
      typeof localStorage !== "undefined" &&
      localStorage.getItem(
        graphicSceneAgentReceiptKey(projectId, compositionId),
      ) !== null
    );
  } catch {
    return false;
  }
}
