// SPDX-License-Identifier: Apache-2.0
import { afterEach, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
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
    "audit/advisory-db.shallow",
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
      "advisory-db.bundle": /advisory snapshot bytes differ/u,
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
it("requires all 17 v2 payload roles and 18 minimal observation pins", async () => {
  const f = await fixture();
  expect((await f.observation()).raw).toHaveLength(18);
  expect(f.paths.filter((path) => path !== "admission.json")).toHaveLength(17);
  for (const name of f.paths.map((path) => path.split("/").at(-1)!)) {
    const observation = await f.observation();
    observation.raw = observation.raw.filter(
      (pin) => !pin.path.endsWith(`/${name}`),
    );
    await expect(
      verifySecurityClosure(f.root, observation, f.identity),
    ).rejects.toThrow(
      /^(actual|currentRegistry|historical)\.(stdout|stderr)$/u.test(name)
        ? /Missing\/tampered retained scanner output/u
        : `Security closure requires exactly one retained ${name}`,
    );
  }
});

it("rejects relocated source admission with an explicit original-path preflight", async () => {
  const f = await fixture();
  const observation = await f.observation();
  const moved = `${f.root}-relocated`;
  roots.push(moved);
  await rename(f.root, moved);
  await expect(
    verifySecurityClosure(moved, observation, f.identity),
  ).rejects.toThrow(
    /Source admission requires its original absolute checkout path/u,
  );
});
it("replays a visible-only v2 producer artifact without upstream repositories", async () => {
  const f = await fixture();
  const observation = await f.observation();
  const metadata = await readFile(join(f.root, "evidence/metadata.json"));
  const moved = `${f.root}-producer`;
  roots.push(moved);
  await rename(f.root, moved);
  execFileSync(
    "python",
    [
      "-c",
      "import os, subprocess, sys; os.umask(0o022); subprocess.run(['git', 'clone', '--no-local', *sys.argv[1:]], check=True)",
      moved,
      f.root,
    ],
    { stdio: "pipe" },
  );
  execFileSync("python", [
    "-c",
    `
import pathlib, sys, zipfile
source, destination = map(pathlib.Path, sys.argv[1:])
archive = source / "visible.zip"
with zipfile.ZipFile(archive, "w") as output:
    for path in (source / "evidence").rglob("*"):
        relative = path.relative_to(source)
        if path.is_file() and not any(p.startswith(".") for p in relative.parts):
            output.write(path, relative)
with zipfile.ZipFile(archive) as artifact: artifact.extractall(destination)
`,
    moved,
    f.root,
  ]);
  await rm(moved, { recursive: true });
  expect(await readFile(join(f.root, "evidence/metadata.json"))).toEqual(
    metadata,
  );
  await expect(
    readFile(join(f.root, "evidence/audit/advisory-db/.git/HEAD")),
  ).rejects.toThrow();
  await expect(
    verifySecurityClosure(f.root, observation, f.identity),
  ).resolves.toBeUndefined();
});

it.each(["workspace", "root-manifest", "glib-manifest"])(
  "preflights %s before cloning a malformed database",
  async (field) => {
    const f = await fixture();
    const path = join(f.root, "evidence/metadata.json");
    const metadata = JSON.parse(await readFile(path, "utf8"));
    if (field === "workspace") metadata.workspace_root += "-wrong";
    else
      metadata.packages[field === "root-manifest" ? 0 : 1].manifest_path +=
        "-wrong";
    await writeFile(path, JSON.stringify(metadata));
    await writeFile(
      join(f.root, "evidence/audit/advisory-db.bundle"),
      "malformed",
    );
    await expect(
      verifySecurityClosure(f.root, await f.observation(), f.identity),
    ).rejects.toThrow(
      /Source admission requires its original absolute checkout path/u,
    );
  },
);

it("rejects re-pinned invalid original shallow bytes", async () => {
  const f = await fixture();
  const path = join(f.root, "evidence/audit/advisory-db.shallow");
  const auditPath = join(f.root, "evidence/audit/audit.json");
  const original = await readFile(path);
  const audit = JSON.parse(await readFile(auditPath, "utf8"));
  for (const bytes of [
    Buffer.alloc(0),
    Buffer.from("0".repeat(40) + "\n"),
    original.subarray(0, 40),
    Buffer.from(original.toString().replace("\n", "\r\n")),
    Buffer.concat([original, original]),
  ]) {
    await writeFile(path, bytes);
    audit.dbSnapshot.shallow.size = bytes.length;
    audit.dbSnapshot.shallow.sha256 = createHash("sha256")
      .update(bytes)
      .digest("hex");
    await writeFile(auditPath, JSON.stringify(audit));
    await expect(
      verifySecurityClosure(f.root, await f.observation(), f.identity),
    ).rejects.toThrow(/advisory snapshot|shallow boundary/u);
  }
});
it("rejects duplicate sidecar roles and clean or stripped legacy captures", async () => {
  const f = await fixture();
  const observation = await f.observation();
  observation.raw.push(
    observation.raw.find((pin) => pin.path.endsWith("/advisory-db.shallow"))!,
  );
  await expect(
    verifySecurityClosure(f.root, observation, f.identity),
  ).rejects.toThrow(/exactly one retained advisory-db.shallow/u);
  const path = join(f.root, "evidence/audit/audit.json");
  const saved = JSON.parse(await readFile(path, "utf8"));
  for (const schemaVersion of [1, 3, true, "2"]) {
    for (const stripped of [false, true]) {
      const audit = { ...saved, schemaVersion };
      if (stripped) delete audit.dbSnapshot;
      await writeFile(path, JSON.stringify(audit));
      await expect(
        verifySecurityClosure(f.root, await f.observation(), f.identity),
      ).rejects.toThrow(/v2/u);
    }
  }
});
it("isolates DB replay from caller Git boundary, object, config and hook overrides", async () => {
  const f = await fixture();
  const observation = await f.observation();
  const foreign = join(f.root, "evidence/foreign-shallow");
  const config = join(f.root, "evidence/gitconfig");
  const sentinel = join(f.root, "evidence/executed");
  await writeFile(foreign, "0".repeat(40) + "\n");
  await writeFile(config, `[core]\n hooksPath = ${sentinel}\n`);
  const overrides = {
    GIT_SHALLOW_FILE: foreign,
    GIT_OBJECT_DIRECTORY: join(f.root, "evidence/absent-objects"),
    GIT_ALTERNATE_OBJECT_DIRECTORIES: join(
      f.root,
      "evidence/absent-alternates",
    ),
    GIT_CONFIG_GLOBAL: config,
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "core.hooksPath",
    GIT_CONFIG_VALUE_0: sentinel,
  };
  const saved = Object.fromEntries(
    Object.keys(overrides).map((key) => [key, process.env[key]]),
  );
  try {
    Object.assign(process.env, overrides);
    await expect(
      verifySecurityClosure(f.root, observation, f.identity),
    ).resolves.toBeUndefined();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  expect(await readFile(foreign, "utf8")).toBe("0".repeat(40) + "\n");
  await expect(readFile(sentinel)).rejects.toThrow();
});
