export interface ProposalFixtureFile {
  id: string;
  path: string;
  kind: string;
  synthetic: true;
  expected: Record<string, unknown>;
  sha256: string;
  bytes: number;
}

export interface ProposalMediaFixture {
  root: string;
  mediaDirectory: string;
  rawDirectory: string;
  files: ProposalFixtureFile[];
  byId: Record<string, string>;
  manifestPath: string;
}

export function generateProposalMedia(
  directory: string,
  options?: { includeRaw?: boolean },
): Promise<ProposalMediaFixture>;
