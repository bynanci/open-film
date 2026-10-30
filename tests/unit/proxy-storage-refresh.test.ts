import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import { expect, it, vi } from "vitest";
function setup() {
  const source = readFileSync("apps/desktop/src/App.vue", "utf8");
  const start = source.indexOf("async function proxyStorageChanged(");
  expect(start).toBeGreaterThan(-1);
  const text = source.slice(start, source.indexOf("\n}", start) + 2);
  const project = { value: { id: "one" } },
    sourceVersion = { value: 0 },
    error = { value: undefined as unknown };
  let reject!: (error: unknown) => void;
  const refreshJobs = vi.fn(
    () =>
      new Promise<void>((_yes, no) => {
        reject = no;
      }),
  );
  const handle = new Function(
    "project",
    "sourceVersion",
    "error",
    "refreshJobs",
    `${transformSync(text, { loader: "ts", format: "esm" }).code}\nreturn proxyStorageChanged;`,
  )(project, sourceVersion, error, refreshJobs) as (
    id: string,
  ) => Promise<void>;
  return {
    project,
    sourceVersion,
    error,
    refreshJobs,
    handle,
    reject: (cause: unknown) => reject(cause),
  };
}
it("contains a failed activity refresh after acknowledged preview changes", async () => {
  const f = setup();
  const pending = f.handle("one");
  const cause = new Error("local service stopped");
  f.reject(cause);
  await pending;
  expect(f.sourceVersion.value).toBe(1);
  expect(f.error.value).toBe(cause);
});
it("does not publish a delayed preview refresh error into another project", async () => {
  const f = setup();
  const pending = f.handle("one");
  f.project.value = { id: "two" };
  f.reject(new Error("old project closed"));
  await pending;
  expect(f.error.value).toBeUndefined();
  await f.handle("one");
  expect(f.refreshJobs).toHaveBeenCalledTimes(1);
});
