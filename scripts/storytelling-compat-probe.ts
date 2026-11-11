// SPDX-License-Identifier: Apache-2.0
// Evidence command only: SDK diagnostics/results remain data on stdout.
import { readFileSync } from "node:fs";
import {
  compatibility,
  importProbe,
  inspectSdk,
  planReviewProbe,
} from "./storytelling-compat.js";

const args = process.argv.slice(2);
if (args.length !== 3 && args.length !== 5) {
  process.stderr.write(
    "Usage: tsx scripts/storytelling-compat-probe.ts SDK_CHECKOUT BINARY_SHA256 SNAPSHOT [PLANNER_REQUEST CONTEXT]\n",
  );
  process.exitCode = 2;
} else {
  try {
    const [root, digest, snapshotPath, requestPath, contextPath] = args;
    const pin = inspectSdk(root!, digest!);
    const snapshot = readFileSync(snapshotPath!, "utf8");
    const imported = importProbe(pin, snapshot);
    const review =
      requestPath && contextPath && imported.exitCode === 0
        ? planReviewProbe(pin, {
            request: readFileSync(requestPath, "utf8"),
            snapshot,
            context: readFileSync(contextPath, "utf8"),
          })
        : undefined;
    process.stdout.write(
      JSON.stringify({
        compatibility,
        binarySha256: pin.binarySha256,
        import: imported,
        ...(review ? { review } : {}),
      }) + "\n",
    );
    process.exitCode = imported.exitCode || review?.freshness.exitCode || 0;
  } catch {
    process.stderr.write(
      "Compatibility probe failed; verify pinned checkout, binary digest and admitted inputs.\n",
    );
    process.exitCode = 3;
  }
}
