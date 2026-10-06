import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Socket } from "node:net";
import { request as playwrightRequest } from "@playwright/test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startServer } from "../../apps/server/src/server.js";
import { closeProject } from "../fixtures/close-browser-project.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function observe(server: Server) {
  const requests: Array<{ path: string; socket: Socket }> = [];
  const closed = new Set<Socket>();
  server.on("connection", (socket) => {
    socket.on("close", () => closed.add(socket));
  });
  server.on("request", (request) => {
    requests.push({ path: request.url ?? "", socket: request.socket });
  });
  return { requests, closed };
}

async function listen(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  cleanups.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Expected the diagnostic server to listen on TCP.");
  return `http://127.0.0.1:${address.port}/api`;
}

describe("browser project-close transport", () => {
  it("uses and disposes a fresh connection per close while preserving the test's warmed context", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "openfilm-close-transport-test-"),
    );
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const runtime = await startServer({
      port: 0,
      userDataDirectory: join(root, "user-data"),
      projectRoot: join(root, "projects"),
    });
    cleanups.push(() => runtime.close());
    const observed = observe(runtime.server);
    const api = `http://127.0.0.1:${runtime.port}/api`;
    const bodyContext = await playwrightRequest.newContext();
    cleanups.push(() => bodyContext.dispose());
    const created = await bodyContext.post(`${api}/project/create`, {
      data: {
        title: "Transport ownership",
        filmSettings: {
          templateId: "blank",
          targetDuration: 8,
          maxDuration: 12,
        },
      },
    });
    expect(created.status(), await created.text()).toBe(200);
    const warmed = await bodyContext.get(`${api}/health`);
    expect(warmed.status()).toBe(200);
    const bodySocket = observed.requests.find(
      (request) => request.path === "/api/project/create",
    )!.socket;

    await closeProject(api);
    await closeProject(api);

    const closure = observed.requests.filter(
      (request) => request.path === "/api/project/close",
    );
    expect(closure).toHaveLength(2);
    expect(closure[0]!.socket).not.toBe(bodySocket);
    expect(closure[1]!.socket).not.toBe(bodySocket);
    expect(closure[1]!.socket).not.toBe(closure[0]!.socket);
    await expect
      .poll(() => closure.every(({ socket }) => observed.closed.has(socket)))
      .toBe(true);
    expect(observed.closed.has(bodySocket)).toBe(false);
    const project = await bodyContext.get(`${api}/project`);
    expect(project.status()).toBe(200);
    expect(await project.json()).toMatchObject({ project: null, path: null });
  });

  it("propagates an unexpected HTTP status and disposes the actual API context", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(500, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "Intentional endpoint failure" }));
    });
    const observed = observe(server);
    const api = await listen(server);
    // A call-through spy observes the real context; HTTP dispatch is unchanged.
    const creation = vi.spyOn(playwrightRequest, "newContext");

    await expect(closeProject(api)).rejects.toThrow(/409/);

    expect(creation).toHaveBeenCalledTimes(1);
    const owned = await creation.mock.results[0]!.value;
    await expect(owned.get(`${api}/health`)).rejects.toThrow(
      /closed|disposed/i,
    );
    expect(observed.requests).toHaveLength(1);
    await expect
      .poll(() => observed.closed.has(observed.requests[0]!.socket))
      .toBe(true);
    expect(server.listening).toBe(true);
  });

  it("propagates a real socket reset without retrying and disposes its context", async () => {
    const server = createServer((request) => request.socket.destroy());
    const observed = observe(server);
    const api = await listen(server);
    const creation = vi.spyOn(playwrightRequest, "newContext");

    await expect(closeProject(api)).rejects.toThrow(
      /socket hang up|ECONNRESET/i,
    );

    expect(creation).toHaveBeenCalledTimes(1);
    const owned = await creation.mock.results[0]!.value;
    await expect(owned.get(`${api}/health`)).rejects.toThrow(
      /closed|disposed/i,
    );
    expect(observed.requests).toHaveLength(1);
    expect(server.listening).toBe(true);
  });
});
