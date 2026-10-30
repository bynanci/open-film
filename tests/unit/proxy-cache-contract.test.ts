import { describe, expect, it } from "vitest";
import {
  PROXY_CACHE_LIMITS,
  validateProxyCachePolicy,
  validateProxyCacheTask,
} from "@openfilm/core";

const policy = { version: 1, revision: 0, quotaBytes: 5 * 1024 ** 3 };
const task = {
  version: 1,
  projectId: "synthetic-project",
  assetId: "synthetic-video",
  mediaType: "video",
  sourceHash: "a".repeat(64),
  inputFingerprint: "b".repeat(64),
  recipe: "ffmpeg-preview-v2",
  requestId: "request-one",
  requestFingerprint: "c".repeat(64),
  generation: 1,
  owner: { host: "synthetic-boot", pid: 123, token: "synthetic-token" },
};

describe("managed proxy contracts", () => {
  it("keeps the approved queue and quota bounds explicit", () => {
    expect(PROXY_CACHE_LIMITS).toMatchObject({
      activeTasks: 128,
      defaultQuotaBytes: 5 * 1024 ** 3,
      minimumQuotaBytes: 1024 ** 2,
      maximumQuotaBytes: 1024 ** 4,
    });
    expect(validateProxyCachePolicy(policy)).toEqual(policy);
    expect(validateProxyCacheTask(task)).toEqual(task);
  });

  it.each([
    { version: 2 },
    { revision: -1 },
    { quotaBytes: Number.NaN },
    { quotaBytes: 1024 ** 2 - 1 },
    { quotaBytes: 1024 ** 4 + 1 },
    { secret: "not-a-policy-field" },
  ])("rejects invalid or unversioned policy fields: %j", (patch) => {
    expect(() => validateProxyCachePolicy({ ...policy, ...patch })).toThrow();
  });

  it.each([
    { version: 2 },
    { mediaType: "image" },
    { sourceHash: "a".repeat(16) },
    { generation: 0 },
    { recipe: "project-supplied-command" },
    { owner: { host: "host", pid: -1, token: "token" } },
    { owner: { host: "host", pid: 1, token: "token", command: "shell" } },
    { command: "not-a-task-field" },
    {
      output: {
        uri: "../../sources/original.mp4",
        hash: "d".repeat(64),
        byteLength: 10,
        duration: 4,
      },
    },
    {
      output: {
        uri: `cache/proxies/managed/${"d".repeat(64)}.mp4`,
        hash: "d".repeat(64),
        byteLength: 10,
        duration: 4,
        privatePath: "not-an-output-field",
      },
    },
  ])("fails closed on unsafe task fields: %j", (patch) => {
    expect(() => validateProxyCacheTask({ ...task, ...patch })).toThrow();
  });

  it("accepts only a bounded relative managed output receipt", () => {
    const output = {
      uri: `cache/proxies/managed/${"d".repeat(64)}.mp4`,
      hash: "d".repeat(64),
      byteLength: 1234,
      duration: 4,
    };
    expect(validateProxyCacheTask({ ...task, output })).toMatchObject({
      output,
    });
  });
});
