import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const key = "openfilm.preferences.v1";

function storage(value?: string) {
  const values = new Map<string, string>();
  if (value !== undefined) values.set(key, value);
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

describe("theme preference defaults", () => {
  it("uses warm light for a first launch with no stored preference", async () => {
    const { preferences } = await import("../../apps/desktop/src/preferences");
    expect(preferences.theme).toBe("light");
  });

  it.each(["dark", "light", "system"] as const)(
    "preserves a previously chosen %s theme",
    async (theme) => {
      vi.stubGlobal("localStorage", storage(JSON.stringify({ theme })));
      const { preferences } =
        await import("../../apps/desktop/src/preferences");
      expect(preferences.theme).toBe(theme);
    },
  );

  it("falls back to warm light for an invalid stored theme", async () => {
    vi.stubGlobal("localStorage", storage(JSON.stringify({ theme: "sepia" })));
    const { preferences } = await import("../../apps/desktop/src/preferences");
    expect(preferences.theme).toBe("light");
  });
});
