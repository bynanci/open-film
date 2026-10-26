/** Source range drafts are transient and owned by one acknowledged edit context. */
export interface SourceMarkOwner {
  projectId: string;
  compositionId: string;
  revision: string;
  clipId: string;
  assetId: string;
  timebaseKey: string;
}

export interface SourceMarks {
  readonly owner: Readonly<SourceMarkOwner>;
  readonly sourceIn: number;
  readonly sourceOut: number;
  readonly staged: boolean;
  readonly stale: boolean;
}

export function reset(
  owner: SourceMarkOwner,
  sourceIn: number,
  sourceOut: number,
): SourceMarks {
  return {
    owner: { ...owner },
    sourceIn,
    sourceOut,
    staged: false,
    stale: false,
  };
}

export function stageIn(marks: SourceMarks, sourceIn: number): SourceMarks {
  return { ...marks, sourceIn, staged: true };
}

export function stageOut(marks: SourceMarks, sourceOut: number): SourceMarks {
  return { ...marks, sourceOut, staged: true };
}

export function markStale(marks: SourceMarks): SourceMarks {
  return { ...marks, stale: true };
}

export function sameSourceOwner(
  a: SourceMarkOwner,
  b: SourceMarkOwner,
): boolean {
  return (
    a.projectId === b.projectId &&
    a.compositionId === b.compositionId &&
    a.clipId === b.clipId &&
    a.assetId === b.assetId &&
    a.timebaseKey === b.timebaseKey
  );
}

export function reconcileSourceMarks(
  marks: SourceMarks,
  owner: SourceMarkOwner,
  sourceIn: number,
  sourceOut: number,
): SourceMarks {
  if (!sameSourceOwner(marks.owner, owner) || !marks.staged)
    return reset(owner, sourceIn, sourceOut);
  return marks.owner.revision === owner.revision ? marks : markStale(marks);
}

export function validSourceRange(
  marks: SourceMarks,
  duration: number,
): boolean {
  return (
    !marks.stale &&
    Number.isFinite(duration) &&
    duration > 0 &&
    Number.isFinite(marks.sourceIn) &&
    Number.isFinite(marks.sourceOut) &&
    marks.sourceIn >= 0 &&
    marks.sourceIn < marks.sourceOut &&
    marks.sourceOut <= duration
  );
}
