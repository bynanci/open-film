import type {
  AnalysisProvider,
  AssetScorer,
  CompositionRenderer,
  CompositionSolver,
  MediaSourceAdapter,
  MetadataProvider,
  StoryTemplate,
  TimelineExporter,
} from "./ports.js";

export const PLUGIN_API_VERSION = "1" as const;

export const PLUGIN_CAPABILITIES = [
  "source",
  "metadata",
  "analysis",
  "story-template",
  "scorer",
  "solver",
  "effect",
  "exporter",
  "renderer",
  "ui-extension",
] as const;

export type PluginCapability = (typeof PLUGIN_CAPABILITIES)[number];

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  apiVersion: typeof PLUGIN_API_VERSION;
  capabilities: PluginCapability[];
  description?: string;
}

export interface OpenFilmPlugin {
  manifest: PluginManifest;
  sources?: MediaSourceAdapter[];
  metadata?: MetadataProvider[];
  analyses?: AnalysisProvider[];
  templates?: StoryTemplate[];
  scorers?: AssetScorer[];
  solvers?: CompositionSolver[];
  exporters?: TimelineExporter[];
  renderers?: CompositionRenderer[];
}

export class PluginValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PluginValidationError";
  }
}

function manifestString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim())
    throw new PluginValidationError(
      `Plugin ${field} must be a non-empty string.`,
    );
  return value;
}

export function validatePluginManifest(value: unknown): PluginManifest {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new PluginValidationError("Plugin manifest must be an object.");
  const data = value as Record<string, unknown>;
  const id = manifestString(data.id, "id");
  if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(id))
    throw new PluginValidationError(
      "Plugin id must use lowercase letters, numbers, and . _ - separators.",
    );
  const name = manifestString(data.name, "name");
  const version = manifestString(data.version, "version");
  if (
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(
      version,
    )
  )
    throw new PluginValidationError(
      "Plugin version must be a semantic version such as 0.1.0.",
    );
  if (data.apiVersion !== PLUGIN_API_VERSION)
    throw new PluginValidationError(
      `Unsupported plugin API version ${String(data.apiVersion)}; supported version is ${PLUGIN_API_VERSION}.`,
    );
  if (!Array.isArray(data.capabilities) || data.capabilities.length === 0)
    throw new PluginValidationError(
      "Plugin capabilities must be a non-empty array.",
    );
  const capabilities = data.capabilities.map((capability) => {
    if (!PLUGIN_CAPABILITIES.includes(capability as PluginCapability))
      throw new PluginValidationError(
        `Unsupported plugin capability ${String(capability)}.`,
      );
    return capability as PluginCapability;
  });
  if (new Set(capabilities).size !== capabilities.length)
    throw new PluginValidationError("Plugin capabilities must be unique.");
  const description =
    data.description === undefined
      ? undefined
      : manifestString(data.description, "description");
  return {
    id,
    name,
    version,
    apiVersion: PLUGIN_API_VERSION,
    capabilities,
    ...(description === undefined ? {} : { description }),
  };
}

/** Verify that executable ports match what a manifest declares. */
export function validatePlugin(plugin: OpenFilmPlugin): OpenFilmPlugin {
  const manifest = validatePluginManifest(plugin.manifest);
  const ports = {
    sources: "source",
    metadata: "metadata",
    analyses: "analysis",
    templates: "story-template",
    scorers: "scorer",
    solvers: "solver",
    exporters: "exporter",
    renderers: "renderer",
  } as const;
  const portIds = new Set<string>();
  const methods = {
    sources: ["supports", "scan", "extractMetadata"],
    metadata: ["supports", "extract"],
    analyses: ["analyze"],
    templates: ["create"],
    scorers: ["score"],
    solvers: ["compose"],
    exporters: ["export"],
    renderers: ["render"],
  } as const;
  for (const [key, capability] of Object.entries(ports)) {
    const entries = plugin[key as keyof typeof ports];
    if (entries === undefined) continue;
    if (!Array.isArray(entries))
      throw new PluginValidationError(`Plugin ${key} must be an array.`);
    if (entries.length && !manifest.capabilities.includes(capability))
      throw new PluginValidationError(
        `Plugin ${manifest.id} supplies ${key} without declaring ${capability}.`,
      );
    for (const port of entries) {
      if (!port || typeof port !== "object")
        throw new PluginValidationError(
          `Plugin ${key} port must be an object.`,
        );
      const id = manifestString(port.id, `${key} port id`);
      for (const method of methods[key as keyof typeof ports]) {
        if (
          typeof (port as unknown as Record<string, unknown>)[method] !==
          "function"
        )
          throw new PluginValidationError(
            `Plugin ${key} port ${id} must implement ${method}.`,
          );
      }
      const scopedId = `${capability}:${id}`;
      if (portIds.has(scopedId))
        throw new PluginValidationError(
          `Duplicate ${capability} port ID ${id}.`,
        );
      portIds.add(scopedId);
    }
  }
  return { ...plugin, manifest };
}
