import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { buildContributionPlugin } from "../../scripts/build-attribution.mjs";

it("attributes async Vue CSS assets to their emitted style modules", async () => {
  const root = await mkdtemp(join(tmpdir(), "openfilm-build-attribution-"));
  try {
    const output = join(root, "apps/desktop/dist");
    const source = join(root, "apps/desktop/src/AsyncPanel.vue");
    const cssName = "assets/AsyncPanel-stylehash.css";
    const jsName = "assets/AsyncPanel-jshash.js";
    await mkdir(join(output, "assets"), { recursive: true });
    await mkdir(join(root, "apps/desktop/src"), { recursive: true });
    await mkdir(join(root, "dist"), { recursive: true });
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ name: "openfilm", version: "1.0.0" }),
    );
    await writeFile(
      join(root, "pnpm-lock.yaml"),
      "lockfileVersion: '9.0'\nsettings: {}\npackages: {}\nsnapshots: {}\n",
    );
    await writeFile(source, "<template><div>Deferred panel</div></template>");
    await writeFile(join(root, "apps/desktop/index.html"), "<!doctype html>");
    await writeFile(join(output, "index.html"), "<!doctype html>");
    await writeFile(join(output, cssName), ".async-panel{color:red}");
    await writeFile(join(output, jsName), "export default {};\n");

    const styleModule = `${source}?vue&type=style&index=0&lang.css`;
    const scriptModule = `${source}?vue&type=script&lang.ts`;
    const bundle = {
      [cssName]: {
        type: "asset",
        fileName: cssName,
        name: "AsyncPanel.css",
        originalFileName: null,
        originalFileNames: [],
        source: ".async-panel{color:red}",
      },
      [jsName]: {
        type: "chunk",
        fileName: jsName,
        name: "AsyncPanel",
        modules: {
          [styleModule]: { renderedLength: 1 },
          [scriptModule]: { renderedLength: 20 },
        },
      },
      "index.html": {
        type: "asset",
        fileName: "index.html",
        originalFileName: null,
        originalFileNames: [],
        source: "<!doctype html>",
      },
    };
    const plugin = buildContributionPlugin(root);
    if (!plugin.writeBundle || typeof plugin.writeBundle !== "function")
      throw new Error("Build attribution plugin has no writeBundle hook");
    await plugin.writeBundle.call(
      undefined as never,
      { dir: output } as never,
      bundle as never,
    );

    const receipt = JSON.parse(
      await readFile(join(root, "dist/attribution/desktop.json"), "utf8"),
    ) as {
      artifacts: Array<{
        path: string;
        inputs: Array<{ path: string }>;
      }>;
    };
    const cssArtifact = receipt.artifacts.find((artifact) =>
      artifact.path.endsWith(cssName),
    );
    expect(cssArtifact?.inputs.map(({ path }) => path)).toContain(
      "apps/desktop/src/AsyncPanel.vue",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
