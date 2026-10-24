import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const key = "openfilm.preferences.v1";
function storage(value = "{}") {
  const values = new Map([[key, value]]);
  return {
    getItem: (name: string) => values.get(name) ?? null,
    setItem: (name: string, item: string) => values.set(name, item),
  };
}
beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("localStorage", storage());
});
afterEach(() => vi.unstubAllGlobals());

describe("workspace mode device preference", () => {
  it.each([
    "{}",
    "not-json",
    '{"workspaceMode":"admin"}',
    '{"workspaceMode":{}}',
  ])(
    "opens the general workspace safely from missing or invalid storage: %s",
    async (value) => {
      vi.stubGlobal("localStorage", storage(value));
      const { preferences } =
        await import("../../apps/desktop/src/preferences");
      expect(preferences.workspaceMode).toBe("standard");
    },
  );
  it("remembers expert mode without overwriting theme, locale, root or project workspace history", async () => {
    const saved = storage(
      JSON.stringify({
        theme: "light",
        defaultFilmLocale: "zh-TW",
        projectRoot: "/films",
        lastWorkspaceByProject: { film: "edit" },
      }),
    );
    vi.stubGlobal("localStorage", saved);
    const prefs = await import("../../apps/desktop/src/preferences");
    prefs.setWorkspaceMode("expert");
    expect(JSON.parse(saved.getItem(key)!)).toMatchObject({
      workspaceMode: "expert",
      theme: "light",
      defaultFilmLocale: "zh-TW",
      projectRoot: "/films",
      lastWorkspaceByProject: { film: "edit" },
    });
    prefs.setTheme("dark");
    prefs.setLastWorkspaceForProject("other", "story");
    vi.resetModules();
    const reopened = await import("../../apps/desktop/src/preferences");
    expect(reopened.preferences.workspaceMode).toBe("expert");
    expect(reopened.getLastWorkspaceForProject("film")).toBe("edit");
  });
  it("rejects unsupported mode values without losing the current choice", async () => {
    const prefs = await import("../../apps/desktop/src/preferences");
    prefs.setWorkspaceMode("expert");
    prefs.setWorkspaceMode("admin" as never);
    expect(prefs.preferences.workspaceMode).toBe("expert");
  });
  it("retains a usable session choice when local storage cannot be written", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {
        throw new Error("Storage denied");
      },
    });
    const prefs = await import("../../apps/desktop/src/preferences");
    expect(() => prefs.setWorkspaceMode("expert")).not.toThrow();
    expect(prefs.preferences.workspaceMode).toBe("expert");
    prefs.setWorkspaceMode("standard");
    expect(prefs.preferences.workspaceMode).toBe("standard");
  });
});
