const SHA256 = /^[a-f0-9]{64}$/u;

export interface PhotoDepthCreateReadiness {
  disabled: boolean;
  sourceHash?: string;
  maskHash?: string;
  selectedMaskId: string;
  backgroundKind: "source" | "asset";
  backgroundHash?: string;
  eligibility: string;
}

export function canCreatePhotoDepth(
  readiness: PhotoDepthCreateReadiness,
): boolean {
  return (
    !readiness.disabled &&
    SHA256.test(readiness.sourceHash ?? "") &&
    SHA256.test(readiness.maskHash ?? "") &&
    Boolean(readiness.selectedMaskId) &&
    readiness.eligibility === "" &&
    (readiness.backgroundKind === "source" ||
      SHA256.test(readiness.backgroundHash ?? ""))
  );
}
