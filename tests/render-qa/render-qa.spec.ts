// SPDX-License-Identifier: Apache-2.0
import { it } from "vitest";
import { runRenderQa } from "../helpers/run-render-qa.js";

it("accepts pinned-font actual output and observes every deliberate decoded/identity failure", async () => {
  await runRenderQa();
}, 120_000);
