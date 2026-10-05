import type { Event, MediaAsset, SimilarityGroup } from "@openfilm/core";

class DisjointSet {
  private parents: number[];
  constructor(size: number) {
    this.parents = Array.from({ length: size }, (_, i) => i);
  }
  root(index: number): number {
    let current = index;
    while (this.parents[current] !== current) current = this.parents[current]!;
    while (this.parents[index] !== index) {
      const next = this.parents[index]!;
      this.parents[index] = current;
      index = next;
    }
    return current;
  }
  join(left: number, right: number): void {
    this.parents[this.root(right)] = this.root(left);
  }
}

function hash(value: string | undefined): string | undefined {
  const cleaned = value?.trim().toLowerCase();
  return cleaned &&
    /^[a-f0-9]+$/.test(cleaned) &&
    cleaned.length % 2 === 0 &&
    cleaned.length <= 128
    ? cleaned
    : undefined;
}

/** Unequal-length or malformed fingerprints are not comparable. */
export function perceptualDistance(
  left: string,
  right: string,
): number | undefined {
  const a = hash(left),
    b = hash(right);
  if (!a || !b || a.length !== b.length) return undefined;
  let distance = 0;
  for (let i = 0; i < a.length; i++) {
    let bits = Number.parseInt(a[i]!, 16) ^ Number.parseInt(b[i]!, 16);
    while (bits) {
      distance++;
      bits &= bits - 1;
    }
  }
  return distance;
}

export function findDuplicates(assets: MediaAsset[]): SimilarityGroup[] {
  const sorted = [...assets].sort((a, b) => a.id.localeCompare(b.id));
  const exact = new Map<string, string[]>();
  const fingerprints = new Map<string, MediaAsset[]>();
  for (const asset of sorted) {
    const content = asset.contentHash?.trim().toLowerCase();
    if (content) {
      const group = exact.get(content) ?? [];
      group.push(asset.id);
      exact.set(content, group);
    }
    const fingerprint = hash(asset.perceptualHash);
    // Fingerprints of unlike media types do not describe comparable pixels.
    if (fingerprint) {
      const key = `${asset.mediaType}:${fingerprint}`;
      const group = fingerprints.get(key) ?? [];
      group.push(asset);
      fingerprints.set(key, group);
    }
  }
  const groups: SimilarityGroup[] = [];
  for (const ids of exact.values())
    if (ids.length > 1)
      groups.push({
        id: `exact:${ids.join(":")}`,
        kind: "exact",
        assetIds: ids,
        confidence: 1,
      });
  const entries = [...fingerprints.entries()];
  const sets = new DisjointSet(entries.length);
  const buckets = new Map<string, number[]>();
  const compared = new Set<string>();
  // A Hamming match with at most k changed bits must share one of k+1 blocks.
  // Index unique fingerprints so a large exact burst does not become quadratic.
  for (let i = 0; i < entries.length; i++) {
    const [key] = entries[i]!;
    const [type, value] = key.split(":") as [string, string];
    const bits = [...value]
      .map((digit) => Number.parseInt(digit, 16).toString(2).padStart(4, "0"))
      .join("");
    const threshold = Math.min(6, Math.floor(bits.length * 0.1));
    for (let block = 0; block <= threshold; block++) {
      const from = Math.floor((block * bits.length) / (threshold + 1));
      const to = Math.floor(((block + 1) * bits.length) / (threshold + 1));
      const bucketKey = `${type}:${bits.length}:${block}:${bits.slice(from, to)}`;
      const others = buckets.get(bucketKey) ?? [];
      for (const other of others) {
        const pair = `${other}:${i}`;
        if (compared.has(pair)) continue;
        compared.add(pair);
        const distance = perceptualDistance(
          value,
          entries[other]![0].split(":")[1]!,
        );
        if (distance !== undefined && distance <= threshold)
          sets.join(i, other);
      }
      others.push(i);
      buckets.set(bucketKey, others);
    }
  }
  const components = new Map<number, MediaAsset[]>();
  entries.forEach((entry, i) => {
    const root = sets.root(i);
    const list = components.get(root) ?? [];
    list.push(...entry[1]);
    components.set(root, list);
  });
  for (const component of components.values()) {
    if (component.length < 2) continue;
    const ids = component.map((asset) => asset.id).sort();
    if (
      groups.some(
        (group) =>
          group.kind === "exact" &&
          group.assetIds.length === ids.length &&
          group.assetIds.every((id, i) => id === ids[i]),
      )
    )
      continue;
    groups.push({
      id: `perceptual:${ids.join(":")}`,
      kind: "perceptual",
      assetIds: ids,
      confidence: 0.9,
    });
  }
  return groups.sort((a, b) => a.id.localeCompare(b.id));
}

export interface EventClusteringOptions {
  timeGapSeconds?: number;
  maxDistanceKm?: number;
  maxSpanSeconds?: number;
}

