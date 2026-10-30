import { request as httpRequest } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { OpenFilmApplication } from "@openfilm/application";
import { startServer } from "../../apps/server/src/server.js";
import { toneSource } from "../fixtures/audio-policy.js";
const clean: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => {
  for (const f of clean.splice(0).reverse()) await f();
});
it("serves only bounded opaque PCM ranges under existing host, origin and session guards on port 0", async () => {
  const root = await mkdtemp(join(tmpdir(), "openfilm-record-http-"));
  clean.push(() => rm(root, { recursive: true, force: true }));
  const asset = await toneSource(root, "source", 880, 2),
    directory = join(root, "p.openfilm"),
    app = await OpenFilmApplication.create(directory, "PCM");
  app.catalog.upsertAsset(asset);
  app.project.settings = { width: 160, height: 90, frameRate: 30 };
  app.project.schemaVersion = "1.2.0";
  app.project.stories = [{ id: "s", title: "S", beats: [] }];
  app.project.timelines = [
    {
      id: "c",
      storyId: "s",
      duration: 2,
      tracks: [
        {
          id: "v",
          type: "audio",
          clips: [
            {
              id: "a",
              assetId: asset.id,
              timelineStart: 0,
              timelineDuration: 2,
              sourceIn: 0,
              sourceOut: 2,
              audioTiming: {
                version: 1,
                sampleRate: 48000,
                timelineStartSample: 0,
                sourceInSample: 0,
                sourceOutSample: 96000,
              },
            },
          ],
        },
      ],
    },
  ];
  await app.save();
  app.close();
  const disk = await readFile(join(directory, "project.json"), "utf8"),
    server = await startServer({ port: 0, project: directory });
  clean.push(() => server.close());
  const base = `http://127.0.0.1:${server.port}`,
    state = await (await fetch(`${base}/api/compositions/c/editor`)).json(),
    post = (body: unknown, headers = {}) =>
      fetch(`${base}/api/compositions/c/record-audio-preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
      });
  expect(
    (await post({ baseRevision: state.revision, path: "/tmp/arbitrary.wav" }))
      .status,
  ).toBe(400);
  expect(
    (
      await post(
        { baseRevision: state.revision },
        { Origin: "https://evil.invalid" },
      )
    ).status,
  ).toBe(403);
  const badHostStatus = await new Promise<number>((resolve, reject) => {
    const outgoing = httpRequest(
      `${base}/api/compositions/c/record-audio-preview`,
      {
        method: "POST",
        headers: { Host: "evil.invalid", "Content-Type": "application/json" },
      },
      (response) => {
        response.resume();
        response.on("end", () => resolve(response.statusCode!));
      },
    );
    outgoing.on("error", reject);
    outgoing.end(JSON.stringify({ baseRevision: state.revision }));
  });
  expect(badHostStatus).toBe(403);
  const handles = await fetch(
    `${base}/api/compositions/c/clips/a/audio-handles?${new URLSearchParams({ baseRevision: state.revision })}`,
  );
  expect(handles.status).toBe(200);
  expect(await handles.json()).toEqual({
    version: 1,
    clipId: "a",
    assetId: asset.id,
    revision: state.revision,
    sourceHash: asset.contentHash,
    sampleRate: 48000,
    lengthSamples: 96000,
  });
  const response = await post({ baseRevision: state.revision });
  expect(response.status).toBe(200);
  const descriptor = await response.json();
  expect(descriptor).not.toHaveProperty("path");
  const range = await fetch(
    `${base}/api/record-audio-preview/${descriptor.id}/pcm?startSample=48&count=48000`,
  );
  expect(range.status).toBe(200);
  expect(range.headers.get("X-OpenFilm-PCM-Sample-Rate")).toBe("48000");
  expect(range.headers.get("X-OpenFilm-PCM-Format")).toBe("pcm_s24le");
  expect(range.headers.get("X-OpenFilm-PCM-Frame-Count")).toBe("48000");
  expect((await range.arrayBuffer()).byteLength).toBe(48000 * 6);
  for (const query of [
    "startSample=-1&count=1",
    "startSample=0&count=192001",
    "startSample=0.5&count=1",
    "startSample=0&count=1&path=/tmp/a",
    "startSample=0&startSample=1&count=1",
    "startSample=0&count=NaN",
  ]) {
    expect(
      (
        await fetch(
          `${base}/api/record-audio-preview/${descriptor.id}/pcm?${query}`,
        )
      ).status,
    ).toBe(400);
  }
  expect(
    (
      await fetch(
        `${base}/api/record-audio-preview/unknown/pcm?startSample=0&count=1`,
      )
    ).status,
  ).toBe(404);
  const session = "b".repeat(64),
    native = await startServer({
      port: 0,
      project: directory,
      nativeSession: session,
    });
  clean.push(() => native.close());
  const nativeBase = `http://127.0.0.1:${native.port}`;
  expect(
    (
      await fetch(
        `${nativeBase}/api/record-audio-preview/${descriptor.id}/pcm?startSample=0&count=1`,
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await fetch(
        `${nativeBase}/native/${"c".repeat(64)}/api/compositions/c/record-audio-preview`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ baseRevision: state.revision }),
        },
      )
    ).status,
  ).toBe(403);
  expect(await readFile(join(directory, "project.json"), "utf8")).toBe(disk);
});
