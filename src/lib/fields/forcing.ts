/**
 * Forcing fields.
 *
 * In production these are read from STAC-registered products: AMSR2 / NSIDC
 * for concentration, ERA5 for wind, CMEMS for current (analysis §6.1). For a
 * self-contained, offline-runnable demo we synthesise fields that respect the
 * real Antarctic geometry: a seasonal pack around the continent, a mobile ice
 * edge, persistent polynyas, and a circumpolar current that dominates giant
 * tabular bergs (L6).
 *
 * Every field is a pure function of (lat, lon, hoursSinceEpoch) and is
 * deterministic, so a replayed week always produces the same advice.
 */

import { classifyRegime, SIC_ICE_EDGE } from "@/lib/physics/regimes";

const RAD = Math.PI / 180;

/**
 * Time convention for every field in this module: a numeric `t` is EPOCH
 * SECONDS (the same unit the drift integrator steps in and that
 * `BergPosition.observedAt` / `TrajectoryPoint.epochSec` store). A `Date` is
 * accepted for convenience.
 *
 * Both forms must agree — a caller silently passing hours or milliseconds
 * would shift the seasonal cycle by centuries and produce an ice field that
 * oscillates between open water and solid pack over a few hundred kilometres.
 */
export function toDate(t: Date | number): Date {
  return typeof t === "number" ? new Date(t * 1000) : t;
}

export function toHours(t: Date | number): number {
  return typeof t === "number" ? t / 3600 : t.getTime() / 3600000;
}

/** Deterministic hash → [0,1). Reproducible across processes. */
function hash2(ix: number, iy: number, seed = 0): number {
  let h = ix * 374761393 + iy * 668265263 + seed * 1442695040888963407;
  h = (h ^ (h >> 13)) * 1274126177;
  h = h ^ (h >> 16);
  // Fold into [0,1)
  return (Math.abs(h % 100000) / 100000);
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** 2D value noise in degrees, interpolated on a `cellDeg` lattice. */
export function valueNoise(
  lat: number,
  lon: number,
  cellDeg = 3,
  seed = 0,
): number {
  const gx = lon / cellDeg;
  const gy = lat / cellDeg;
  const ix = Math.floor(gx);
  const iy = Math.floor(gy);
  const fx = smooth(gx - ix);
  const fy = smooth(gy - iy);

  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);

  return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy;
}

/**
 * Seasonal factor. `dayOfYear` 1 = 1 Jan. Antarctic sea ice peaks in
 * September and reaches its minimum in February, so we centre the cycle on
 * day 255 (mid-September) and day 45 (mid-February).
 */
export function seasonalIce(dayOfYear: number): number {
  return 0.5 - 0.5 * Math.cos(((dayOfYear - 45) / 365.25) * 2 * Math.PI);
}

/**
 * Sea-ice concentration 0..1.
 * The pack hugs the continent and thins northward to an ice edge that
 * migrates with the season. Longitude-dependent embayments (Weddell, Ross)
 * come from a low-frequency noise term.
 */
export function seaIceConcentration(
  lat: number,
  lon: number,
  t: Date | number,
  opts: { seasonOverride?: number } = {},
): number {
  const date = toDate(t);
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const dayOfYear = (date.getTime() - start) / 86400000;
  const season = opts.seasonOverride ?? seasonalIce(dayOfYear);

  // Ice edge latitude, calibrated to the observed Antarctic cycle: the edge
  // retreats to ~ -63°S at the February minimum and advances to ~ -55°S at
  // the September maximum. `season` is 0 at the minimum and 1 at the maximum.
  const iceEdge = -63 + 8 * season;

  // Longitudinal structure: Weddell (~-45°) and Ross (~-180°) hold ice longer.
  const lonWarp = 1.6 * valueNoise(lat, lon, 9, 11) - 0.8;
  const localEdge = iceEdge + lonWarp;

  // Signed distance north of the local edge (positive = open water).
  const dOpen = lat - localEdge;

  // Sigmoid from 1 (pack) to 0 (open water) across ~4° of latitude.
  let sic = 1 / (1 + Math.exp(dOpen / 1.35));

  // Fine floe structure at the margin.
  sic += 0.18 * (valueNoise(lat, lon, 1.1, 3) - 0.5) * (1 - Math.abs(sic - 0.5) * 2);

  // Persistent polynyas: warm-water/wind-driven holes inside the pack.
  const polynya = valueNoise(lat, lon, 7, 19);
  if (sic > 0.6 && polynya > 0.86) sic -= 0.75 * (polynya - 0.86) / 0.14;

  return Math.max(0, Math.min(1, sic));
}

/** Mean ice thickness in metres — the second condition for ice-lock. */
export function iceThicknessM(lat: number, lon: number, t: Date | number): number {
  const sic = seaIceConcentration(lat, lon, t);
  if (sic < SIC_ICE_EDGE) return 0;
  const date = toDate(t);
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const dayOfYear = (date.getTime() - start) / 86400000;
  const age = seasonalIce(dayOfYear);

  // Antarctic pack is almost entirely annual, so seasonal growth alone would
  // make the Weddell pack too thin to lock a berg in January. Ice also
  // thickens the deeper it sits inside the pack (ridging, age, deformation),
  // so distance south of the local ice edge is a second-order driver.
  const localEdge = -63 + 8 * age + 1.6 * valueNoise(lat, lon, 9, 11) - 0.8;
  const packDepth = Math.max(0, localEdge - lat);

  const base = 0.2 + 1.5 * age * sic + 0.08 * packDepth;
  return Math.max(0, base + 0.25 * (valueNoise(lat, lon, 2, 7) - 0.5));
}

