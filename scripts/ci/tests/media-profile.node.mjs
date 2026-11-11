// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { StageRecorder, summarizeStages } from "../media-profile.mjs";
const exec = promisify(execFile);

test("stage observations retain real CPU, sampled RSS and failure without swallowing errors", async () => {
  const recorder = new StageRecorder();
  assert.equal(
    await recorder.measure("hash", async () => {
      const end = performance.now() + 25;
      while (performance.now() < end) Math.sqrt(Math.random());
      return 42;
    }),
    42,
  );
  const error = new Error("source changed");
  await assert.rejects(
    recorder.measure("failed", async () => {
      throw error;
    }),
    (e) => e === error,
  );
  const [passed, failed] = recorder.observations;
  assert.ok(passed.wallMs >= 20);
  assert.ok(passed.nodeCpuMs > 0);
  assert.ok(passed.nodePeakRssKiB > 0);
  assert.equal(passed.status, "succeeded");
  assert.equal(failed.status, "failed");
  assert.equal(failed.error, "source changed");
});

test("child observations preserve arguments, exact exit and CPU/RSS on failure", async () => {
  const dir = await mkdtemp(join(tmpdir(), "openfilm-profile-test-"));
  const log = join(dir, "commands.jsonl");
  try {
    const args = [
      "-c",
      "import time; start=time.monotonic();\nwhile time.monotonic()-start < 0.05: pass\nraise SystemExit(7)",
      "literal path with spaces",
    ];
    await assert.rejects(
      exec(
        "python3",
        [
          resolve("scripts/ci/media-profile-command.py"),
          "/usr/bin/python3",
          ...args,
        ],
        { env: { ...process.env, OPENFILM_PROFILE_COMMANDS: log } },
      ),
      { code: 7 },
    );
    const command = JSON.parse((await readFile(log, "utf8")).trim());
    assert.deepEqual(command.args, args);
    assert.equal(command.exitCode, 7);
    assert.ok(command.wallMs >= 40);
    assert.ok(command.userCpuMs + command.systemCpuMs > 0);
    assert.ok(command.peakRssKiB > 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("summary never adds nested stage wall times or averages missing observations", () => {
  const result = summarizeStages([
    { name: "pipeline", wallMs: 100, status: "succeeded" },
    { name: "render", wallMs: 80, status: "succeeded" },
    { name: "pipeline", wallMs: 120, status: "succeeded" },
    { name: "render", wallMs: 90, status: "failed" },
  ]);
  assert.deepEqual(result, {
    pipeline: {
      count: 2,
      failed: 0,
      minWallMs: 100,
      medianWallMs: 110,
      maxWallMs: 120,
    },
    render: {
      count: 1,
      failed: 1,
      minWallMs: 80,
      medianWallMs: 80,
      maxWallMs: 80,
    },
  });
});

test("comparison rejects changed synthetic source bytes and multiplicity", async () => {
  const { assertEquivalentSources } = await import("../media-profile.mjs");
  const baseline = [
    {
      args: ["-i", "color=c=blue:s=1280x720", "a.jpg"],
      syntheticSource: { sha256: "abc", bytes: 42 },
    },
  ];
  const equivalent = [
    {
      ...baseline[0],
      args: ["-i", "color=c=blue:s=1280x720", "different-project/a.jpg"],
    },
  ];
  assert.doesNotThrow(() => assertEquivalentSources(baseline, equivalent));
  assert.throws(
    () =>
      assertEquivalentSources(baseline, [
        { ...equivalent[0], syntheticSource: { sha256: "def", bytes: 42 } },
      ]),
    /Synthetic source workload changed/,
  );
  assert.throws(
    () => assertEquivalentSources(baseline, [...equivalent, ...equivalent]),
    /Synthetic source workload changed/,
  );
  assert.throws(() => assertEquivalentSources([], []), /No synthetic source/);
});

test("observer interpreter identity follows executable shebang even under a different PATH Python", async () => {
  const { observerIdentity } = await import("../media-profile.mjs");
  const { writeFile, chmod } = await import("node:fs/promises");
  const dir = await mkdtemp(join(tmpdir(), "openfilm-profile-python-"));
  try {
    const fakePython = join(dir, "python3");
    await writeFile(fakePython, "#!/bin/sh\nprintf 'Python WRONG-PATH\\n'\n");
    await chmod(fakePython, 0o755);
    const env = { ...process.env, PATH: `${dir}:${process.env.PATH}` };
    assert.equal(
      (await exec("python3", ["--version"], { env })).stdout.trim(),
      "Python WRONG-PATH",
    );
    const identity = await observerIdentity(
      resolve("scripts/ci/media-profile-command.py"),
      env,
    );
    const expected = JSON.parse(
      (
        await exec("/usr/bin/python3", [
          "-c",
          "import json,os,sys; print(json.dumps(dict(executable=sys.executable,realPath=os.path.realpath(sys.executable),version=sys.version)))",
        ])
      ).stdout,
    );
    assert.equal(identity.executable, expected.executable);
    assert.equal(identity.realPath, expected.realPath);
    assert.equal(identity.version, expected.version);
    assert.match(identity.sha256, /^[a-f0-9]{64}$/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
