// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import test from "node:test";

const checker = resolve("scripts/ci/check-source-head.mjs");

test("source-head receipt proves actual checkout and never claims merge integration", () => {
  const root = mkdtempSync(join(tmpdir(), "openfilm-source-head-"));
  const git = (...args) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  try {
    git("init", "--quiet");
    git("config", "user.name", "Fixture");
    git("config", "user.email", "fixture@example.invalid");
    writeFileSync(join(root, "source.txt"), "first\n");
    git("add", "source.txt");
    git("commit", "--quiet", "-m", "fixture one");
    const first = git("rev-parse", "HEAD");
    const run = (expected) =>
      spawnSync(process.execPath, [checker], {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          OPENFILM_SOURCE_CANDIDATE: expected,
          GITHUB_RUN_ID: "42",
          GITHUB_RUN_ATTEMPT: "2",
          GITHUB_EVENT_NAME: "pull_request",
        },
      });
    const pass = run(first);
    assert.equal(pass.status, 0, pass.stderr);
    assert.deepEqual(JSON.parse(pass.stdout), {
      verification: "source-head",
      expectedSha: first,
      actualSha: first,
      runId: "42",
      runAttempt: "2",
      eventName: "pull_request",
      mergeIntegrationVerified: false,
    });
    writeFileSync(join(root, "source.txt"), "second\n");
    git("add", "source.txt");
    git("commit", "--quiet", "-m", "fixture two");
    const mismatch = run(first);
    assert.equal(mismatch.status, 1);
    assert.match(mismatch.stderr, /Source checkout mismatch/u);
    assert.equal(mismatch.stdout, "");
    for (const invalid of [
      "",
      "main",
      "a".repeat(39),
      "z".repeat(40),
      `${first}\n`,
      `$(echo ${first})`,
    ]) {
      const failure = run(invalid);
      assert.equal(failure.status, 1);
      assert.match(failure.stderr, /full lowercase 40-character Git SHA/u);
      assert.equal(failure.stdout, "");
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("required CI jobs check out and verify candidate head before executing code", () => {
  for (const name of [
    "ci.yml",
    "render-qa.yml",
    "windows-media-recovery.yml",
  ]) {
    const source = readFileSync(`.github/workflows/${name}`, "utf8");
    const checkouts = source
      .split(/ {6}- uses: actions\/checkout@v4\n/u)
      .slice(1);
    assert.ok(checkouts.length > 0, name);
    for (const checkout of checkouts) {
      const firstSteps = checkout.split(
        "      - uses: pnpm/action-setup@v4",
      )[0];
      assert.match(
        firstSteps,
        /ref: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/u,
        name,
      );
      assert.match(firstSteps, /persist-credentials: false/u, name);
      assert.match(
        firstSteps,
        /run: node scripts\/ci\/check-source-head\.mjs/u,
        name,
      );
    }
    assert.match(
      source,
      /OPENFILM_SOURCE_CANDIDATE: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/u,
      name,
    );
    assert.doesNotMatch(source, /continue-on-error/u, name);
  }
});

test("Windows recovery runs the real workload on every PR without path or success shortcuts", () => {
  const source = readFileSync(
    ".github/workflows/windows-media-recovery.yml",
    "utf8",
  );
  assert.match(source, /^ {2}pull_request:\s*\n {2}push:/mu);
  assert.doesNotMatch(
    source,
    /paths:|paths-ignore:|^ {4}if:|continue-on-error/mu,
  );
  for (const command of [
    "packages/application/tests/review-owner-platform.test.ts",
    "packages/application/tests/windows-source-persistence.test.ts",
    "pnpm exec playwright test tests/e2e/export-profiles.spec.ts",
  ]) {
    assert.ok(source.includes(command), command);
  }
});
