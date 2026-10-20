import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { validateProject } from "../src/index.js";
import {
  graphicSchemaCases,
  graphicSchemaProject,
  graphicSchemaSemanticCases,
} from "../../../tests/fixtures/graphic-schema.js";

// Reuse the locked validator already required by ESLint. The public document's
// graphics definitions use keywords shared by draft-07 and 2020-12; remove only
// its meta-schema declaration for this draft-07 implementation. Independent
// 2020-12 validation exercises the unchanged public document as well.
const toolingRequire = createRequire(
  createRequire(import.meta.url).resolve("eslint"),
);
const Ajv = toolingRequire("ajv") as new (options: object) => {
  compile: (schema: object) => {
    (value: unknown): boolean;
    errors?: unknown;
  };
};
const schema = JSON.parse(
  readFileSync(resolve("schemas/openfilm-project-1.0.0.schema.json"), "utf8"),
) as Record<string, unknown>;
const compatibleSchema = structuredClone(schema);
delete compatibleSchema.$schema;
const validate = new Ajv({ allErrors: true, strictNumbers: true }).compile(
  compatibleSchema,
);

describe("published GraphicScene schema admission", () => {
  it.each(graphicSchemaCases)("$name", ({ scenes, valid }) => {
    const project = graphicSchemaProject(scenes);
    expect(validate(project), JSON.stringify(validate.errors)).toBe(valid);
    if (valid) {
      expect(validateProject(project)).toEqual(project);
    } else expect(() => validateProject(project)).toThrow();
  });

  it.each(graphicSchemaSemanticCases)(
    "retains authoritative runtime checks: $name",
    ({ scenes }) => {
      expect(() => validateProject(graphicSchemaProject(scenes))).toThrow();
    },
  );

  it("retains schema 1.0.0 and only local data references", () => {
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(schema.$id).toBe(
      "https://openfilm.dev/schemas/openfilm-project-1.0.0.schema.json",
    );
    const visit = (value: unknown) => {
      if (!value || typeof value !== "object") return;
      for (const [key, item] of Object.entries(value)) {
        if (key === "$ref") expect(item).toMatch(/^#\//u);
        visit(item);
      }
    };
    visit(schema);
    expect(graphicSchemaProject().schemaVersion).toBe("1.0.0");
  });
});
