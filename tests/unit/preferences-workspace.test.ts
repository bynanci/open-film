import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const key = "openfilm.preferences.v1";

function localStorage(initial?: Record<string, string>) {
  const values = new Map(Object.entries(initial ?? {}));
  return {
    getItem: (name: string) => values.get(name) ?? null,
    setItem: (name: string, value: string) => values.set(name, value),
    removeItem: (name: string) => values.delete(name),
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
  };
}

describe("per-project workspace preferences", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("localStorage", localStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("restores only recognized workspaces for the matching project", async () => {
    const storage = localStorage({
      [key]: JSON.stringify({
        theme: "light",
        lastWorkspaceByProject: {
          "project-one": "edit",
          "project-two": "not-a-workspace",
          "": "story",
        },
      }),
    });
    vi.stubGlobal("localStorage", storage);
    const preferences = await import("../../apps/desktop/src/preferences");

    expect(preferences.getLastWorkspaceForProject?.("project-one")).toBe(
      "edit",
    );
    expect(
      preferences.getLastWorkspaceForProject?.("project-two"),
    ).toBeUndefined();
    expect(
      preferences.getLastWorkspaceForProject?.("unknown-project"),
    ).toBeUndefined();
  });

  it("saves workspaces independently and preserves existing preferences", async () => {
    const storage = localStorage({
      [key]: JSON.stringify({ theme: "light", projectRoot: "/films" }),
    });
    vi.stubGlobal("localStorage", storage);
    const preferences = await import("../../apps/desktop/src/preferences");

    preferences.setLastWorkspaceForProject?.("project-one", "story");
    preferences.setLastWorkspaceForProject?.("project-two", "versions");

    const stored = JSON.parse(storage.getItem(key) ?? "{}") as {
      theme?: string;
      projectRoot?: string;
      lastWorkspaceByProject?: Record<string, string>;
    };
    expect(stored).toMatchObject({
      theme: "light",
      projectRoot: "/films",
      lastWorkspaceByProject: {
        "project-one": "story",
        "project-two": "versions",
      },
    });

    vi.resetModules();
    const reopened = await import("../../apps/desktop/src/preferences");
    expect(reopened.getLastWorkspaceForProject?.("project-one")).toBe("story");
    expect(reopened.getLastWorkspaceForProject?.("project-two")).toBe(
      "versions",
    );
  });

  it("keeps legacy preferences usable when no workspace map is stored", async () => {
    const storage = localStorage({
      [key]: JSON.stringify({ theme: "dark", defaultFilmLocale: "zh-TW" }),
    });
    vi.stubGlobal("localStorage", storage);
    const preferences = await import("../../apps/desktop/src/preferences");

    expect(preferences.preferences.theme).toBe("dark");
    expect(preferences.preferences.defaultFilmLocale).toBe("zh-TW");
    expect(
      preferences.getLastWorkspaceForProject?.("legacy-project"),
    ).toBeUndefined();
  });
});
