// SPDX-License-Identifier: Apache-2.0
import { expect, it } from "vitest";
import {
  createCargoPathResolver,
  type CargoPathMapping,
} from "../../scripts/native/receipt-paths.js";
function mapping(): CargoPathMapping {
  return {
    syntax: "win32",
    repositoryRoot: "C:\\agent\\repo",
    targetDirectory: "C:/agent/repo/target",
    externalRoots: [
      { originalRoot: "D:/cargo/registry", localRoot: "retained/registry" },
    ],
  };
}
it("projects both Windows separators and external registry reads without host path interpretation", () => {
  const resolve = createCargoPathResolver(
    "/capsule",
    "/capsule/target",
    mapping(),
  );
  expect(
    resolve("C:\\agent\\repo\\crates\\tool\\Cargo.toml", "workspace"),
  ).toBe("/capsule/crates/tool/Cargo.toml");
  expect(resolve("C:/agent/repo/crates/tool/Cargo.toml", "workspace")).toBe(
    "/capsule/crates/tool/Cargo.toml",
  );
  expect(resolve("D:/cargo/registry/serde/Cargo.toml", "registry")).toBe(
    "/capsule/retained/registry/serde/Cargo.toml",
  );
});
it.each([
  "C:/agent/repo/../secret",
  "C:/agent/repo//secret",
  "C:/agent/repo/./secret",
  "C:agent/repo/secret",
  "//server/share/secret",
  "\\\\?\\C:\\agent\\repo\\secret",
  "C:/agent/repo/CON",
  "C:/agent/repo/file:stream",
  "C:/agent/repo/file.",
  "C:/agent/repo/file ",
])("rejects ambiguous recorded path %s", (path) => {
  expect(() =>
    createCargoPathResolver(
      "/capsule",
      "/capsule/target",
      mapping(),
    )(path, "workspace"),
  ).toThrow();
});
it("rejects unknown roots, external workspace sources, target escapes and reserved capsule aliases", () => {
  const resolve = createCargoPathResolver(
    "/capsule",
    "/capsule/target",
    mapping(),
  );
  expect(() => resolve("Z:/unknown/file", "registry")).toThrow(
    "Unknown original Cargo path root",
  );
  expect(() =>
    resolve("D:/cargo/registry/tool/Cargo.toml", "workspace"),
  ).toThrow("Workspace Cargo source outside original repository");
  expect(() => resolve("C:/agent/repo/other/file", "artifact")).toThrow(
    "outside original target",
  );
  expect(() =>
    resolve("C:/agent/repo/retained/registry/tool/Cargo.toml", "workspace"),
  ).toThrow("reserved external Cargo root");
});
it.each([
  "original-ancestor",
  "original-descendant",
  "original-case-duplicate",
  "local-ancestor",
  "local-case-duplicate",
  "local-traversal",
  "local-absolute",
])("rejects %s root mappings", (fault) => {
  const value = mapping();
  if (fault === "original-ancestor")
    value.externalRoots[0]!.originalRoot = "C:/agent";
  if (fault === "original-descendant")
    value.externalRoots[0]!.originalRoot = "C:/agent/repo/crates";
  if (fault === "original-case-duplicate")
    value.externalRoots.push({
      originalRoot: "d:/CARGO/registry",
      localRoot: "other",
    });
  if (fault === "local-ancestor")
    value.externalRoots.push({
      originalRoot: "E:/registry",
      localRoot: "retained",
    });
  if (fault === "local-case-duplicate")
    value.externalRoots.push({
      originalRoot: "E:/registry",
      localRoot: "RETAINED/Registry",
    });
  if (fault === "local-traversal")
    value.externalRoots[0]!.localRoot = "../outside";
  if (fault === "local-absolute")
    value.externalRoots[0]!.localRoot = "/outside";
  expect(() =>
    createCargoPathResolver("/capsule", "/capsule/target", value),
  ).toThrow();
});
it("rejects Windows case aliases that could otherwise select two different Linux files", () => {
  const resolve = createCargoPathResolver(
    "/capsule",
    "/capsule/target",
    mapping(),
  );
  resolve("C:/agent/repo/target/Tool.exe", "artifact");
  expect(() => resolve("C:/agent/repo/target/tool.exe", "artifact")).toThrow(
    "Case alias",
  );
});
it("checks declared POSIX syntax independently and binds target root projection", () => {
  const value: CargoPathMapping = {
    syntax: "posix",
    repositoryRoot: "/build/source",
    targetDirectory: "/build/source/target",
    externalRoots: [],
  };
  expect(
    createCargoPathResolver(
      "/capsule",
      "/capsule/target",
      value,
    )("/build/source/src/Cargo.toml", "workspace"),
  ).toBe("/capsule/src/Cargo.toml");
  expect(() =>
    createCargoPathResolver("/capsule", "/capsule/other", value),
  ).toThrow("target directory mismatch");
  expect(() =>
    createCargoPathResolver(
      "/capsule",
      "/capsule/target",
      value,
    )("C:/build/source/file", "workspace"),
  ).toThrow("declared syntax");
});
