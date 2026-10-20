import { afterEach, expect, it } from "vitest";
import { startServer } from "../../apps/server/src/server.js";
const services: Awaited<ReturnType<typeof startServer>>[] = [];
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.close()));
});
it("owns an ephemeral loopback port and rejects requests without its private native session", async () => {
  const session = "a".repeat(64);
  const first = await startServer({ port: 0, nativeSession: session });
  services.push(first);
  const second = await startServer({ port: 0, nativeSession: "b".repeat(64) });
  services.push(second);
  expect(first.port).not.toBe(second.port);
  const root = `http://127.0.0.1:${first.port}`;
  expect((await fetch(`${root}/api/workspace`)).status).toBe(403);
  expect(
    (await fetch(`${root}/native/${"b".repeat(64)}/api/workspace`)).status,
  ).toBe(403);
  expect((await fetch(`${root}/native/${session}/api/workspace`)).status).toBe(
    200,
  );
  expect(
    (
      await fetch(`${root}/native/${session}/api/workspace`, {
        headers: { Origin: "https://attacker.example" },
      })
    ).status,
  ).toBe(403);
});
