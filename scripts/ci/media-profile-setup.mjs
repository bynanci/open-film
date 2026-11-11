// SPDX-License-Identifier: Apache-2.0
// Loaded only by vitest.media-profile.config.ts. No production authority changes.
import crypto from "node:crypto";
import { appendFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { beforeEach, afterEach, expect } from "vitest";
import { PipelineService } from "../../packages/application/src/pipeline-orchestrator.ts";
import { OpenFilmApplication } from "../../packages/application/src/index.ts";
import { StageRecorder } from "./media-profile.mjs";
const recorder = new StageRecorder();
let finishCase;
beforeEach(() => {
  recorder.context = { test: expect.getState().currentTestName };
  finishCase = recorder.begin("case-including-setup");
});
afterEach(() => finishCase?.());
const originalCreate = OpenFilmApplication.create;
OpenFilmApplication.create = function (...args) {
  return recorder.measure("application-create", () =>
    originalCreate.apply(this, args),
  );
};
const originalExecute = PipelineService.prototype.executeStep;
PipelineService.prototype.executeStep = function (step, ...args) {
  return recorder.measure(`pipeline.${step.type}`, () =>
    originalExecute.call(this, step, ...args),
  );
};
const originalCreateHash = crypto.createHash;
crypto.createHash = function (...args) {
  const hash = originalCreateHash.apply(this, args);
  for (const method of ["update", "digest"]) {
    const original = hash[method];
    hash[method] = function (...values) {
      const result = recorder.measureSync(`hash.${args[0]}.${method}`, () =>
        original.apply(this, values),
      );
      if (method === "digest" && process.env.OPENFILM_PROFILE_STAGES) {
        appendFileSync(
          `${process.env.OPENFILM_PROFILE_STAGES}.hashes.jsonl`,
          JSON.stringify({
            test: recorder.context.test,
            algorithm: args[0],
            digestHex:
              typeof result === "string" && values[0] === "hex"
                ? result
                : Buffer.isBuffer(result)
                  ? result.toString("hex")
                  : null,
          }) + "\n",
        );
      }
      return result;
    };
  }
  return hash;
};
syncBuiltinESMExports();
