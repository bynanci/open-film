// SPDX-License-Identifier: Apache-2.0
import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { join, win32 } from "node:path";
import { promisify } from "node:util";
import { expect } from "vitest";
import { windowsPowerShellEnvironment } from "../../packages/application/src/windows-powershell.js";

// Independent fixture paths, not the renderer's font resolver. CI installs and
// hashes these distinct OFL faces; exact hashes must still appear in receipts.
export function testCjkFont(family: "Sans" | "Serif", weight = "Regular") {
  if (process.env.OPENFILM_TEST_FONT_ROOT) {
    return join(
      process.env.OPENFILM_TEST_FONT_ROOT,
      `Noto${family}CJKtc-${weight}.otf`,
    );
  }
  return process.platform === "win32"
    ? join(
        process.env.WINDIR || "C:\\Windows",
        "Fonts",
        `Noto${family}CJKtc-${weight}.otf`,
      )
    : `/usr/share/fonts/opentype/noto/Noto${family}CJK-${weight}.ttc`;
}

/** Assert actual OS access controls; Win32 mode bits do not describe its DACL. */
export async function expectPrivateStorage(path: string, mode: 0o600 | 0o700) {
  if (process.platform !== "win32") {
    expect((await stat(path)).mode & 0o777).toBe(mode);
    return;
  }
  const systemRoot = process.env.SystemRoot;
  if (!systemRoot || !win32.isAbsolute(systemRoot))
    throw new Error(
      "Windows ACL verification needs a trusted system directory.",
    );
  const { stdout } = await promisify(execFile)(
    win32.join(
      systemRoot,
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    ),
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "$ErrorActionPreference='Stop'; " +
        "$acl=Get-Acl -LiteralPath $env:OPENFILM_QA_ACL_PATH; " +
        "$self=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; " +
        "$trusted=@($self,'S-1-5-18','S-1-5-32-544'); " +
        "$allows=@($acl.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier]) | Where-Object {$_.AccessControlType -eq 'Allow'}); " +
        "$untrusted=@($allows | Where-Object {$_.IdentityReference.Value -notin $trusted -and -not ($_.IdentityReference.Value -eq 'S-1-3-0' -and ($_.PropagationFlags -band [System.Security.AccessControl.PropagationFlags]::InheritOnly))}); " +
        "ConvertTo-Json -Compress -InputObject @{ownerTrusted=($acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -in $trusted);canonical=$acl.AreAccessRulesCanonical;hasAllow=($allows.Count -gt 0);untrustedAllowCount=$untrusted.Count}",
    ],
    {
      env: {
        ...windowsPowerShellEnvironment(systemRoot),
        OPENFILM_QA_ACL_PATH: path,
      },
      windowsHide: true,
      timeout: 10_000,
      maxBuffer: 4096,
    },
  );
  // Only booleans/counts appear in failures: do not log machine/user SIDs.
  expect(JSON.parse(stdout.trim())).toEqual({
    ownerTrusted: true,
    canonical: true,
    hasAllow: true,
    untrustedAllowCount: 0,
  });
}
