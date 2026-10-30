// SPDX-License-Identifier: Apache-2.0
if (
  process.env.FAST_RESULT !== "success" ||
  process.env.MEDIA_RESULT !== "success" ||
  process.env.BROWSER_RESULT !== "success" ||
  process.env.DOCS_RESULT !== "success"
) {
  console.error(
    "Contract, media, browser and documentation CI lanes must all succeed.",
  );
  process.exitCode = 1;
} else
  console.log(
    "Contract, media, browser and documentation CI lanes all succeeded.",
  );
