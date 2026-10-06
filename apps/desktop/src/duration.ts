export type DurationStatus =
  "ideal" | "near-target" | "near-maximum" | "over-maximum";

/** The final quarter of target-to-maximum headroom is the near-maximum zone. */
export function durationStatus(
  current: number,
  target?: number,
  maximum?: number,
): DurationStatus {
  const valid = (value: number | undefined): value is number =>
    value !== undefined && Number.isFinite(value) && value >= 0;
  const limit = valid(maximum) ? maximum : valid(target) ? target : Infinity;
  const goal = valid(target) ? Math.min(target, limit) : limit;
  if (current > limit + 0.001) return "over-maximum";
  if (current <= goal + 0.001 || !Number.isFinite(current)) return "ideal";
  return current >= goal + (limit - goal) * 0.75
    ? "near-maximum"
    : "near-target";
}
