import { describe, expect, it } from "vitest";
import {
  filterWorkspaceCommands,
  isWorkspaceCommandShortcut,
  nextEnabledCommandIndex,
  type WorkspaceCommand,
} from "../../apps/desktop/src/workspace-commands";

const commands: WorkspaceCommand[] = [
  {
    id: "workspace:library",
    label: "媒體庫",
    icon: "image",
    keywords: ["Library"],
  },
  {
    id: "workspace:edit",
    label: "剪輯",
    icon: "film",
    keywords: ["Edit timeline"],
  },
  {
    id: "story:graph",
    label: "故事圖",
    icon: "layers",
    description: "整理故事",
    keywords: ["Story graph"],
    disabled: true,
  },
];
describe("workspace command discovery", () => {
  it.each([
    ["剪輯", ["workspace:edit"]],
    ["  ＥＤＩＴ  ", ["workspace:edit"]],
    ["story 整理", ["story:graph"]],
    ["missing action", []],
    ["  ", ["workspace:library", "workspace:edit", "story:graph"]],
  ])("finds localized and stable aliases for %s", (query, ids) => {
    expect(
      filterWorkspaceCommands(commands, query as string).map((item) => item.id),
    ).toEqual(ids);
  });
  it("keeps unavailable actions discoverable without changing the catalog", () => {
    const before = structuredClone(commands);
    expect(filterWorkspaceCommands(commands, "graph")[0]?.disabled).toBe(true);
    expect(commands).toEqual(before);
  });
  it("wraps keyboard selection past unavailable actions and handles an empty result", () => {
    expect(nextEnabledCommandIndex(commands, 1, 1)).toBe(0);
    expect(nextEnabledCommandIndex(commands, 0, -1)).toBe(1);
    expect(nextEnabledCommandIndex(commands, -1, 1)).toBe(0);
    expect(nextEnabledCommandIndex([], -1, 1)).toBe(-1);
    expect(
      nextEnabledCommandIndex([{ ...commands[0]!, disabled: true }], 0, 1),
    ).toBe(-1);
  });
});
describe("workspace command shortcut", () => {
  const key = {
    key: "k",
    ctrlKey: true,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    isComposing: false,
    repeat: false,
    defaultPrevented: false,
  };
  it("supports Ctrl K and Cmd K", () => {
    expect(isWorkspaceCommandShortcut(key)).toBe(true);
    expect(
      isWorkspaceCommandShortcut({
        ...key,
        key: "K",
        ctrlKey: false,
        metaKey: true,
      }),
    ).toBe(true);
  });
  it.each([
    { ctrlKey: false },
    { altKey: true },
    { shiftKey: true },
    { isComposing: true },
    { repeat: true },
    { defaultPrevented: true },
    { key: "z" },
  ])(
    "does not claim unrelated or already-handled keyboard input: %j",
    (change) => {
      expect(isWorkspaceCommandShortcut({ ...key, ...change })).toBe(false);
    },
  );
});
