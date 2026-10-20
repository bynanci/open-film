import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  ApiError,
  configureNativeConnection,
  exportDownloadUrl,
  fetchDownloadBlob,
} from "../../apps/desktop/src/api";
import {
  flatten,
  loadComponent,
  mountComponent,
  vue,
} from "./helpers/vue-sfc-host";

const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const stop of cleanup.splice(0).reverse()) stop();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function fixture(
  transport = vi.fn(
    async (_url: string, _signal: AbortSignal) => new Blob(["Actual bytes"]),
  ),
) {
  const create = vi
    .spyOn(URL, "createObjectURL")
    .mockReturnValue("blob:window-local");
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const link = { href: "", download: "", click: vi.fn(), remove: vi.fn() };
  const append = vi.fn();
  vi.stubGlobal("document", { createElement: () => link, body: { append } });
  vi.stubGlobal("window", {
    location: {
      href: "http://tauri.localhost/",
      origin: "http://tauri.localhost",
    },
  });
  const component = loadComponent(
    "apps/desktop/src/components/LocalDownload.vue",
    {
      "../api": { fetchDownloadBlob: transport },
      "../i18n": { localizeError: (error: Error) => error.message },
    },
  );
  const props = vue.reactive({
    href:
      "http://127.0.0.1:38541/native/" +
      "e".repeat(64) +
      "/api/export/file?name=film.mp4",
    filename: "film.mp4",
    owner: "project",
  });
  const mounted = mountComponent(component, props);
  cleanup.push(mounted.unmount);
  const click = async () => {
    const event = new Event("click", { cancelable: true });
    await (
      flatten(mounted.root).find((n) => n.tag === "a")!.props.onClick as (
        e: Event,
      ) => Promise<void>
    )(event);
    return event;
  };
  return { ...mounted, props, transport, create, revoke, link, append, click };
}
it("keeps anchor semantics, saves through a local blob and revokes its URL", async () => {
  vi.useFakeTimers();
  const h = fixture();
  const anchor = flatten(h.root).find((n) => n.tag === "a")!;
  expect(anchor.props.href).toBe(h.props.href);
  expect(anchor.props.download).toBe("film.mp4");
  expect((await h.click()).defaultPrevented).toBe(true);
  expect(h.transport).toHaveBeenCalledOnce();
  expect(h.link.click).toHaveBeenCalledOnce();
  expect(h.link.remove).toHaveBeenCalledOnce();
  expect(h.link.href).toBe("blob:window-local");
  expect(h.link.download).toBe("film.mp4");
  await vi.runAllTimersAsync();
  expect(h.revoke).toHaveBeenCalledWith("blob:window-local");
});
it("leaves ordinary same-origin browser streaming and keyboard activation to the anchor", async () => {
  const h = fixture();
  h.props.href = "/api/export/file?name=film.mp4";
  await vue.nextTick();
  expect((await h.click()).defaultPrevented).toBe(false);
  expect(h.transport).not.toHaveBeenCalled();
  expect(h.create).not.toHaveBeenCalled();
  expect(flatten(h.root).find((n) => n.tag === "a")!.props.download).toBe(
    "film.mp4",
  );
});
it.each(["owner", "href", "filename"] as const)(
  "aborts a pending download when its %s changes and never saves late foreign bytes",
  async (key) => {
    let finish!: (value: Blob) => void;
    const transport = vi.fn(
      (_url: string, _signal: AbortSignal) =>
        new Promise<Blob>((resolve) => {
          finish = resolve;
        }),
    );
    const h = fixture(transport);
    const pending = h.click();
    h.props[key] = "changed";
    await vue.nextTick();
    expect(transport.mock.calls[0]![1].aborted).toBe(true);
    finish(new Blob(["Old project bytes"]));
    await pending;
    expect(h.create).not.toHaveBeenCalled();
    expect(h.link.click).not.toHaveBeenCalled();
  },
);
it("aborts on unmount and ignores a late completed body", async () => {
  let finish!: (value: Blob) => void;
  const transport = vi.fn(
    (_url: string, _signal: AbortSignal) =>
      new Promise<Blob>((resolve) => {
        finish = resolve;
      }),
  );
  const h = fixture(transport);
  const pending = h.click();
  h.unmount();
  expect(transport.mock.calls[0]![1].aborted).toBe(true);
  finish(new Blob(["Old bytes"]));
  await pending;
  expect(h.create).not.toHaveBeenCalled();
});
it("surfaces a failed download without a rejected click or a blob URL", async () => {
  const h = fixture(
    vi.fn(async () => {
      throw new ApiError("Denied download", 403);
    }),
  );
  await expect(h.click()).resolves.toBeInstanceOf(Event);
  await vue.nextTick();
  expect(flatten(h.root).find((n) => n.props.role === "alert")?.text).toBe(
    "Denied download",
  );
  expect(h.create).not.toHaveBeenCalled();
  expect(h.link.click).not.toHaveBeenCalled();
});
it("uses only the current native prefix, preserves errors and disables redirects/credentials", async () => {
  configureNativeConnection(38541, "e".repeat(64));
  const fetcher = vi.fn(async () =>
    Response.json(
      { error: "Forbidden", code: "request.invalid" },
      { status: 403 },
    ),
  );
  vi.stubGlobal("fetch", fetcher);
  const signal = new AbortController().signal;
  await expect(
    fetchDownloadBlob(exportDownloadUrl("film.mp4"), signal),
  ).rejects.toMatchObject({ status: 403, message: "Forbidden" });
  expect(fetcher).toHaveBeenCalledWith(exportDownloadUrl("film.mp4"), {
    signal,
    redirect: "error",
    credentials: "omit",
  });
  await expect(
    fetchDownloadBlob("https://attacker.example/file", signal),
  ).rejects.toMatchObject({ status: 409 });
  expect(fetcher).toHaveBeenCalledOnce();
});
it("does not publish a body after the native connection changes", async () => {
  configureNativeConnection(38541, "e".repeat(64));
  let finish!: (value: Blob) => void;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      blob: () =>
        new Promise<Blob>((resolve) => {
          finish = resolve;
        }),
    })),
  );
  const pending = fetchDownloadBlob(
    exportDownloadUrl("film.mp4"),
    new AbortController().signal,
  );
  await Promise.resolve();
  configureNativeConnection(38542, "f".repeat(64));
  finish(new Blob(["Old service"]));
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
});
it("routes every service-backed download consumer through the shared owner-fenced component", () => {
  const compiler = createRequire(resolve("apps/desktop/package.json"))(
    "vue/compiler-sfc",
  );
  for (const [file, count] of [
    ["ExportWorkspace.vue", 7],
    ["CaptionExport.vue", 2],
    ["CollectMediaPanel.vue", 1],
    ["NleHandoff.vue", 1],
  ] as const) {
    const source = readFileSync(
      resolve("apps/desktop/src/components", file),
      "utf8",
    );
    const parsed = compiler.parse(source);
    expect(parsed.errors).toEqual([]);
    expect(source.match(/<LocalDownload\b/gu)).toHaveLength(count);
    expect(source).not.toMatch(/<a\b[^>]*\bdownload\b/gu);
    expect(source.match(/:owner=/gu)).toHaveLength(count);
  }
});
