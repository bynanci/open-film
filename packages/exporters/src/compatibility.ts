/** Capability evidence is independent of translated product copy. */
export type NleFeatureId =
  | "cuts"
  | "sourceTiming"
  | "stillDuration"
  | "audio"
  | "mediaReferences"
  | "gaps"
  | "multipleTracks"
  | "fractionalFrameRate"
  | "speed"
  | "volumeMute"
  | "transform"
  | "crossfade"
  | "titles"
  | "clipLocks"
  | "overlappingClips";

export interface NleFeatureCompatibility {
  id: NleFeatureId;
  implementation: "native" | "metadata-only" | "unsupported";
  schemaValidated: boolean;
  parserValidated: boolean;
  realNleVerified: boolean;
  manualRecreation: boolean;
}

export interface NleVerificationEvidence {
  version: string;
  os: string;
  openFilmSha: string;
  fixture: string;
  features: NleFeatureId[];
  record: string;
}

const nativeFeatures: NleFeatureId[] = [
  "cuts",
  "sourceTiming",
  "stillDuration",
  "audio",
  "mediaReferences",
  "gaps",
  "multipleTracks",
  "fractionalFrameRate",
];
const metadataFeatures: NleFeatureId[] = [
  "speed",
  "volumeMute",
  "transform",
  "crossfade",
  "titles",
  "clipLocks",
];
const realNle: NleVerificationEvidence[] = [];

/** No Resolve application evidence has been recorded. Parser success is not NLE QA. */
export const resolveCompatibility = {
  id: "davinci-resolve" as const,
  format: "otio" as const,
  evidence: {
    parserVersion: "0.18.1",
    parserFixture: "tests/interchange/resolve/verify.py",
    parserCommand: "pnpm test:interchange",
    manualProcedure: "docs/nle-compatibility.md",
    realNle,
  },
  features: [
    ...nativeFeatures.map((id): NleFeatureCompatibility => ({
      id,
      implementation: "native",
      schemaValidated: true,
      parserValidated: true,
      realNleVerified: realNle.some((qa) => qa.features.includes(id)),
      manualRecreation: false,
    })),
    ...metadataFeatures.map((id): NleFeatureCompatibility => ({
      id,
      implementation: "metadata-only",
      schemaValidated: true,
      parserValidated: true,
      realNleVerified: false,
      manualRecreation: true,
    })),
    {
      id: "overlappingClips",
      implementation: "unsupported",
      schemaValidated: false,
      parserValidated: false,
      realNleVerified: false,
      manualRecreation: false,
    } satisfies NleFeatureCompatibility,
  ],
};
