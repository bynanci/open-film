/**
 * Explicit browser-test entry only. Predetermined text exercises review jobs,
 * batches and user decisions; it is not AI, ASR, or language-quality evidence.
 * The normal production server never installs this LanguageProvider.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { LanguageProvider } from "@openfilm/plugin-sdk";
import { startServer } from "../../apps/server/src/server.js";

const userDataDirectory = await mkdtemp(
  join(tmpdir(), "openfilm-browser-user-data-"),
);
process.env.OPENFILM_USER_DATA_DIR = userDataDirectory;
const provider: LanguageProvider = {
  id: "fixture-local-language-review",
  name: "Deterministic local review fixture — not AI",
  kind: "language",
  execution: "local",
  dataKinds: ["text", "transcripts"],
  async generate(prompt, options) {
    const input = JSON.parse(prompt.slice(prompt.indexOf("\n") + 1)) as {
      language: string;
      segments: { segmentId: string; text: string }[];
      glossary: { source: string; replacement: string }[];
    };
    if (
      !Array.isArray(input.segments) ||
      input.segments.length > 100 ||
      input.segments.reduce((sum, row) => sum + row.text.length, 0) > 60000 ||
      input.glossary.length > 100
    ) {
      throw new Error("The review fixture received an unbounded batch.");
    }
    // Batch zero completes promptly; a later batch stays interruptible long
    // enough to exercise partial-result cancellation through the real job API.
    const ordinal = /Fixture line (\d+)/u.exec(input.segments[0]?.text ?? "");
    await delay(ordinal && Number(ordinal[1]) >= 50 ? 8000 : 150, undefined, {
      signal: options?.signal,
    });
    console.log(
      JSON.stringify({
        event: "test.language-fixture.batch",
        fixture: true,
        segmentCount: input.segments.length,
        textCharacters: input.segments.reduce(
          (sum, row) => sum + row.text.length,
          0,
        ),
      }),
    );
    return JSON.stringify({
      suggestions: input.segments.flatMap((row) => {
        if (row.text.endsWith(" [fixture reviewed]")) return [];
        return [
          {
            segmentId: row.segmentId,
            after: `${row.text} [fixture reviewed]`,
            reason:
              "TEST FIXTURE: a deterministic change for correction-review controls; not a language judgment.",
            confidence: 1,
          },
        ];
      }),
    });
  },
};
const runtime = await startServer({
  port: Number(process.env.OPENFILM_PORT ?? 4310),
  languageProvider: provider,
  userDataDirectory,
});
console.log(
  JSON.stringify({
    event: "server.ready",
    host: "127.0.0.1",
    port: runtime.port,
    testFixture: "transcript-productivity-not-ai",
    isolatedUserData: true,
  }),
);
let stopping = false;
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    if (stopping) return;
    stopping = true;
    void runtime.close().then(async () => {
      await rm(userDataDirectory, { recursive: true, force: true });
      process.exitCode = 0;
    });
  });
}
