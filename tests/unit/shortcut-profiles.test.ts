import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const profileFixture = JSON.stringify({
  format: "openfilm-shortcut-profile",
  version: 1,
  name: "Review desk",
  bindings: {
    "record.playPause": { code: "KeyP", modifiers: [] },
  },
});

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("localStorage", storage());
});

afterEach(() => vi.unstubAllGlobals());

describe("Cut Desk shortcut profiles", () => {
  it("fills omitted supported actions from defaults and round-trips declarative JSON", async () => {
    const profiles = await import("../../apps/desktop/src/shortcut-profiles");
    const profile = profiles.parseShortcutProfile(profileFixture);

    expect(profile).toMatchObject({
      version: 1,
      name: "Review desk",
      bindings: {
        "record.playPause": { code: "KeyP", modifiers: [] },
        "record.stepBackward": { code: "ArrowLeft", modifiers: [] },
        "source.markIn": { code: "KeyI", modifiers: [] },
      },
    });
    expect(
      profiles.parseShortcutProfile(profiles.serializeShortcutProfile(profile)),
    ).toEqual(profile);
  });

  it("rejects a binding conflict introduced by overriding a default action", async () => {
    const profiles = await import("../../apps/desktop/src/shortcut-profiles");
    const conflict = JSON.stringify({
      format: "openfilm-shortcut-profile",
      version: 1,
      name: "Conflicting desk",
      bindings: {
        "record.stop": { code: "KeyJ", modifiers: [] },
      },
    });

    expect(() => profiles.parseShortcutProfile(conflict)).toThrow(/conflict/i);
  });

  it("rejects executable or unknown fields in an imported profile", async () => {
    const profiles = await import("../../apps/desktop/src/shortcut-profiles");
    const executable = JSON.stringify({
      format: "openfilm-shortcut-profile",
      version: 1,
      name: "Unsafe",
      bindings: {},
      onImport: "globalThis.location='https://example.invalid'",
    });

    expect(() => profiles.parseShortcutProfile(executable)).toThrow(
      /unsupported/i,
    );
  });

  it("rejects browser or operating-system chords in imported profiles", async () => {
    const profiles = await import("../../apps/desktop/src/shortcut-profiles");
    const reserved = JSON.stringify({
      format: "openfilm-shortcut-profile",
      version: 1,
      name: "Reserved chord",
      bindings: {
        "timeline.slideBackward": {
          code: "Tab",
          modifiers: ["alt"],
        },
      },
    });

    expect(() => profiles.parseShortcutProfile(reserved)).toThrow(/reserved/i);
  });

  it("rejects browser function keys and Alt-based browser navigation", async () => {
    const profiles = await import("../../apps/desktop/src/shortcut-profiles");
    const makeProfile = (code: string, modifiers: string[]) =>
      JSON.stringify({
        format: "openfilm-shortcut-profile",
        version: 1,
        name: "Browser chord",
        bindings: {
          "record.playPause": { code, modifiers },
        },
      });

    expect(() => profiles.parseShortcutProfile(makeProfile("F5", []))).toThrow(
      /unsupported/i,
    );
    expect(() => profiles.parseShortcutProfile(makeProfile("F12", []))).toThrow(
      /unsupported/i,
    );
    expect(() =>
      profiles.parseShortcutProfile(makeProfile("ArrowLeft", ["alt"])),
    ).toThrow(/reserved/i);
  });

  it("resolves identical defaults only inside their distinct monitor scopes", async () => {
    const profiles = await import("../../apps/desktop/src/shortcut-profiles");
    const event = {
      code: "Space",
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    };

    expect(
      profiles.resolveShortcutAction(
        profiles.defaultShortcutProfile,
        "record",
        event,
      ),
    ).toBe("record.playPause");
    expect(
      profiles.resolveShortcutAction(
        profiles.defaultShortcutProfile,
        "source",
        event,
      ),
    ).toBe("source.playPause");
    expect(
      profiles.resolveShortcutAction(
        profiles.defaultShortcutProfile,
        "timeline",
        { ...event, altKey: true },
      ),
    ).toBeNull();
    expect(
      profiles.resolveShortcutAction(
        profiles.defaultShortcutProfile,
        "source",
        { ...event, code: "ArrowLeft", shiftKey: true },
      ),
    ).toBe("source.stepBackward");
  });

  it("keeps Delete and Backspace as separate, conflict-checked timeline bindings", async () => {
    const profiles = await import("../../apps/desktop/src/shortcut-profiles");
    const backspace = profiles.resolveShortcutAction(
      profiles.defaultShortcutProfile,
      "timeline",
      {
        code: "Backspace",
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
      },
    );
    const conflict = JSON.stringify({
      format: "openfilm-shortcut-profile",
      version: 1,
      name: "Delete collision",
      bindings: {
        "timeline.deleteBackward": { code: "Delete", modifiers: [] },
      },
    });

    expect(backspace).toBe("timeline.deleteBackward");
    expect(() => profiles.parseShortcutProfile(conflict)).toThrow(/conflict/i);
  });

  it("keeps imported profiles in private local preferences across reloads", async () => {
    const local = storage();
    vi.stubGlobal("localStorage", local);
    const profiles = await import("../../apps/desktop/src/shortcut-profiles");
    const imported = profiles.importShortcutProfile(profileFixture);
    profiles.setActiveShortcutProfile(imported.id);

    expect(local.getItem(profiles.shortcutProfilesStorageKey)).toContain(
      "Review desk",
    );
    expect(local.getItem("openfilm.project.v1")).toBeNull();

    vi.resetModules();
    const reopened = await import("../../apps/desktop/src/shortcut-profiles");
    expect(reopened.activeShortcutProfile.value.name).toBe("Review desk");
    expect(
      reopened.resolveShortcutAction(
        reopened.activeShortcutProfile.value,
        "record",
        {
          code: "KeyP",
          altKey: false,
          ctrlKey: false,
          metaKey: false,
          shiftKey: false,
        },
      ),
    ).toBe("record.playPause");
  });

  it("removes a saved profile and restores the built-in profile when it was active", async () => {
    const profiles = await import("../../apps/desktop/src/shortcut-profiles");
    const imported = profiles.importShortcutProfile(profileFixture);
    profiles.setActiveShortcutProfile(imported.id);
    profiles.removeShortcutProfile(imported.id);

    expect(profiles.activeShortcutProfileId.value).toBe("default");
    expect(profiles.activeShortcutProfile.value.name).toBe("OpenFilm Default");
    expect(profiles.listShortcutProfiles()).toEqual([
      { id: "default", name: "OpenFilm Default" },
    ]);
  });
});
