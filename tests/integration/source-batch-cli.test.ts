import { build } from "esbuild";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { OpenFilmApplication } from "@openfilm/application";
import { runProcess } from "@openfilm/media";
import { generateSampleMedia } from "../../fixtures/sample-media/generate.mjs";

let buildDirectory: string;
let cliPath: string;
const cleanup: string[] = [];

beforeAll(async () => {
  buildDirectory = await mkdtemp(
    join(tmpdir(), "openfilm-source-batch-cli-build-"),
  );
  cliPath = join(buildDirectory, "openfilm.mjs");
  await build({
    entryPoints: [resolve("apps/cli/src/index.ts")],
    outfile: cliPath,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    external: ["koffi"],
  });
});

afterAll(async () => rm(buildDirectory, { recursive: true, force: true }));
afterEach(async () => {
  await Promise.all(
    cleanup
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("shared source batch CLI", () => {
  it("adds a versioned native source manifest, seals it, and reads status", async () => {
    const root = await mkdtemp(join(tmpdir(), "openfilm-source-batch-cli-"));
    cleanup.push(root);
    const projectPath = join(root, "film.openfilm");
    const sourcesPath = join(root, "selected");
    const generated = join(root, "generated");
    const manifestPath = join(root, "sources-v1.json");
    const userDataPath = join(root, "user-data");
    await generateSampleMedia(generated);
    await mkdir(sourcesPath);
    const source = join(sourcesPath, "memory.png");
    await writeFile(source, await readFile(join(generated, "01-photo.png")));
    const app = await OpenFilmApplication.create(
      projectPath,
      "CLI source batch",
    );
    app.close();
    await writeFile(
      manifestPath,
      JSON.stringify({
        schemaVersion: 1,
        sources: [
          {
            kind: "folder",
            displayName: "Synthetic memories",
            accessClass: "native-path",
            accessRef: sourcesPath,
            recursive: true,
          },
        ],
      }),
    );

    const cli = async <T>(
      ...args: string[]
    ): Promise<{ value: T; output: string }> => {
      const response = await runProcess(process.execPath, [
        cliPath,
        ...args,
        "--project",
        projectPath,
        "--user-data-dir",
        userDataPath,
      ]);
      return {
        value: JSON.parse(response.stdout.toString("utf8")) as T,
        output: response.stdout.toString("utf8"),
      };
    };

    const added = await cli<{ revision: number; added: number }>(
      "import-batch",
      "add",
      "--manifest",
      manifestPath,
    );
    expect(added.value).toMatchObject({ revision: 1, added: 1 });
    expect(added.output).not.toContain(sourcesPath);

    const sealed = await cli<{
      result: {
        batch: { id: string; status: string };
        status: string;
        verified: number;
        verifiedManifest: { id: string };
      };
    }>("import-batch", "create");
    expect(sealed.value.result).toMatchObject({
      batch: { status: "sealed" },
      status: "sealed",
      verified: 1,
    });
    expect(sealed.output).not.toContain(sourcesPath);

    const status = await cli<{
      batch: { status: string };
      verifiedManifest: { members: unknown[] };
    }>("import-batch", "status", sealed.value.result.batch.id);
    expect(status.value).toMatchObject({
      batch: { status: "sealed" },
      verifiedManifest: { members: [{ assetId: expect.any(String) }] },
    });
    expect(status.output).not.toContain(sourcesPath);
    const analysis = await cli<{
      result: {
        run: { id: string; status: string; manifestId: string };
        results: Array<{ kind: string }>;
      };
    }>(
      "analysis-run",
      "create",
      "--manifest",
      sealed.value.result.verifiedManifest.id,
    );
    expect(analysis.value.result).toMatchObject({
      run: { status: "completed", manifestId: expect.any(String) },
      results: [{ kind: "event" }],
    });
    expect(analysis.output).not.toContain(sourcesPath);
    const visualAnalysis = await cli<{
      result: {
        run: { visualSampling: { algorithmVersion: string } };
        results: Array<{
          evidence: { type: string; status?: string; frameHash?: string };
        }>;
      };
    }>(
      "analysis-run",
      "create",
      "--manifest",
      sealed.value.result.verifiedManifest.id,
      "--visual-samples",
    );
    expect(visualAnalysis.value.result.run.visualSampling).toEqual({
      version: 1,
      algorithmVersion: "representative-frames-v1",
    });
    expect(
      visualAnalysis.value.result.results.some(
        ({ evidence }) =>
          evidence.type === "visual-sample" &&
          evidence.status === "unknown" &&
          /^[a-f0-9]{64}$/u.test(evidence.frameHash ?? ""),
      ),
    ).toBe(true);
    expect(visualAnalysis.output).not.toContain(sourcesPath);
    const analysisStatus = await cli<{
      run: { id: string; status: string };
      results: unknown[];
    }>("analysis-run", "status", analysis.value.result.run.id);
    expect(analysisStatus.value.run).toMatchObject({
      status: "completed",
      id: analysis.value.result.run.id,
    });
    expect(analysisStatus.value.results).toHaveLength(1);
    const allProject = await cli<{
      result: { run: { scopeMode: string; status: string } };
    }>(
      "analysis-run",
      "create",
      "--manifest",
      sealed.value.result.verifiedManifest.id,
      "--scope",
      "project-catalog",
      "--confirm-project-catalog",
    );
    expect(allProject.value.result.run).toMatchObject({
      scopeMode: "project-catalog",
      status: "completed",
    });
    const reopened = await OpenFilmApplication.open(projectPath);
    expect(reopened.catalog.listAssets()).toHaveLength(1);
    reopened.close();
  });

  it("rejects untrusted manifest fields and browser-local references", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "openfilm-source-manifest-invalid-"),
    );
    cleanup.push(root);
    const projectPath = join(root, "film.openfilm");
    const app = await OpenFilmApplication.create(
      projectPath,
      "Invalid manifest",
    );
    app.close();
    const manifestPath = join(root, "bad.json");
    await writeFile(
      manifestPath,
      JSON.stringify({
        schemaVersion: 1,
        html: "<script>alert(1)</script>",
        sources: [
          {
            kind: "folder",
            displayName: "unsafe",
            accessClass: "native-path",
            accessRef: "/synthetic",
          },
        ],
      }),
    );
    await expect(
      runProcess(process.execPath, [
        cliPath,
        "import-batch",
        "add",
        "--manifest",
        manifestPath,
        "--project",
        projectPath,
        "--user-data-dir",
        join(root, "user-data"),
      ]),
    ).rejects.toThrow();
  });
});
