import { describe, expect, it } from "vitest";
import {
  iterateMediaCandidates,
  type MediaCandidate,
  type MediaSourceAdapter,
  type MediaSourceAdapterV2,
} from "../src/index.js";

const input = { uri: "file:///synthetic/root", type: "folder" as const };
const candidate = (index: number): MediaCandidate => ({
  uri: `file:///synthetic/root/${index}.jpg`,
  name: `${index}.jpg`,
  relativePath: `${index}.jpg`,
});

describe("streaming source adapter compatibility", () => {
  it("yields a v2 candidate before asking the adapter for the next item", async () => {
    let produced = 0;
    const adapter: MediaSourceAdapterV2 = {
      id: "test.streaming",
      supports: () => true,
      async *discover() {
        for (let index = 0; index < 10_000; index++) {
          produced++;
          yield candidate(index);
        }
      },
      async extractMetadata() {
        return {};
      },
    };

    const iterator = iterateMediaCandidates(adapter, input)[
      Symbol.asyncIterator
    ]();
    expect(await iterator.next()).toMatchObject({
      value: candidate(0),
      done: false,
    });
    expect(produced).toBe(1);
    await iterator.return?.(undefined);
    expect(produced).toBe(1);
  });

  it("consumes 10,000 v2 candidates with bounded memory and prompt cancellation", async () => {
    const controller = new AbortController();
    let produced = 0;
    let finalized = false;
    const adapter: MediaSourceAdapterV2 = {
      id: "test.large-stream",
      supports: () => true,
      async *discover(_source, options) {
        try {
          for (let index = 0; index < 10_000; index++) {
            if (options?.signal?.aborted)
              throw Object.assign(new Error("cancelled"), {
                name: "AbortError",
              });
            produced++;
            yield candidate(index);
          }
        } finally {
          finalized = true;
        }
      },
      async extractMetadata() {
        return {};
      },
    };

    let received = 0;
    await expect(async () => {
      for await (const _entry of iterateMediaCandidates(adapter, input, {
        signal: controller.signal,
      })) {
        received++;
        if (received === 17) controller.abort();
      }
    }).rejects.toMatchObject({ name: "AbortError" });
    expect(received).toBe(17);
    expect(produced).toBe(17);
    expect(finalized).toBe(true);
  });

  it("wraps a legacy materializing adapter without changing its contract", async () => {
    const values = [candidate(0), candidate(1)];
    const adapter: MediaSourceAdapter = {
      id: "test.legacy",
      supports: () => true,
      async scan() {
        return values;
      },
      async extractMetadata() {
        return {};
      },
    };
    const streamed: MediaCandidate[] = [];
    for await (const entry of iterateMediaCandidates(adapter, input))
      streamed.push(entry);
    expect(streamed).toEqual(values);
  });
});
