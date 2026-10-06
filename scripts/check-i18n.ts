import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { applicationErrorCodes } from "@openfilm/core";
import enUS from "../apps/desktop/src/i18n/locales/en-US.js";
import zhTW from "../apps/desktop/src/i18n/locales/zh-TW.js";
import jaJP from "../apps/desktop/src/i18n/locales/ja-JP.js";
import {
  flattenMessages,
  translationProblems,
} from "../apps/desktop/src/i18n/coverage.js";

const baseline = flattenMessages(enUS);
const problems = [
  ...translationProblems(enUS, zhTW).map((problem) => `zh-TW: ${problem}`),
  ...translationProblems(enUS, jaJP).map((problem) => `ja-JP: ${problem}`),
  ...applicationErrorCodes
    .filter((code) => !baseline[`errors.${code}`])
    .map((code) => `Missing error translation: ${code}`),
];
async function checkLiteralKeys(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === "i18n") continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await checkLiteralKeys(path);
    else if (/\.(?:vue|ts)$/.test(path)) {
      const source = await readFile(path, "utf8");
      for (const match of source.matchAll(/\bt\(["']([\w.-]+)["']/g)) {
        if (!(match[1]! in baseline))
          problems.push(`${path}: Unknown translation key ${match[1]}`);
      }
    }
  }
}
await checkLiteralKeys("apps/desktop/src");
if (problems.length) {
  console.error(problems.join("\n"));
  process.exitCode = 1;
} else
  console.log(
    `i18n: ${Object.keys(baseline).length} semantic keys match in en-US, zh-TW and ja-JP; placeholders, application errors and literal UI references validated.`,
  );
