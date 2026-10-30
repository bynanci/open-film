// SPDX-License-Identifier: Apache-2.0
import { win32 } from "node:path";

/** Keep the inbox Windows PowerShell from loading Core or user/project modules. */
export function windowsPowerShellEnvironment(
  systemRoot: string,
): NodeJS.ProcessEnv {
  if (!win32.isAbsolute(systemRoot))
    throw new Error("A trusted Windows system directory is required.");
  const environment: NodeJS.ProcessEnv = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => key.toLowerCase() !== "psmodulepath",
    ),
  );
  environment.PSModulePath = win32.join(
    systemRoot,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "Modules",
  );
  return environment;
}
