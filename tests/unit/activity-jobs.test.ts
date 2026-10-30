import { expect, it } from "vitest";
import type { Job } from "@openfilm/core";
import { latestActivityJob } from "../../apps/desktop/src/activity-jobs.js";
const job = (type: string, id = type): Job => ({
  id,
  type,
  status: "completed",
  progress: 1,
});
it("keeps the acknowledged import completion visible after its background proxy tasks", () => {
  const imported = job("import");
  expect(latestActivityJob([job("proxy"), imported])).toBe(imported);
});
it("keeps the latest foreground activity ordering and a standalone proxy fallback", () => {
  const rendered = job("render"),
    proxy = job("proxy");
  expect(latestActivityJob([proxy, rendered, job("import")])).toBe(rendered);
  expect(latestActivityJob([proxy])).toBe(proxy);
  expect(latestActivityJob([])).toBeUndefined();
});
