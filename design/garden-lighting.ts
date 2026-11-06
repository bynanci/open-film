// Modified by OpenFilm contributors on 2026-11-05. See LICENSE/NOTICE.

const radians = Math.PI / 180;
const degrees = 180 / Math.PI;
const referenceLatitude = 35;
const lightingRefreshMs = 15 * 60 * 1000;

type GardenLightPhase =
  "night" | "dawn" | "morning" | "midday" | "afternoon" | "dusk";

type ShadowLayer = {
  name: "soft" | "raised" | "hover" | "floating" | "dialog";
  height: number;
  strength: number;
};

const shadowLayers: readonly ShadowLayer[] = [
  { name: "soft", height: 1.5, strength: 7 },
  { name: "raised", height: 3, strength: 12 },
  { name: "hover", height: 6, strength: 17 },
  { name: "floating", height: 9, strength: 20 },
  { name: "dialog", height: 14, strength: 23 },
];

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function fixed(value: number): string {
  return Number(value.toFixed(2)).toString();
}

function dayOfYear(date: Date): number {
  const current = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const first = Date.UTC(date.getFullYear(), 0, 0);
  return Math.floor((current - first) / 86_400_000);
}

function shadowFor(
  height: number,
  strength: number,
  elevation: number,
  directionX: number,
  directionY: number,
  isSunlit: boolean,
): string {
  const effectiveElevation = (isSunlit ? Math.max(elevation, 8) : 42) * radians;
  const castLength = clamp(height / Math.tan(effectiveElevation), 0.8, 22);
  const blur = clamp(2 + castLength * 0.72 + height * 0.3, 2, 28);
  const opacity = Math.round(strength * (isSunlit ? 1 : 0.48));
  const ambientOpacity = Math.max(3, Math.round(opacity * 0.48));
  const highlightOpacity = Math.max(3, Math.round(strength * 0.36));
  const highlight = `${fixed(-directionX * height * 0.22)}px ${fixed(-directionY * height * 0.22)}px ${fixed(Math.max(1, blur * 0.42))}px color-mix(in srgb, var(--of-shadow-light-tint) ${highlightOpacity}%, transparent)`;
  const cast = `${fixed(directionX * castLength)}px ${fixed(directionY * castLength)}px ${fixed(blur)}px 0 color-mix(in srgb, var(--of-shadow-tint) ${opacity}%, transparent)`;
  const ambient = `0 ${fixed(Math.max(1, height * 0.28))}px ${fixed(Math.max(2, height * 1.45))}px color-mix(in srgb, var(--of-shadow-tint) ${ambientOpacity}%, transparent)`;
  return `${highlight}, ${cast}, ${ambient}`;
}

function logoShadowFor(
  elevation: number,
  directionX: number,
  directionY: number,
  isSunlit: boolean,
): string {
  const effectiveElevation = (isSunlit ? Math.max(elevation, 8) : 42) * radians;
  const length = clamp(1.8 / Math.tan(effectiveElevation), 0.8, 7);
  const blur = clamp(2 + length * 0.65, 2, 7);
  const opacity = isSunlit ? 11 : 6;
  return `${fixed(directionX * length)}px ${fixed(directionY * length)}px ${fixed(blur)}px color-mix(in srgb, var(--of-shadow-tint) ${opacity}%, transparent)`;
}

/**
 * Returns a local, location-free approximation of a 35°N garden sun arc.
 * Local wall time and the calendar date move the source from east through noon
 * to west; no location permission or network request is used.
 */
export function applyGardenLighting(
  root: HTMLElement,
  date = new Date(),
): GardenLightPhase {
  const day = dayOfYear(date);
  const declination = 23.44 * Math.sin((2 * Math.PI * (284 + day)) / 365.2422);
  const localHour =
    date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
  const hourAngle = (localHour - 12) * 15;
  const latitude = referenceLatitude * radians;
  const sunDeclination = declination * radians;
  const hourAngleRadians = hourAngle * radians;

  // Local east/north/up components provide the direction and elevation of the
  // stylized sun source without querying device location.
  const east = -Math.cos(sunDeclination) * Math.sin(hourAngleRadians);
  const north =
    Math.cos(latitude) * Math.sin(sunDeclination) -
    Math.sin(latitude) * Math.cos(sunDeclination) * Math.cos(hourAngleRadians);
  const up =
    Math.sin(latitude) * Math.sin(sunDeclination) +
    Math.cos(latitude) * Math.cos(sunDeclination) * Math.cos(hourAngleRadians);
  const elevation = Math.asin(clamp(up, -1, 1)) * degrees;
  const isSunlit = elevation > 0;
  const horizontalLength = Math.hypot(east, north);
  const directionX =
    isSunlit && horizontalLength > 0.08 ? -east / horizontalLength : 0.42;
  const directionY =
    isSunlit && horizontalLength > 0.08 ? north / horizontalLength : 0.91;
  const azimuth = (Math.atan2(east, north) * degrees + 360) % 360;

  let phase: GardenLightPhase;
  if (!isSunlit) phase = "night";
  else if (elevation < 14) phase = localHour < 12 ? "dawn" : "dusk";
  else if (localHour < 10) phase = "morning";
  else if (localHour < 14) phase = "midday";
  else phase = "afternoon";

  root.dataset.sunPhase = phase;
  root.style.setProperty("--of-sun-azimuth", `${fixed(azimuth)}deg`);
  root.style.setProperty("--of-sun-elevation", `${fixed(elevation)}deg`);
  root.style.setProperty("--of-shadow-vector-x", fixed(directionX));
  root.style.setProperty("--of-shadow-vector-y", fixed(directionY));
  root.style.setProperty(
    "--of-shadow-logo",
    logoShadowFor(elevation, directionX, directionY, isSunlit),
  );
  for (const layer of shadowLayers) {
    root.style.setProperty(
      `--of-shadow-${layer.name}`,
      shadowFor(
        layer.height,
        layer.strength,
        elevation,
        directionX,
        directionY,
        isSunlit,
      ),
    );
  }
  root.style.setProperty(
    "--of-shadow-contact",
    shadowFor(0.6, 8, elevation, directionX, directionY, isSunlit),
  );
  return phase;
}

export function startGardenLighting(
  root: HTMLElement = document.documentElement,
): () => void {
  const update = () => applyGardenLighting(root);
  const refreshOnReturn = () => {
    if (document.visibilityState === "visible") update();
  };

  update();
  const timer = window.setInterval(update, lightingRefreshMs);
  document.addEventListener("visibilitychange", refreshOnReturn);

  return () => {
    window.clearInterval(timer);
    document.removeEventListener("visibilitychange", refreshOnReturn);
  };
}
