import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { ProjectCatalog } from "@openfilm/catalog";
import type { LanguageProvider } from "@openfilm/plugin-sdk";
import { OpenFilmApplication } from "../src/index.js";

const cleanups: (() => Promise<unknown> | void)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function invalidProvider(): LanguageProvider {
  return {
    id: "misconfigured-review",
    name: "Invalid runtime fixture",
    kind: "language",
    execution: "local",
    dataKinds: ["text", "transcripts"],
  } as LanguageProvider;
}

it("closes the catalog when invalid runtime review configuration rejects project creation, and permits reopening", async () => {
  const root = await mkdtemp(join(tmpdir(), "openfilm-runtime-create-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const close = vi.spyOn(ProjectCatalog.prototype, "close");
  const directory = join(root, "film.openfilm");
  await expect(
    OpenFilmApplication.create(
      directory,
      "Film",
      {},
      {
        languageProvider: invalidProvider(),
        userDataDirectory: join(root, "user-data"),
      },
    ),
  ).rejects.toThrow("implemented operation");
  expect(close).toHaveBeenCalledOnce();
  const recovered = await OpenFilmApplication.open(directory, {
    userDataDirectory: join(root, "user-data"),
  });
  cleanups.push(() => recovered.close());
  expect(recovered.knowledge.languageProvider()).toEqual({
    configured: false,
    available: false,
  });
});

it("closes a failed open's catalog without losing a previously saved project", async () => {
  const root = await mkdtemp(join(tmpdir(), "openfilm-runtime-open-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, "film.openfilm");
  const original = await OpenFilmApplication.create(
    directory,
    "Keep my film",
    {},
    { userDataDirectory: join(root, "user-data") },
  );
  original.close();
  const close = vi.spyOn(ProjectCatalog.prototype, "close");
  await expect(
    OpenFilmApplication.open(directory, {
      languageProvider: invalidProvider(),
      userDataDirectory: join(root, "user-data"),
    }),
  ).rejects.toThrow("implemented operation");
  expect(close).toHaveBeenCalledOnce();
  const recovered = await OpenFilmApplication.open(directory, {
    userDataDirectory: join(root, "user-data"),
  });
  cleanups.push(() => recovered.close());
  expect(recovered.project.title).toBe("Keep my film");
});
