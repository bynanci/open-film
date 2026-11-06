import { performance } from "node:perf_hooks";
import assert from "node:assert/strict";
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
function measure(name, before, after) {
  const a = [],
    b = [];
  for (let i = 0; i < 24; i++) {
    for (const [fn, out] of i % 2
      ? [
          [after, b],
          [before, a],
        ]
      : [
          [before, a],
          [after, b],
        ]) {
      const t = performance.now();
      const value = fn();
      const ms = performance.now() - t;
      assert.equal(value, true);
      if (i >= 4) out.push(ms);
    }
  }
  return {
    name,
    samples: 20,
    beforeMedianMs: median(a),
    afterMedianMs: median(b),
    beforeP95Ms: [...a].sort((x, y) => x - y)[18],
    afterP95Ms: [...b].sort((x, y) => x - y)[18],
  };
}
const c = Array.from({ length: 2000 }, (_, i) => ({ id: `silence-${i}` })),
  ids = c.map((x) => x.id);
const photos = Array.from({ length: 1000 }, (_, i) => ({ id: `photo-${i}` }));
const results = [
  measure(
    "silence membership2000",
    () => !ids.some((id) => !c.some((x) => x.id === id)),
    () => {
      const s = new Set(c.map((x) => x.id));
      return !ids.some((id) => !s.has(id));
    },
  ),
  measure(
    "photo manifest lookup1000",
    () => photos.every((x) => photos.find((y) => y.id === x.id) === x),
    () => {
      const m = new Map();
      for (const x of photos) if (!m.has(x.id)) m.set(x.id, x);
      return photos.every((x) => m.get(x.id) === x);
    },
  ),
];
console.log(
  JSON.stringify(
    {
      node: process.version,
      method:
        "4 warmups,20 alternating timed samples; includes index construction; lookup-only, not whole-render latency",
      results,
    },
    null,
    2,
  ),
);
