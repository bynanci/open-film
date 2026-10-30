// SPDX-License-Identifier: Apache-2.0
import {
  ApplicationError,
  parsePresetJson,
  validatePresetApplyInput,
} from "@openfilm/core";
import {
  LocalPresetRegistry,
  TimelineEditor,
  readLocalPresetDocument,
  type OpenFilmApplication,
  type PresetRecoveryInput,
} from "@openfilm/application";
type Options = Record<string, string | boolean>;
function required(options: Options, name: string): string {
  const v = options[name];
  if (typeof v !== "string" || !v)
    throw new ApplicationError(
      "request.invalid",
      `Preset operation requires --${name}.`,
    );
  return v;
}
export async function runLocalPresetCommand(
  positional: string[],
  options: Options,
  userDataDirectory: string,
): Promise<unknown> {
  const registry = new LocalPresetRegistry(userDataDirectory),
    action = positional[1];
  if (action === "list") return registry.list();
  if (action === "review")
    return registry.reviewImport(
      await readLocalPresetDocument(required(options, "file")),
    );
  if (action === "install") {
    if (options["accept-license"] !== true)
      throw new ApplicationError(
        "presets.invalid",
        "Review and acknowledge the declared license with --accept-license.",
      );
    return registry.install({
      document: await readLocalPresetDocument(required(options, "file")),
      packageSha256: required(options, "package-sha"),
      baseRegistryRevision: required(options, "base-revision"),
      reviewSha256: required(options, "review-sha"),
      acknowledgeLicense: true,
    });
  }
  if (action === "remove")
    return registry.remove({
      packageId: required(options, "package-id"),
      packageVersion: required(options, "package-version"),
      packageSha256: required(options, "package-sha"),
      baseRegistryRevision: required(options, "base-revision"),
    });
  if (action === "recovery" && positional[2] === "review")
    return registry.reviewRecovery();
  if (action === "recovery" && positional[2] === "accept") {
    if (options["accept-recovery"] !== true)
      throw new ApplicationError(
        "presets.invalid",
        "Acknowledge backup recovery with --accept-recovery.",
      );
    const review = parsePresetJson(
      await readLocalPresetDocument(required(options, "file")),
    );
    return registry.recover({
      ...(review as PresetRecoveryInput),
      acknowledgeRecovery: true,
    });
  }
  throw new ApplicationError(
    "request.invalid",
    "Choose presets list, review, install, remove, recovery review/accept, or apply review/accept.",
  );
}
export async function runPresetApplicationCommand(
  app: OpenFilmApplication,
  positional: string[],
  options: Options,
): Promise<unknown> {
  const request = validatePresetApplyInput(
      parsePresetJson(
        await readLocalPresetDocument(required(options, "request")),
      ),
    ),
    editor = new TimelineEditor(app);
  if (positional[2] === "review") return app.presets.review(request, editor);
  if (positional[2] === "accept")
    return app.presets.accept(
      {
        request,
        reviewSha256: required(options, "review-sha"),
        requestId: required(options, "request-id"),
      },
      editor,
    );
  throw new ApplicationError(
    "request.invalid",
    "Choose presets apply review or accept.",
  );
}
