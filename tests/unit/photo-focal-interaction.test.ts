import { expect, it } from "vitest";
import {
  resolvePhotoFocalGeometry,
  photoFocalPointAtViewport,
  photoFocalPointFromDelta,
} from "../../apps/desktop/src/photoFocalInteraction";

it("maps displayed source coordinates through contain, viewport scale and static rotation without accumulating crop drift", () => {
  const geometry = resolvePhotoFocalGeometry(
    { assetId: "photo", x: 100, y: 0, width: 120, height: 180 },
    { scale: 1, x: 0, y: 0 },
    undefined,
    { width: 320, height: 180 },
    { left: 10, top: 20, width: 640, height: 360 },
  );
  expect(photoFocalPointAtViewport({ x: 330, y: 200 }, geometry)).toEqual({
    x: 0.5,
    y: 0.5,
  });
  expect(
    photoFocalPointFromDelta({ x: 0.5, y: 0.5 }, { x: 24, y: -36 }, geometry),
  ).toEqual({ x: 0.6, y: 0.4 });
  const rotated = resolvePhotoFocalGeometry(
    { assetId: "photo", x: 0, y: 0, width: 320, height: 180 },
    { scale: 1, x: 0, y: 0 },
    { scale: 2, rotation: 90, x: 10.2, y: -4.8 },
    { width: 320, height: 180 },
    { left: 10, top: 20, width: 640, height: 360 },
  );
  const point = photoFocalPointAtViewport({ x: 170, y: -130 }, rotated)!;
  expect(point.x).toBeCloseTo(0.25, 12);
  expect(point.y).toBeCloseTo(0.75, 12);
  const moved = photoFocalPointFromDelta(point, { x: 36, y: 64 }, rotated)!;
  expect(moved.x).toBeCloseTo(0.3, 12);
  expect(moved.y).toBeCloseTo(0.7, 12);
});

it("clamps to source edges and declines singular or nonfinite captured geometry", () => {
  const geometry = resolvePhotoFocalGeometry(
    { assetId: "photo", x: 0, y: 0, width: 100, height: 200 },
    { scale: 1, x: 0, y: 0 },
    undefined,
    { width: 100, height: 200 },
    { left: 0, top: 0, width: 100, height: 200 },
  );
  expect(photoFocalPointAtViewport({ x: -50, y: 300 }, geometry)).toEqual({
    x: 0,
    y: 1,
  });
  expect(photoFocalPointAtViewport({ x: NaN, y: 0 }, geometry)).toBeNull();
  expect(
    photoFocalPointAtViewport(
      { x: 1, y: 1 },
      { ...geometry, sourceToViewport: [0, 0, 0, 0, 0, 0] },
    ),
  ).toBeNull();
});
