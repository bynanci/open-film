import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { transformSync } from "esbuild";

const desktopRequire = createRequire(resolve("apps/desktop/package.json"));
export const vue = desktopRequire("vue");
const compiler = desktopRequire("vue/compiler-sfc");
export interface HostNode {
  tag: string;
  tagName: string;
  props: Record<string, unknown>;
  style: Record<string, string>;
  children: HostNode[];
  parent: HostNode | null;
  text: string;
  currentTime: number;
  playbackRate: number;
  volume: number;
  pause: () => void;
  addEventListener: () => void;
  removeEventListener: () => void;
  getRootNode: () => unknown;
  options: unknown[];
}
function node(tag: string): HostNode {
  return {
    tag,
    tagName: tag.toUpperCase(),
    props: {},
    style: {},
    children: [],
    parent: null,
    text: "",
    currentTime: 0,
    playbackRate: 1,
    volume: 1,
    pause() {},
    addEventListener() {},
    removeEventListener() {},
    getRootNode: () => globalThis.document,
    options: [],
  };
}
export function flatten(root: HostNode): HostNode[] {
  return [root, ...root.children.flatMap(flatten)];
}

export function loadComponent(
  relativePath: string,
  dependencies: Record<string, unknown>,
) {
  const path = resolve(relativePath);
  const script = compiler.compileScript(
    compiler.parse(readFileSync(path, "utf8"), { filename: path }).descriptor,
    { id: relativePath, inlineTemplate: true },
  ).content;
  const module = { exports: {} as { default?: unknown } };
  new Function(
    "require",
    "module",
    "exports",
    transformSync(script, { loader: "ts", format: "cjs" }).code,
  )(
    (name: string) => (name === "vue" ? vue : dependencies[name]),
    module,
    module.exports,
  );
  return module.exports.default;
}
export function mountComponent(
  component: unknown,
  props: object,
  targets: Record<string, HostNode> = {},
) {
  const renderer = vue.createRenderer({
    createElement: node,
    querySelector: (selector: string) => targets[selector] ?? null,
    createText: (value: string) => ({ ...node("text"), text: value }),
    createComment: () => node("comment"),
    setText: (element: HostNode, value: string) => {
      element.text = value;
    },
    setElementText: (element: HostNode, value: string) => {
      element.text = value;
      element.children = [];
    },
    patchProp: (
      element: HostNode,
      key: string,
      _previous: unknown,
      value: unknown,
    ) => {
      element.props[key] = value;
    },
    insert: (element: HostNode, parent: HostNode, anchor?: HostNode) => {
      if (element.parent)
        element.parent.children.splice(
          element.parent.children.indexOf(element),
          1,
        );
      element.parent = parent;
      const index = anchor ? parent.children.indexOf(anchor) : -1;
      if (index < 0) parent.children.push(element);
      else parent.children.splice(index, 0, element);
    },
    remove: (element: HostNode) => {
      if (element.parent)
        element.parent.children.splice(
          element.parent.children.indexOf(element),
          1,
        );
      element.parent = null;
    },
    parentNode: (element: HostNode) => element.parent,
    nextSibling: (element: HostNode) =>
      element.parent?.children[element.parent.children.indexOf(element) + 1] ??
      null,
    insertStaticContent: (
      content: string,
      parent: HostNode,
      anchor?: HostNode,
    ) => {
      const element = node("static");
      element.text = content;
      element.parent = parent;
      const index = anchor ? parent.children.indexOf(anchor) : -1;
      if (index < 0) parent.children.push(element);
      else parent.children.splice(index, 0, element);
      return [element, element] as const;
    },
  });
  const root = node("root");
  const app = renderer.createApp({
    setup: () => () => vue.h(component, props),
  });
  app.mount(root);

  return { root, unmount: () => app.unmount() };
}
export function hostNode(tag: string) {
  return node(tag);
}
