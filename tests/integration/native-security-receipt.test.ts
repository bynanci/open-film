// SPDX-License-Identifier: Apache-2.0
import { afterEach, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  pinFile,
  type CandidateIdentity,
  type Observation,
} from "../../scripts/native/receipt-contract.js";
import { verifySecurityClosure } from "../../scripts/native/receipt-security.js";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "security-bridge-"));
  roots.push(root);
  const candidateSha = execFileSync(
    "python",
    [resolve("tests/fixtures/native-security-replay.py"), root],
    { encoding: "utf8", stdio: "pipe" },
  ).trim();
  const paths = [
    "admission.json",
    "source.json",
    "closure.json",
    "controls/regression.json",
    "metadata.json",
    "audit/audit.json",
    "audit/actual-metadata.stdout",
    "audit/current-registry-metadata.stdout",
    "audit/current-registry-Cargo.lock",
    "audit/historical-Cargo.lock",
    "audit/advisory-db.bundle",
    ...["actual", "currentRegistry", "historical"].flatMap((name) => [
      `audit/${name}.stdout`,
      `audit/${name}.stderr`,
    ]),
  ];
  const observation = async () =>
    ({
      raw: await Promise.all(
        paths.map((path) => pinFile(root, `evidence/${path}`)),
      ),
    }) as Observation;
  return {
    root,
    paths,
    observation,
    identity: { candidateSha } as CandidateIdentity,
  };
}
it("replays the complete policy through the real TS/Python bridge with Python float bytes intact", async () => {
  const f = await fixture();
  expect(
    await readFile(join(f.root, "evidence/audit/audit.json"), "utf8"),
  ).toContain('"seconds":1.0');
  await expect(
    verifySecurityClosure(f.root, await f.observation(), f.identity),
  ).resolves.toBeUndefined();
  // This is a synthetic protocol test. No final receipt/distribution approval.
});
it.each([
  "actual-metadata.stdout",
  "current-registry-metadata.stdout",
  "current-registry-Cargo.lock",
  "historical-Cargo.lock",
  "advisory-db.bundle",
  "dirty-source",
  "source.json",
  "stale-candidate",
])(
  "rejects re-pinned %s while optimistic audit flags remain unchanged",
  async (name) => {
    const f = await fixture();
    const path = join(
      f.root,
      name === "source.json" ? "evidence" : "evidence/audit",
      name,
    );
    if (name === "stale-candidate")
      execFileSync(
        "git",
        [
          "-c",
          "user.name=Fixture",
          "-c",
          "user.email=fixture@example.invalid",
          "commit",
          "--allow-empty",
          "-qm",
          "different candidate",
        ],
        { cwd: f.root },
      );
    else if (name === "source.json") await writeFile(path, "{}");
    else if (name.endsWith("metadata.stdout")) {
      const value = JSON.parse(await readFile(path, "utf8"));
      value.resolve.nodes[0].features.push("tampered");
      await writeFile(path, JSON.stringify(value));
    } else if (name === "advisory-db.bundle") {
      const db = join(f.root, "evidence/audit/advisory-db");
      execFileSync(
        "git",
        [
          "-c",
          "user.name=Fixture",
          "-c",
          "user.email=fixture@example.invalid",
          "commit",
          "--allow-empty",
          "-qm",
          "changed database",
        ],
        { cwd: db },
      );
      await rm(path);
      execFileSync("git", ["bundle", "create", path, "HEAD"], { cwd: db });
    } else if (name === "dirty-source")
      await writeFile(join(f.root, "unreviewed-source.txt"), "dirty");
    else
      await writeFile(
        path,
        (await readFile(path, "utf8")) +
          '\n[[package]]\nname="unreviewed"\nversion="1.0.0"\n',
      );
    const errors: Record<string, RegExp> = {
      "actual-metadata.stdout": /audit and closure graphs differ/u,
      "current-registry-metadata.stdout":
        /current registry metadata\/feature graph differs/u,
      "current-registry-Cargo.lock":
        /current registry complete lock graph differs/u,
      "historical-Cargo.lock": /captured historical lock changed/u,
      "advisory-db.bundle": /captured database changed/u,
      "dirty-source": /checkout differs from candidate commit/u,
      "source.json": /source evidence changed/u,
      "stale-candidate": /stale checkout/u,
    };
    await expect(
      verifySecurityClosure(f.root, await f.observation(), f.identity),
    ).rejects.toThrow(errors[name]);
    if (name === "dirty-source") {
      const output = join(f.root, "evidence/blocked-admission.json");
      expect(() =>
        execFileSync(
          "python",
          [
            resolve("scripts/security/native-admission.py"),
            "--repository",
            f.root,
            "--evidence-dir",
            join(f.root, "evidence"),
            "--output",
            output,
          ],
          { stdio: "pipe" },
        ),
      ).toThrow();
      const blocked = JSON.parse(await readFile(output, "utf8"));
      expect(blocked).toMatchObject({
        admission: "blocked",
        candidateSHA: f.identity.candidateSha,
        reasons: ["checkout differs from candidate commit"],
      });
      expect(Object.keys(blocked.reports)).toHaveLength(3);
    }
  },
);
it("requires every original audit role rather than accepting optimistic summary flags", async () => {
  const f = await fixture();
  for (const name of [
    "actual-metadata.stdout",
    "current-registry-metadata.stdout",
    "current-registry-Cargo.lock",
    "historical-Cargo.lock",
    "advisory-db.bundle",
  ]) {
    const observation = await f.observation();
    observation.raw = observation.raw.filter(
      (pin) => !pin.path.endsWith(`/${name}`),
    );
    await expect(
      verifySecurityClosure(f.root, observation, f.identity),
    ).rejects.toThrow(`Security closure requires exactly one retained ${name}`);
  }
});
