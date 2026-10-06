import { posix, win32 } from "node:path";
import { expect, it } from "vitest";
import { isInside } from "../src/path-safety.js";

it("does not treat a Windows source on another drive as project-internal", () => {
  expect(
    isInside("C:\\Movies\\film.openfilm", "D:\\Memories\\photo.jpg", win32),
  ).toBe(false);
  expect(
    isInside(
      "C:\\Movies\\film.openfilm",
      "C:\\Movies\\film.openfilm\\sources\\photo.jpg",
      win32,
    ),
  ).toBe(true);
  expect(
    isInside(
      "C:\\Movies\\film.openfilm",
      "C:\\Movies\\film.openfilm-other\\photo.jpg",
      win32,
    ),
  ).toBe(false);
  expect(
    isInside(
      "/movies/film.openfilm",
      "/movies/film.openfilm/../outside.jpg",
      posix,
    ),
  ).toBe(false);
});