/** ERA5-shaped surface wind, m/s (u = eastward, v = northward). */
export function wind(lat: number, lon: number, t: Date | number): { u: number; v: number } {
  const hours = toHours(t);
  // Southern Ocean westerlies, strengthening with latitude toward ~-60°S.
  const westerly = -3 + 13 * Math.exp(-((lat + 58) ** 2) / 260);
  const gust = 9 * (valueNoise(lat, lon + hours / 24, 4, 23) - 0.5);
  const meridional = 8 * (valueNoise(lat + hours / 36, lon, 5, 29) - 0.5);
  return { u: westerly + gust, v: meridional };
}

/**
 * CMEMS-shaped surface current, m/s.
 * The Antarctic Circumpolar Current flows eastward; giant tabular bergs ride
 * it rather than the wind (analysis L6).
 */
export function current(lat: number, lon: number, t: Date | number): { u: number; v: number } {
  const hours = toHours(t);
  const acc = 0.32 * Math.exp(-((lat + 60) ** 2) / 420);
  const eddy = 0.12 * (valueNoise(lat, lon + hours / 96, 6, 31) - 0.5);
  const north = 0.05 * (valueNoise(lat + hours / 120, lon, 6.5, 37) - 0.5);
  return { u: acc + eddy, v: north };
}

/**
 * Free-drift sea-ice velocity. In the Southern Hemisphere ice drifts to the
 * LEFT of the wind at roughly 2% of wind speed, rotating further toward the
 * current as the pack consolidates.
 */
export function iceDrift(
  lat: number,
  lon: number,
  t: Date | number,
): { u: number; v: number } {
  const w = wind(lat, lon, t);
  const c = current(lat, lon, t);
  const sic = seaIceConcentration(lat, lon, t);

  // Rotate the wind vector 28° and scale to ~2% of wind speed.
  // Sign matters: bearing is measured clockwise from north, so turning the
  // drift LEFT of the wind (Southern Hemisphere) needs a POSITIVE rotation in
  // the (east, north) plane. A -28° rotation sends ice to the right, which is
  // the Northern Hemisphere rule.
  const th = 28 * RAD;
  const ct = Math.cos(th);
  const st = Math.sin(th);
  const freeU = (w.u * ct - w.v * st) * 0.022;
  const freeV = (w.u * st + w.v * ct) * 0.022;

  // Consolidated pack is steered by the ocean, not the air.
  const wOcean = Math.min(1, sic * 1.15);
  return {
    u: freeU * (1 - wOcean) + c.u * wOcean,
    v: freeV * (1 - wOcean) + c.v * wOcean,
  };
}

/** Convenience bundle used by the drift integrator. */
export function forcingAt(lat: number, lon: number, t: Date | number) {
  const sic = seaIceConcentration(lat, lon, t);
  const thicknessM = iceThicknessM(lat, lon, t);
  return {
    lat,
    lon,
    sic,
    thicknessM,
    regime: classifyRegime({ sic, thicknessM }),
    wind: wind(lat, lon, t),
    current: current(lat, lon, t),
    ice: iceDrift(lat, lon, t),
  };
}

/**
 * Unresolved mesoscale structure — eddies and fronts finer than the forcing
 * grid. This is the *systematic, learnable* part of drift-model error.
 *
 * `cellDeg` controls the spatial scale. Truth uses a fine grid; the residual
 * basis uses a coarse one, so the residual can learn the large-scale
 * recurring structure but can never reproduce the fine detail or the random
 * walk. That asymmetry is what makes the measured skill honest rather than
 * circular: some error is genuinely irreducible.
 */
export function mesoscaleBiasField(
  lat: number,
  lon: number,
  tDays: number,
  cellDeg = 3,
): { u: number; v: number } {
  return {
    u: (valueNoise(lat, lon + tDays * 0.35, cellDeg, 901) - 0.5) * 2,
    v: (valueNoise(lat + tDays * 0.35, lon, cellDeg, 902) - 0.5) * 2,
  };
}

/**
 * Spatially-averaged mesoscale bias.
 *
 * Deliberately an *average* of `mesoscaleBiasField` over a box, not a second
 * noise call at a coarser lattice: a different `cellDeg` would draw different
 * hash values and produce an independent random field with no correlation to
 * the truth. Averaging keeps the low-pass component, which is exactly the
 * part a residual model can legitimately learn.
 */
export function smoothedMesoscaleBias(
  lat: number,
  lon: number,
  tDays: number,
  spanDeg = 6,
  samples = 3,
): { u: number; v: number } {
  let u = 0;
  let v = 0;
  let n = 0;
  const half = spanDeg / 2;
  for (let i = 0; i < samples; i++) {
    for (let j = 0; j < samples; j++) {
      const dLat = -half + (spanDeg * i) / (samples - 1);
      const dLon = -half + (spanDeg * j) / (samples - 1);
      const b = mesoscaleBiasField(lat + dLat, lon + dLon, tDays, 1.5);
      u += b.u;
      v += b.v;
      n++;
    }
  }
  return { u: u / n, v: v / n };
}

/**
 * Climatological drift bias: the large-scale, slowly-varying, recurring part
 * of drift-model error. This is the component a residual network can
 * legitimately learn from historical tracks.
 *
 * Time evolves at 1/20th the rate of the mesoscale field, so it behaves like
 * a quasi-persistent regional bias rather than weather.
 */
export function climatologicalBias(
  lat: number,
  lon: number,
  tDays: number,
): { u: number; v: number } {
  return {
    u: (valueNoise(lat, lon + tDays * 0.05, 12, 1101) - 0.5) * 2,
    v: (valueNoise(lat + tDays * 0.05, lon, 12, 1102) - 0.5) * 2,
  };
}
