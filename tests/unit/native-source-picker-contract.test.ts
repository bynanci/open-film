import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("apps/desktop/src-tauri/src/lib.rs", "utf8");

describe("native multi-source picker bridge", () => {
  it("registers a multi-folder picker without replacing existing file pickers", () => {
    expect(source).toContain("async fn pick_folders");
    expect(source).toContain("blocking_pick_folders");
    expect(source).toMatch(
      /pick_folder,\s*pick_folders,\s*pick_file,\s*pick_files,/u,
    );
  });

  it("classifies bounded dropped paths as files, folders, symlinks or unreadable entries", () => {
    expect(source).toContain("enum DroppedPathKind");
    expect(source).toContain("async fn classify_dropped_paths");
    expect(source).toContain("MAX_DROPPED_PATHS");
    expect(source).toContain("symlink_metadata");
    expect(source).toMatch(/pick_files,[\s\S]*classify_dropped_paths,/u);
  });
});
