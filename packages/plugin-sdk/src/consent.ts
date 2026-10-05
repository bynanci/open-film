import type {
  AIProviderDescriptor,
  ProviderDataKind,
  RemoteProviderConsent,
} from "./ports.js";

export const PROVIDER_DATA_KINDS: readonly ProviderDataKind[] = [
  "images",
  "video",
  "audio",
  "metadata",
  "gps",
  "faces",
  "transcripts",
  "text",
];

export class RemoteProviderConsentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RemoteProviderConsentError";
  }
}

export function validateProviderDescriptor(
  provider: AIProviderDescriptor,
): void {
  if (
    !provider ||
    typeof provider !== "object" ||
    typeof provider.id !== "string" ||
    !provider.id.trim() ||
    typeof provider.name !== "string" ||
    !provider.name.trim()
  )
    throw new RemoteProviderConsentError(
      "A provider must declare its id and name.",
    );
  if (provider.execution !== "local" && provider.execution !== "remote")
    throw new RemoteProviderConsentError(
      "A provider must explicitly declare local or remote execution.",
    );
  if (
    !Array.isArray(provider.dataKinds) ||
    provider.dataKinds.length === 0 ||
    provider.dataKinds.some((kind) => !PROVIDER_DATA_KINDS.includes(kind)) ||
    new Set(provider.dataKinds).size !== provider.dataKinds.length
  )
    throw new RemoteProviderConsentError(
      "A provider must declare unique supported data kinds.",
    );
  if (provider.execution === "remote") {
    let endpoint: URL;
    try {
      endpoint = new URL(provider.endpoint ?? "");
    } catch {
      throw new RemoteProviderConsentError(
        "A remote provider must disclose a valid endpoint.",
      );
    }
    if (
      !["http:", "https:"].includes(endpoint.protocol) ||
      endpoint.username ||
      endpoint.password
    )
      throw new RemoteProviderConsentError(
        "A remote provider endpoint must be an HTTP(S) URL without embedded credentials.",
      );
  }
}

export function validateRemoteProviderConsent(
  value: unknown,
): RemoteProviderConsent {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new RemoteProviderConsentError(
      "Explicit remote provider consent must be an object.",
    );
  const data = value as Record<string, unknown>;
  if (typeof data.providerId !== "string" || !data.providerId.trim())
    throw new RemoteProviderConsentError("Consent must identify a provider.");
  if (
    !Array.isArray(data.dataKinds) ||
    data.dataKinds.length === 0 ||
    data.dataKinds.some(
      (kind) => !PROVIDER_DATA_KINDS.includes(kind as ProviderDataKind),
    ) ||
    new Set(data.dataKinds).size !== data.dataKinds.length
  )
    throw new RemoteProviderConsentError(
      "Consent must explicitly list unique supported data kinds.",
    );
  if (
    typeof data.grantedAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      data.grantedAt,
    ) ||
    !Number.isFinite(Date.parse(data.grantedAt))
  )
    throw new RemoteProviderConsentError(
      "Consent must include an ISO 8601 grantedAt timestamp with a timezone.",
    );
  return {
    providerId: data.providerId,
    dataKinds: [...data.dataKinds] as ProviderDataKind[],
    grantedAt: data.grantedAt,
  };
}

/** Call this immediately before passing any payload to a remote provider. */
export function assertProviderConsent(
  provider: AIProviderDescriptor,
  consent?: RemoteProviderConsent,
  requiredDataKinds: readonly ProviderDataKind[] = [],
): void {
  validateProviderDescriptor(provider);
  if (provider.execution === "local") return;
  if (!consent)
    throw new RemoteProviderConsentError(
      `Remote provider ${provider.id} is disabled. Explicit opt-in is required before sending media or metadata.`,
    );
  const validated = validateRemoteProviderConsent(consent);
  if (validated.providerId !== provider.id)
    throw new RemoteProviderConsentError(
      `Consent for ${validated.providerId} does not authorize provider ${provider.id}.`,
    );
  const undeclared = requiredDataKinds.filter(
    (kind) => !provider.dataKinds.includes(kind),
  );
  if (undeclared.length)
    throw new RemoteProviderConsentError(
      `Provider ${provider.id} has not disclosed the payload data kinds: ${undeclared.join(", ")}.`,
    );
  const missing = [
    ...new Set([...provider.dataKinds, ...requiredDataKinds]),
  ].filter((kind) => !validated.dataKinds.includes(kind));
  if (missing.length)
    throw new RemoteProviderConsentError(
      `Consent for ${provider.id} does not include: ${missing.join(", ")}.`,
    );
}
