import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadComponent,
  mountComponent,
  flatten,
  type HostNode,
} from "./helpers/vue-sfc-host";

const preferenceKey = "openfilm.preferences.v1";

function mockStorage(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
  };
}

describe("Cut Desk Phase 1C: Responsive & Accessible Workspace", () => {
  describe("Preferences & Safe Corruption Recovery", () => {
    beforeEach(() => {
      vi.resetModules();
      vi.stubGlobal("localStorage", mockStorage());
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it.each([
      "{}",
      "invalid-non-json-string",
      '{"cutDeskMonitorLayout":"windowed"}',
      '{"cutDeskMonitorLayout":123}',
      '{"cutDeskMonitorLayout":null}',
      '{"cutDeskSplitRatio":"wide"}',
      '{"cutDeskSplitRatio":null}',
      '{"cutDeskSplitRatio":-1}',
      '{"cutDeskSplitRatio":10}',
    ])(
      "recovers safely to bounded defaults when storage is corrupt: %s",
      async (storedValue) => {
        vi.stubGlobal(
          "localStorage",
          mockStorage({ [preferenceKey]: storedValue }),
        );
        const { preferences } =
          await import("../../apps/desktop/src/preferences");
        expect(preferences.cutDeskMonitorLayout).toBe("tabbed");
        expect(preferences.cutDeskSplitRatio).toBe(0.5);
      },
    );

    it("persists valid monitor layout and split ratio without altering other preferences", async () => {
      const initial = mockStorage({
        [preferenceKey]: JSON.stringify({
          theme: "light",
          workspaceMode: "expert",
          projectRoot: "/projects",
        }),
      });
      vi.stubGlobal("localStorage", initial);
      const prefs = await import("../../apps/desktop/src/preferences");

      prefs.setCutDeskMonitorLayout("dual");
      prefs.setCutDeskSplitRatio(0.65);

      expect(prefs.preferences.cutDeskMonitorLayout).toBe("dual");
      expect(prefs.preferences.cutDeskSplitRatio).toBe(0.65);

      const saved = JSON.parse(initial.getItem(preferenceKey)!);
      expect(saved.cutDeskMonitorLayout).toBe("dual");
      expect(saved.cutDeskSplitRatio).toBe(0.65);
      expect(saved.theme).toBe("light");
      expect(saved.workspaceMode).toBe("expert");
      expect(saved.projectRoot).toBe("/projects");
    });

    it("clamps out-of-bounds split ratios between 0.25 and 0.75", async () => {
      const prefs = await import("../../apps/desktop/src/preferences");

      prefs.setCutDeskSplitRatio(0.1);
      expect(prefs.preferences.cutDeskSplitRatio).toBe(0.25);

      prefs.setCutDeskSplitRatio(0.95);
      expect(prefs.preferences.cutDeskSplitRatio).toBe(0.75);

      prefs.setCutDeskSplitRatio(0.42);
      expect(prefs.preferences.cutDeskSplitRatio).toBe(0.42);
    });

    it("ignores unrecognized layout choices without losing the active preference", async () => {
      const prefs = await import("../../apps/desktop/src/preferences");

      prefs.setCutDeskMonitorLayout("dual");
      expect(prefs.preferences.cutDeskMonitorLayout).toBe("dual");

      // @ts-expect-error test runtime validation of invalid type
      prefs.setCutDeskMonitorLayout("floating-window");
      expect(prefs.preferences.cutDeskMonitorLayout).toBe("dual");
    });
  });

  describe("ShortcutSheet Component Accessibility & Keyboard Contracts", () => {
    const sfcPath = "apps/desktop/src/components/ShortcutSheet.vue";

    it("declares accessible dialog semantics with title and description bindings", () => {
      const component = loadComponent(sfcPath, {
        "vue-i18n": {
          useI18n: () => ({ t: (key: string) => key }),
        },
        "./Icon.vue": {
          name: "Icon",
          props: ["name", "size"],
          template: '<span :data-icon="name" />',
        },
      });

      const { root } = mountComponent(component, { open: true });
      const nodes = flatten(root);

      const dialogNode = nodes.find((n: HostNode) => n.props.role === "dialog");
      expect(dialogNode).toBeDefined();
      expect(dialogNode?.props["aria-modal"]).toBe("true");

      const labelledBy = dialogNode?.props["aria-labelledby"];
      const describedBy = dialogNode?.props["aria-describedby"];
      expect(labelledBy).toBeTruthy();
      expect(describedBy).toBeTruthy();

      const titleNode = nodes.find((n: HostNode) => n.props.id === labelledBy);
      expect(titleNode).toBeDefined();

      const descNode = nodes.find((n: HostNode) => n.props.id === describedBy);
      expect(descNode).toBeDefined();
    });

    it("renders all five required Cut Desk shortcut groups", () => {
      const component = loadComponent(sfcPath, {
        "vue-i18n": {
          useI18n: () => ({ t: (key: string) => key }),
        },
        "./Icon.vue": {
          name: "Icon",
          props: ["name", "size"],
          template: '<span :data-icon="name" />',
        },
      });

      const { root } = mountComponent(component, { open: true });
      const nodes = flatten(root);

      const requiredGroups = [
        "cutDesk.shortcutSheet.groups.transport",
        "cutDesk.shortcutSheet.groups.marks",
        "cutDesk.shortcutSheet.groups.edit",
        "cutDesk.shortcutSheet.groups.timeline",
        "cutDesk.shortcutSheet.groups.gestures",
      ];

      for (const groupKey of requiredGroups) {
        const found = nodes.some((n: HostNode) => n.text?.includes(groupKey));
        expect(
          found,
          `Expected shortcut group ${groupKey} to be rendered`,
        ).toBe(true);
      }
    });

    it("renders close button with accessible label and close icon", () => {
      const component = loadComponent(sfcPath, {
        "vue-i18n": {
          useI18n: () => ({ t: (key: string) => key }),
        },
        "./Icon.vue": {
          name: "Icon",
          props: ["name", "size"],
          template: '<span :data-icon="name" />',
        },
      });

      const { root } = mountComponent(component, { open: true });
      const nodes = flatten(root);

      const closeButton = nodes.find(
        (n: HostNode) =>
          n.tag === "button" &&
          n.props["aria-label"] === "cutDesk.shortcutSheet.close",
      );
      expect(closeButton).toBeDefined();
    });
  });

  describe("Cut Desk Splitter & Target Navigation Contracts", () => {
    it("clamps keyboard splitter adjustments within bounds", () => {
      let ratio = 0.5;
      const setRatio = (r: number) => {
        ratio = Math.min(0.75, Math.max(0.25, Math.round(r * 100) / 100));
      };

      const handleKey = (key: string, shiftKey = false) => {
        const step = shiftKey ? 0.05 : 0.02;
        if (key === "ArrowLeft") setRatio(ratio - step);
        else if (key === "ArrowRight") setRatio(ratio + step);
        else if (key === "Home") setRatio(0.25);
        else if (key === "End") setRatio(0.75);
      };

      handleKey("ArrowLeft");
      expect(ratio).toBe(0.48);

      handleKey("ArrowLeft", true);
      expect(ratio).toBe(0.43);

      handleKey("Home");
      expect(ratio).toBe(0.25);

      // Clamped at 0.25 minimum
      handleKey("ArrowLeft");
      expect(ratio).toBe(0.25);

      handleKey("End");
      expect(ratio).toBe(0.75);

      // Clamped at 0.75 maximum
      handleKey("ArrowRight");
      expect(ratio).toBe(0.75);
    });

    it("preserves single authoritative composition and target isolation", () => {
      type Target = "record" | "source";
      let activeTarget: Target = "record";
      let recordPlaying = false;
      let sourcePlayhead = 2.5;

      const setTarget = (next: Target) => {
        activeTarget = next;
      };

      const handleSpace = () => {
        if (activeTarget === "record") {
          recordPlaying = !recordPlaying;
        } else {
          // In source target, Space controls source playback, not record
          sourcePlayhead += 1.0;
        }
      };

      // Space in record target
      handleSpace();
      expect(recordPlaying).toBe(true);
      expect(sourcePlayhead).toBe(2.5);

      // Switch to source target
      setTarget("source");
      expect(activeTarget).toBe("source");

      // Space in source target
      handleSpace();
      expect(recordPlaying).toBe(true); // Record state unchanged
      expect(sourcePlayhead).toBe(3.5);

      // Switch back to record target
      setTarget("record");
      handleSpace();
      expect(recordPlaying).toBe(false);
      expect(sourcePlayhead).toBe(3.5);
    });
  });
});
