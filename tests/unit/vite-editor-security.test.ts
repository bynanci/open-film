// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve, win32 } from "node:path";
import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";

const require = createRequire(import.meta.url);
const bundle = readFileSync(
  process.env.OPENFILM_TEST_VITE_EDITOR_BUNDLE ??
    join(
      dirname(require.resolve("vite/package.json")),
      "dist/node/chunks/node.js",
    ),
  "utf8",
);
// Execute the installed dependency's launch-editor modules, including its
// Windows branch, with filesystem/child boundaries replaced by inert controls.
// This is not a Windows workstation or actual shell-execution test.
function editor() {
  const modules = bundle
    .split("//#region ")
    .filter((region) =>
      /\/node_modules\/launch-editor\/(?:construct-windows-launch-command|parse-file|index)\.js\n/u.test(
        region.split("\n", 1)[0]! + "\n",
      ),
    )
    .map(
      (region) =>
        region.slice(region.indexOf("\n") + 1).split("//#endregion")[0],
    )
    .join("\n");
  if (!modules.includes("var require_launch_editor ="))
    throw new Error("Installed Vite launch-editor module was not found");
  const commands: string[] = [];
  const errors: string[] = [];
  const child = { on: () => child };
  const launch = runInNewContext(
    `${modules}\nrequire_launch_editor()`,
    {
      __commonJSMin: (
        factory: (exports: object, module: { exports: object }) => void,
      ) => {
        const module = { exports: {} };
        return () => {
          factory(module.exports, module);
          return module.exports;
        };
      },
      __require: (id: string) => {
        if (id === "fs") return { existsSync: () => true };
        if (id === "os") return { release: () => "Windows_NT" };
        if (id === "path") return win32;
        if (id === "child_process")
          return {
            exec: (command: string) => {
              commands.push(command);
              return child;
            },
            spawn: () => {
              throw new Error("Expected the actual Windows launcher branch");
            },
          };
        throw new Error(`Unexpected dependency boundary: ${id}`);
      },
      require_picocolors: () => ({ red: (value: string) => value }),
      require_guess: () => () => ["code.cmd"],
      require_get_args: () => (_editor: string, file: string) => [file],
      process: { platform: "win32" },
      console: { log: () => {} },
    },
    { filename: resolve("node_modules/vite/launch-editor-regression.js") },
  ) as (
    file: string,
    editor: string,
    onError: (_file: string, message: string) => void,
  ) => void;
  return {
    commands,
    errors,
    launch: (file: string) =>
      launch(file, "code.cmd", (_file, message) => errors.push(message)),
  };
}

it.each([
  [String.raw`C:\review\100%\file.ts`, 'containing "%"'],
  [String.raw`C:\review\%CD%\file.ts`, 'containing "%"'],
  [String.raw`C:\review\%VAR:old=new%\file.ts`, 'containing "%"'],
  ["C:\\review\\file.ts\rcalc-sentinel", "line break"],
  ["C:\\review\\file.ts\ncalc-sentinel", "line break"],
])("does not send rejected editor path %j to cmd", (file, reason) => {
  const control = editor();
  control.launch(file);
  expect(control.commands).toEqual([]);
  expect(control.errors).toHaveLength(1);
  expect(control.errors[0]).toContain(reason);
});

it("retains ordinary editor paths with spaces and escaped ampersands", () => {
  const control = editor();
  control.launch(String.raw`C:\review project\safe&file.ts`);
  expect(control.errors).toEqual([]);
  expect(control.commands).toEqual([
    String.raw`code.cmd ^"C:\review project\safe^&file.ts^"`,
  ]);
});
