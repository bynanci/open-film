import { createServer, type Server } from "node:http";
import type { Socket } from "node:net";
import { request as playwrightRequest } from "@playwright/test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { closeCollectFixture } from "../fixtures/close-collect-fixture.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
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
  if (!address || typeof address === "string") throw new Error("Expected TCP");
  return `http://127.0.0.1:${address.port}/api`;
}

describe("Collect fixture cleanup ownership", () => {
  it("closes once on a fresh socket and disposes it before releasing fixture resources", async () => {
    const observed: { path: string; socket: Socket }[] = [];
    const server = createServer((request, response) => {
      observed.push({ path: request.url!, socket: request.socket });
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
    });
    const api = await listen(server);
    const body = await playwrightRequest.newContext();
    cleanups.push(() => body.dispose());
    expect((await body.get(`${api}/health`)).status()).toBe(200);
    const creation = vi.spyOn(playwrightRequest, "newContext");
    let stopped = false;

    await closeCollectFixture(api, [
      async () => {
        const owned = await creation.mock.results[0]!.value;
        await expect(owned.get(`${api}/health`)).rejects.toThrow(
          /closed|disposed/i,
        );
        stopped = true;
      },
    ]);

    expect(stopped).toBe(true);
    expect(creation).toHaveBeenCalledTimes(1);
    expect(observed.map((item) => item.path)).toEqual([
      "/api/health",
      "/api/project/close",
    ]);
    expect(observed[1]!.socket).not.toBe(observed[0]!.socket);
    expect((await body.get(`${api}/health`)).status()).toBe(200);
  });

  it.each([409, 500])(
    "propagates HTTP %s without cancelling jobs or retrying, while disposing and releasing resources",
    async (status) => {
      const paths: string[] = [];
      const server = createServer((request, response) => {
        paths.push(request.url!);
        response.writeHead(status, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: "Intentional close refusal" }));
      });
      const api = await listen(server);
      const creation = vi.spyOn(playwrightRequest, "newContext");
      let stopped = false;
      await expect(
        closeCollectFixture(api, [
          async () => {
            stopped = true;
          },
        ]),
      ).rejects.toThrow(/200/);
      expect(stopped).toBe(true);
      expect(paths).toEqual(["/api/project/close"]);
      expect(creation).toHaveBeenCalledTimes(1);
      const owned = await creation.mock.results[0]!.value;
      await expect(owned.get(`${api}/health`)).rejects.toThrow(
        /closed|disposed/i,
      );
      expect(server.listening).toBe(true);
    },
  );

  it("propagates a real socket reset once while disposing and releasing resources", async () => {
    let requests = 0;
    const server = createServer((request) => {
      requests++;
      request.socket.destroy();
    });
    const api = await listen(server);
    const creation = vi.spyOn(playwrightRequest, "newContext");
    let stopped = false;
    await expect(
      closeCollectFixture(api, [
        async () => {
          stopped = true;
        },
      ]),
    ).rejects.toThrow(/socket hang up|ECONNRESET/i);
    expect(stopped).toBe(true);
    expect(requests).toBe(1);
    const owned = await creation.mock.results[0]!.value;
    await expect(owned.get(`${api}/health`)).rejects.toThrow(
      /closed|disposed/i,
    );
  });

  it("preserves the primary close error and every cleanup failure while attempting all resources", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(500);
      response.end();
    });
    const api = await listen(server);
    const secondary = new Error("fixture release failed");
    const order: number[] = [];
    let failure: unknown;
    try {
      await closeCollectFixture(api, [
        async () => {
          order.push(1);
          throw secondary;
        },
        async () => {
          order.push(2);
        },
      ]);
    } catch (error) {
      failure = error;
    }
    expect(order).toEqual([1, 2]);
    expect(failure).toBeInstanceOf(AggregateError);
    const aggregate = failure as AggregateError;
    expect(aggregate.errors).toHaveLength(2);
    expect(aggregate.cause).toBe(aggregate.errors[0]);
    expect(String(aggregate.errors[0])).toContain("200");
    expect(aggregate.errors[1]).toBe(secondary);
  });

  it("retains a sole cleanup failure by identity and still attempts later resources", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200);
      response.end();
    });
    const api = await listen(server);
    const failure = new Error("fixture release failed");
    let later = false;
    await expect(
      closeCollectFixture(api, [
        async () => {
          throw failure;
        },
        async () => {
          later = true;
        },
      ]),
    ).rejects.toBe(failure);
    expect(later).toBe(true);
  });
});
