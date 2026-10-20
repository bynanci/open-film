import { afterEach, describe, expect, it } from "vitest";
import { validateGraphicScenes, type GraphicScene } from "@openfilm/core";
import type { TimelineCommand } from "@openfilm/solver";
import {
  flatten,
  loadComponent,
  mountComponent,
  vue,
} from "./helpers/vue-sfc-host.js";

const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).forEach((stop) => stop()));

describe("retiming a PhotoDepth image in the inspector", () => {
  it.each(["parallax", "fallback"] as const)(
    "keeps a %s recipe bound through valid timing edits",
    async (mode) => {
      const image = {
        id: "photo",
        type: "image" as const,
        assetId: "source",
        x: 0,
        y: 0,
        width: 160,
        height: 90,
        opacity: 1,
        zIndex: 0,
        start: 0,
        end: 6,
      };
      const base = {
        version: 1 as const,
        id: "recipe",
        nodeId: image.id,
        duration: 6,
        sourceAssetId: image.assetId,
        sourceSha256: "a".repeat(64),
      };
      const scene: GraphicScene = {
        version: 1,
        id: "scene",
        name: "Synthetic",
        start: 0,
        duration: 6,
        zIndex: 0,
        nodes: [image],
        photoDepth:
          mode === "fallback"
            ? { ...base, mode, fallbackReason: "mask-unreliable" }
            : {
                ...base,
                mode,
                maskAssetId: "mask",
                maskSha256: "b".repeat(64),
                background: { kind: "source" },
                protectedRegion: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
                foregroundDepth: 1.2,
                backgroundDepth: 0.25,
                amplitude: 0.5,
                camera: {
                  from: { x: 0, y: 0, scale: 1 },
                  to: { x: 0.02, y: 0, scale: 1.04 },
                },
                easing: "ease-in-out",
              },
      };
      const commands: TimelineCommand[] = [];
      const props = vue.shallowReactive({
        projectId: "film",
        compositionId: "composition",
        revision: "revision",
        scenes: [scene],
        duration: 6,
        frameRate: 30,
        assets: [],
        disabled: false,
        agentDisabled: false,
        selectedSceneId: scene.id,
        selectedNodeId: image.id,
        snapping: false,
        guides: false,
        onCommand: (command: TimelineCommand) => {
          commands.push(command);
          if (command.type === "graphic.scene.upsert")
            props.scenes = [command.scene];
        },
      });
      const component = loadComponent(
        "apps/desktop/src/components/GraphicSceneInspector.vue",
        {
          "vue-i18n": { useI18n: () => ({ t: (key: string) => key }) },
          "@openfilm/core": { validateGraphicScenes },
          "./GraphicSceneAgentReview.vue": { render: () => null },
          "./PhotoDepthControls.vue": { render: () => null },
        },
      );
      const panel = mountComponent(component, props);
      cleanup.push(panel.unmount);
      await vue.nextTick();
      const retime = async (field: "start" | "end", value: number) => {
        const control = flatten(panel.root).find(
          (node) => node.props["data-testid"] === `graphic-node-${field}`,
        )!;
        (control.props.onChange as (event: unknown) => void)({
          target: { value: String(value) },
        });
        await vue.nextTick();
      };
      await retime("end", 4.5);
      expect(commands).toHaveLength(1);
      expect(props.scenes[0]!.photoDepth).toEqual({
        ...scene.photoDepth,
        duration: 4.5,
      });
      await retime("start", 1.5);
      expect(commands).toHaveLength(2);
      expect(props.scenes[0]!.photoDepth).toEqual({
        ...scene.photoDepth,
        duration: 3,
      });
      await retime("end", 3.5);
      expect(commands).toHaveLength(2);
      expect(props.scenes[0]!.nodes[0]).toMatchObject({ start: 1.5, end: 4.5 });
    },
  );
});
