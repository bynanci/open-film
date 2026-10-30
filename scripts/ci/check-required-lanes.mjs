// SPDX-License-Identifier: Apache-2.0
if (
  process.env.FAST_RESULT !== "success" ||
  process.env.MEDIA_RESULT !== "success"
) {
  console.error("Both contract and media CI lanes must succeed.");
  process.exitCode = 1;
} else console.log("Contract and media CI lanes both succeeded.");
