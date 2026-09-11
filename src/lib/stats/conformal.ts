/**
 * Conformal prediction. Analysis §3 + L3 + L11:
 *
 *   "A statistical wrapper that turns any model into a set with a promised
 *    coverage, e.g. 90% of true positions should fall inside."
 *   "No advice without a conformal cone. The badge uses the cone, not the
 *    centre line."
 *   "Softmax 0.99 is not 99% true."
 *
 * Split conformal: calibrate on held-out geodesic errors from the replay
 * harness, take the ⌈(n+1)(1−α)⌉/n quantile of the nonconformity scores, and
 * use it as the cone radius. The ensemble spread widens the cone when the
 * members disagree, but can never shrink it below the calibrated radius —
 * that is what makes the 90% claim honest rather than pretty.
 */

import { destination, bearingDeg, geodesicKm, type LatLng } from "@/lib/geo/geodesic";

export const DEFAULT_COVERAGE = 0.9;

/**
 * Finite-sample split-conformal quantile. Returns the radius that, on the
 * calibration set, contains at least `coverage` of true positions.
 * Scores are geodesic kilometres (L4), never degrees.
 */
export function conformalQuantile(scores: number[], coverage = DEFAULT_COVERAGE): number {
  if (scores.length === 0) return Number.POSITIVE_INFINITY;
  const sorted = [...scores].sort((a, b) => a - b);
  const n = sorted.length;
  const level = Math.ceil((n + 1) * coverage) / n;
  const idx = Math.min(n - 1, Math.max(0, Math.ceil(level * n) - 1));
  return sorted[idx];
}

/** Empirical coverage of a fixed radius on a calibration set. */
export function empiricalCoverage(scores: number[], radiusKm: number): number {
  if (scores.length === 0) return 0;
  const inside = scores.filter((s) => s <= radiusKm).length;
  return inside / scores.length;
}

/**
 * Calibration curve for the admin view (L11): observed coverage vs nominal
 * coverage across a sweep of radii. A calibrated model tracks the diagonal.
 */
export function calibrationCurve(
  scores: number[],
  nominals = [0.5, 0.6, 0.7, 0.8, 0.9, 0.95],
): { nominal: number; radiusKm: number; observed: number }[] {
  return nominals.map((nominal) => {
    const radiusKm = conformalQuantile(scores, nominal);
    return {
      nominal,
      radiusKm,
      observed: empiricalCoverage(scores, radiusKm),
    };
  });
}

export interface ConeSlice {
  t: number;
  /** Cross-track semi-axis, km. */
  crossKm: number;
  /** Along-track semi-axis, km. */
  alongKm: number;
  left: LatLng;
  right: LatLng;
  center: LatLng;
}

export interface UncertaintyCone {
  coverage: number;
  /** Calibrated floor radius at the final horizon, km. */
  calibratedRadiusKm: number;
  slices: ConeSlice[];
  /** Closed polygon for rendering: left chain out, right chain back. */
  polygon: LatLng[];
}

export interface ConeInputPoint {
  t: number;
  lat: number;
  lon: number;
}

/**
 * Build the cone around a centre-line path.
 *
 * @param path            centre line, hourly
 * @param spreadKm        per-hour ensemble σ (km)
 * @param calibratedKm    per-hour conformal radius (km), the honest floor
 * @param alongFactor     along-track elongation; tracks are more certain
 *                        across than along when the forcing is steady
 */
export function buildCone(
  path: ConeInputPoint[],
  spreadKm: number[],
  calibratedKm: number[],
  coverage = DEFAULT_COVERAGE,
  alongFactor = 0.55,
): UncertaintyCone {
  if (path.length < 2) {
    throw new Error("cone needs at least two path points");
  }

  const slices: ConeSlice[] = path.map((p, i) => {
    const next = path[Math.min(path.length - 1, i + 1)];
    const prev = path[Math.max(0, i - 1)];
    const bearing =
      i === path.length - 1
        ? bearingDeg(prev, p)
        : bearingDeg(p, next);

    // Conformal radius is the floor; ensemble spread can widen but not shrink.
    const spread = spreadKm[i] ?? 0;
    const calib = calibratedKm[i] ?? 0;
    const crossKm = Math.max(calib, 1.96 * spread, 1.5);
    const alongKm = crossKm * alongFactor;

    return {
      t: p.t,
      crossKm,
      alongKm,
      center: { lat: p.lat, lon: p.lon },
      left: destination(p, (bearing + 270) % 360, crossKm),
      right: destination(p, (bearing + 90) % 360, crossKm),
    };
  });

  const polygon: LatLng[] = [
    ...slices.map((s) => s.left),
    ...slices
      .map((s) => s.right)
      .reverse(),
  ];

  return {
    coverage,
    calibratedRadiusKm: calibratedKm[calibratedKm.length - 1] ?? 0,
    slices,
    polygon,
  };
}

/**
 * Distance in km from a point to the cone boundary, negative when the point
 * is inside the cone. Used by the route scorer: the badge tests the cone,
 * not the centre line.
 *
 * Slices are located by their own `t` value rather than by array position, so
 * this is correct for 3-hourly or irregular paths too.
 */
export function distanceToConeKm(pt: LatLng, cone: UncertaintyCone, t: number): number {
  let idx = 0;
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < cone.slices.length; i++) {
    const d = Math.abs(cone.slices[i].t - t);
    if (d < best) {
      best = d;
      idx = i;
    }
  }
  const s = cone.slices[idx];
  return geodesicKm(pt, s.center) - s.crossKm;
}
