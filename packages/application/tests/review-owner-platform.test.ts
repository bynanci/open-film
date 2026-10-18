import { afterEach, beforeEach, expect, it, vi } from "vitest";

const evidence = vi.hoisted(() => ({
  platform: "win32",
  output: "",
  error: false,
}));
vi.mock("node:os", () => ({
  platform: () => evidence.platform,
  hostname: () => "same-hostname",
}));
vi.mock("node:child_process", () => ({
  execFileSync: () => {
    if (evidence.error) throw new Error("OS identity is unavailable");
    return evidence.output;
  },
}));

const machine = "11111111-2222-4333-8444-555555555555";
const boot = "2026-10-17T00:00:00.0000000Z";
beforeEach(() => {
  vi.stubEnv("SystemRoot", "C:\\Windows");
  evidence.platform = "win32";
  evidence.output = JSON.stringify({ machine, boot });
  evidence.error = false;
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
async function loadOwnerModule() {
  vi.resetModules();
  return import("../src/review-owner.js");
}

it("shares Windows OS evidence across executions without storing the machine identifier", async () => {
  const first = await loadOwnerModule();
  const owner = first.createReviewOwner();
  const second = await loadOwnerModule();
  expect(second.reviewOwnerState(owner)).toBe("alive");
  expect(second.ownsReviewOwner(owner)).toBe(false);
  expect(owner.host).not.toContain(machine);
  expect(owner.host).not.toContain(boot);
});

it.each([
  { machine: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", boot },
  { machine, boot: "2026-10-18T00:00:00.0000000Z" },
])(
  "does not probe an owner from another machine or boot: %j",
  async (other) => {
    const first = await loadOwnerModule();
    const owner = { ...first.createReviewOwner(), pid: process.pid + 1 };
    evidence.output = JSON.stringify(other);
    const second = await loadOwnerModule();
    const probe = vi.spyOn(process, "kill").mockImplementation(() => {
      throw Object.assign(new Error("No such local PID"), { code: "ESRCH" });
    });
    expect(second.reviewOwnerState(owner)).toBe("unknown");
    expect(probe).not.toHaveBeenCalled();
  },
);

it.each([
  "not JSON",
  "null",
  "{}",
  JSON.stringify({ machine: "", boot }),
  JSON.stringify({ machine: "00000000-0000-0000-0000-000000000000", boot }),
  JSON.stringify({ machine, boot: "not a boot timestamp" }),
  JSON.stringify({ machine, boot: "2026-02-30T00:00:00.0000000Z" }),
])("keeps malformed Windows evidence unverifiable: %s", async (output) => {
  evidence.output = output;
  const first = await loadOwnerModule();
  const owner = first.createReviewOwner();
  const second = await loadOwnerModule();
  expect(first.ownsReviewOwner(owner)).toBe(true);
  expect(second.reviewOwnerState(owner)).toBe("unknown");
});

it("keeps unavailable Windows evidence unknown across executions", async () => {
  evidence.error = true;
  const first = await loadOwnerModule();
  const owner = first.createReviewOwner();
  const second = await loadOwnerModule();
  expect(second.reviewOwnerState(owner)).toBe("unknown");
});

it("does not authorize recovery on an unverified platform", async () => {
  evidence.platform = "darwin";
  const first = await loadOwnerModule();
  const owner = first.createReviewOwner();
  const second = await loadOwnerModule();
  expect(second.reviewOwnerState(owner)).toBe("unknown");
});