function validGps(asset: MediaAsset): boolean {
  return (
    !!asset.gps &&
    Number.isFinite(asset.gps.latitude) &&
    Number.isFinite(asset.gps.longitude) &&
    Math.abs(asset.gps.latitude) <= 90 &&
    Math.abs(asset.gps.longitude) <= 180
  );
}

function kilometers(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const radians = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * radians,
    dLon = (b.longitude - a.longitude) * radians;
  const half =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.latitude * radians) *
      Math.cos(b.latitude * radians) *
      Math.sin(dLon / 2) ** 2;
  return (
    6371 * 2 * Math.atan2(Math.sqrt(half), Math.sqrt(Math.max(0, 1 - half)))
  );
}

function centroid(
  assets: MediaAsset[],
): { latitude: number; longitude: number; radiusKm: number } | undefined {
  const points = assets.filter(validGps).map((asset) => asset.gps!);
  if (!points.length) return undefined;
  const latitude =
    points.reduce((sum, point) => sum + point.latitude, 0) / points.length;
  const longitude =
    (Math.atan2(
      points.reduce(
        (sum, point) => sum + Math.sin((point.longitude * Math.PI) / 180),
        0,
      ),
      points.reduce(
        (sum, point) => sum + Math.cos((point.longitude * Math.PI) / 180),
        0,
      ),
    ) *
      180) /
    Math.PI;
  const center = { latitude, longitude };
  return {
    ...center,
    radiusKm: Math.max(...points.map((point) => kilometers(center, point))),
  };
}

function capture(asset: MediaAsset): number | undefined {
  const time = asset.capturedAt ? Date.parse(asset.capturedAt) : NaN;
  return Number.isFinite(time) ? time / 1000 : undefined;
}

/** Stable temporal sweep with geographic separation and similarity support. */
export function clusterEvents(
  assets: MediaAsset[],
  options: EventClusteringOptions = {},
): Event[] {
  const gap = options.timeGapSeconds ?? 5400;
  const distance = options.maxDistanceKm ?? 25;
  const span = options.maxSpanSeconds ?? 28800;
  if (
    ![gap, distance, span].every(
      (value) => Number.isFinite(value) && value >= 0,
    )
  )
    throw new Error("Event thresholds must be finite non-negative values.");
  const sorted = [...assets].sort(
    (a, b) =>
      (capture(a) ?? Infinity) - (capture(b) ?? Infinity) ||
      a.id.localeCompare(b.id),
  );
  const clusters: MediaAsset[][] = [];
  let latitudeSum = 0,
    longitudeSinSum = 0,
    longitudeCosSum = 0,
    pointCount = 0;
  const addPoint = (asset: MediaAsset): void => {
    if (!validGps(asset)) return;
    latitudeSum += asset.gps!.latitude;
    longitudeSinSum += Math.sin((asset.gps!.longitude * Math.PI) / 180);
    longitudeCosSum += Math.cos((asset.gps!.longitude * Math.PI) / 180);
    pointCount++;
  };
  const startCluster = (asset: MediaAsset): void => {
    clusters.push([asset]);
    latitudeSum = 0;
    longitudeSinSum = 0;
    longitudeCosSum = 0;
    pointCount = 0;
    addPoint(asset);
  };
  for (const asset of sorted) {
    const time = capture(asset);
    const current = clusters.at(-1);
    const previous = current?.at(-1);
    if (
      !current ||
      !previous ||
      time === undefined ||
      capture(previous) === undefined
    ) {
      startCluster(asset);
      continue;
    }
    const previousTime = capture(previous)!;
    const firstTime = capture(current[0]!)!;
    const difference =
      asset.mediaType === previous.mediaType &&
      asset.perceptualHash &&
      previous.perceptualHash
        ? perceptualDistance(asset.perceptualHash, previous.perceptualHash)
        : undefined;
    const similar = difference !== undefined && difference <= 6;
    const region = pointCount
      ? {
          latitude: latitudeSum / pointCount,
          longitude:
            (Math.atan2(longitudeSinSum, longitudeCosSum) * 180) / Math.PI,
        }
      : undefined;
    const near =
      !validGps(asset) || !region || kilometers(region, asset.gps!) <= distance;
    if (
      near &&
      time - previousTime <= gap * (similar ? 2 : 1) &&
      time - firstTime <= span
    ) {
      current.push(asset);
      addPoint(asset);
    } else startCluster(asset);
  }
  return clusters.map((cluster) => {
    const dated = cluster.filter((asset) => capture(asset) !== undefined);
    const region = centroid(cluster);
    return {
      id: `event:${cluster.map((asset) => asset.id).join(":")}`,
      startAt: dated[0]?.capturedAt,
      endAt: dated.at(-1)?.capturedAt,
      assetIds: cluster.map((asset) => asset.id),
      labels: [],
      location: region,
      confidence: dated.length
        ? Math.min(
            1,
            0.6 + (region ? 0.2 : 0) + Math.min(cluster.length, 5) * 0.04,
          )
        : 0.2,
    };
  });
}
