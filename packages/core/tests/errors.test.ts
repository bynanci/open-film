import { expect, it } from "vitest";
import { ApplicationError, errorInfo } from "../src/index.js";

it("preserves stable error codes and readable diagnostics without interpreting error prose", () => {
  expect(
    errorInfo(
      new ApplicationError("media.missing", "Missing /電影 # &/照片.jpg", 400, {
        name: "照片.jpg",
      }),
    ),
  ).toEqual({
    code: "media.missing",
    params: { name: "照片.jpg" },
    detail: "Missing /電影 # &/照片.jpg",
  });
  expect(errorInfo(new Error("Missing Media"))).toEqual({
    code: "operation.failed",
    detail: "Missing Media",
  });
  expect(
    errorInfo(
      {
        code: "future.unknown",
        detail: "Native diagnostic",
        params: { valid: 2, invalid: NaN, object: {} },
      },
      "import.failed",
    ),
  ).toEqual({
    code: "import.failed",
    detail: "Native diagnostic",
    params: { valid: 2 },
  });
});
