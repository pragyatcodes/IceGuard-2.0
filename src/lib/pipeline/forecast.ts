/**
 * The forecast service — the "brain" the dashboard talks to (analysis §6.2).
 *
 * Pipeline, per analysis §4.4:
 *   drift (physics + residual, ensemble) → cone (conformal) → route score
 *   (GO/SLOW/NO-GO) → explain (force tags, one sentence)
 */

import {
  buildEnsemble,
  ensembleSpreadKm,
  integrateTrajectory,
  type Trajectory,
  type TrajectoryPoint,
} from "@/lib/physics/drift";
import {
  buildCone,
  conformalQuantile,
  empiricalCoverage,
  type UncertaintyCone,
} from "@/lib/stats/conformal";
import {
  scoreRoute,
  thresholdsForHull,
  type HullClass,
  type Light,
  type RouteScore,
  type ScoringThresholds,
} from "@/lib/scoring/route-scorer";
import { calibrationScores, replaySummary } from "@/lib/pipeline/replay";
import { forcingAt } from "@/lib/fields/forcing";
import { seaIceConcentration, iceThicknessM } from "@/lib/fields/forcing";
import {
  geodesicKm,
  kmToNm,
  type LatLng,
} from "@/lib/geo/geodesic";
import type { SizeClass } from "@/lib/physics/force-balance";

export const ENSEMBLE_MEMBERS = 24;
export const COVERAGE = 0.9;

export interface BergRecord {
  id: string;
  bergId: string;
  displayName: string;
  sizeClass: SizeClass;
  lat: number;
  lon: number;
  u: number;
  v: number;
  areaKm2: number;
  keelDepthM: number;
}

export interface VoyageRecord {
  id: string;
  code: string;
  name: string;
  vessel: string;
  hullClass: HullClass;
  corridor: LatLng[];
  speedKt: number;
  bufferNm: number;
  departAt: Date;
}

export interface ForecastResult {
  bergId: string;
  issuedAt: string;
  horizonHours: number;
  /** Ensemble mean centre line — displayed, but never used for the badge. */
  centre: TrajectoryPoint[];
  /** Raw member tracks, for the "show your work" view. */
  members: { lat: number; lon: number }[][];
  cone: UncertaintyCone;
  spread: { t: number; sigmaKm: number }[];
  calibration: {
    n: number;
    radiusKm: number;
    observedCoverage: number;
    nominalCoverage: number;
  };
  forces: { wind: number; current: number; ice: number };
  regime: "OPEN" | "DRAG" | "LOCK";
  distanceKm72: number;
  speedKt: number;
  headingDeg: number;
}

export function generateForecast(
  berg: BergRecord,
  issueAt: Date,
  horizonHours = 72,
  members = ENSEMBLE_MEMBERS,
): ForecastResult {
  const start = { lat: berg.lat, lon: berg.lon, u: berg.u, v: berg.v };

  const ens: Trajectory[] = buildEnsemble(
    { start, issueAt, sizeClass: berg.sizeClass, horizonHours, useResidual: true },
    members,
    undefined,
    // Deterministic per berg so a replay of the same case is byte-identical.
    hashSeed(berg.bergId),
  );

  const hours = ens[0].points.map((p) => p.t);

  // Ensemble mean centre line.
  const centre: TrajectoryPoint[] = hours.map((t, i) => {
    const lat = ens.reduce((a, m) => a + m.points[i].lat, 0) / ens.length;
    const lon = ens.reduce((a, m) => a + m.points[i].lon, 0) / ens.length;
    const u = ens.reduce((a, m) => a + m.points[i].u, 0) / ens.length;
    const v = ens.reduce((a, m) => a + m.points[i].v, 0) / ens.length;
    const f = forcingAt(lat, lon, ens[0].points[i].epochSec);
    const last = ens[0].points[i];
    return {
      ...last,
      lat,
      lon,
      u,
      v,
      sic: f.sic,
      thicknessM: f.thicknessM,
      regime: f.regime,
      forces: {
        wind: ens.reduce((a, m) => a + m.points[i].forces.wind, 0) / ens.length,
        current: ens.reduce((a, m) => a + m.points[i].forces.current, 0) / ens.length,
        ice: ens.reduce((a, m) => a + m.points[i].forces.ice, 0) / ens.length,
      },
    };
  });

  const spreadAll = ensembleSpreadKm(ens);
  const spread = spreadAll.map((s) => ({ t: s.t, sigmaKm: s.sigmaKm }));

  // Conformal calibration on held-out replay errors, per horizon.
  const calibrated: number[] = hours.map((h) => {
    const scores = calibrationScores(Math.min(72, Math.max(24, h)));
    const base = conformalQuantile(scores, COVERAGE);
    // Scale the 24/48/72 h reference radius smoothly across the horizon.
    const anchor = h <= 24 ? 24 : h <= 48 ? 48 : 72;
    return base * Math.sqrt(Math.max(h, 1) / anchor);
  });

  const cone = buildCone(
    centre.map((p) => ({ t: p.t, lat: p.lat, lon: p.lon })),
    spread.map((s) => s.sigmaKm),
    calibrated,
    COVERAGE,
  );

  const lastScores = calibrationScores(horizonHours);
  const radiusKm = conformalQuantile(lastScores, COVERAGE);

  const finalPoint = centre[centre.length - 1];

  return {
    bergId: berg.bergId,
    issuedAt: issueAt.toISOString(),
    horizonHours,
    centre,
    members: ens.map((m) => m.points.map((p) => ({ lat: p.lat, lon: p.lon }))),
    cone,
    spread,
    calibration: {
      n: lastScores.length,
      radiusKm,
      observedCoverage: empiricalCoverage(lastScores, radiusKm),
      nominalCoverage: COVERAGE,
    },
    forces: finalPoint.forces,
    regime: finalPoint.regime,
    distanceKm72: finalPoint.distanceKm,
    speedKt: finalPoint.speedKt,
    headingDeg: finalPoint.headingDeg,
  };
}

export interface VoyageVerdict {
  score: RouteScore;
  forecasts: ForecastResult[];
  voyage: VoyageRecord;
  dataAgeH: number;
  modelConfidence: number;
  modelVersion: string;
}

export interface DataHealth {
  code: string;
  name: string;
  category: string;
  status: "GREEN" | "AMBER" | "RED";
  ageH: number;
  note: string;
}

/**
 * Feed health. Ages are synthesised deterministically from the clock so the
 * console always shows a coherent picture, including at least one degraded
 * feed — because L8 (stale data) is a real failure mode the UI must handle.
 */
export function dataHealth(now: Date = new Date()): DataHealth[] {
  const h = now.getUTCHours();
  const feeds: { code: string; name: string; category: string; ageH: number; note: string }[] = [
    { code: "SENTINEL1", name: "Sentinel-1 GRD", category: "SAR", ageH: 6 + (h % 5), note: "Ascending pass over the sector" },
    { code: "AMSR2", name: "AMSR2 SIC", category: "ICE", ageH: 9 + (h % 7), note: "Daily composite" },
    { code: "NSIDC", name: "NSIDC Sea Ice Index", category: "ICE", ageH: 14 + (h % 9), note: "Daily extent record" },
    { code: "ERA5", name: "ERA5 wind", category: "WIND", ageH: 5 + (h % 4), note: "Hourly surface wind" },
    { code: "CMEMS", name: "CMEMS current", category: "CURRENT", ageH: 11 + (h % 6), note: "Daily surface current" },
    { code: "MOSDAC", name: "MOSDAC mirror", category: "SHIP", ageH: 31 + (h % 12), note: "Indian gateway mirror — lagging" },
  ];

  return feeds.map((f) => ({
    ...f,
    status: f.ageH > 24 ? "RED" : f.ageH > 18 ? "AMBER" : "GREEN",
  }));
}

export function sarAgeH(now: Date = new Date()): number {
  return dataHealth(now).find((f) => f.code === "SENTINEL1")!.ageH;
}

/**
 * Model confidence. Derived from the replay skill and the calibration set
 * size rather than a softmax — L11 warns that softmax 0.99 is not 99% true.
 */
export function modelConfidence(): { value: number; version: string } {
  const r = replaySummary();
  const scores = calibrationScores(72);
  const mae72 = r.maeKm.model.h72;
  // Confidence falls as 72 h error grows and as the calibration set shrinks.
  const skillTerm = Math.max(0, 1 - mae72 / 25);
  const dataTerm = Math.min(1, scores.length / 60);
  return {
    value: Math.max(0, Math.min(0.99, 0.45 * skillTerm + 0.55 * dataTerm)),
    version: r.targets ? "iceguard-drift-v1.2.0" : "iceguard-drift-v1.2.0",
  };
}

export interface ScoreVoyageOptions {
  thresholds?: ScoringThresholds;
  now?: Date;
}

/** Full pipeline for one voyage: forecast every berg, then score the corridor. */
export function scoreVoyage(
  voyage: VoyageRecord,
  bergs: BergRecord[],
  opts: ScoreVoyageOptions = {},
): VoyageVerdict {
  const now = opts.now ?? voyage.departAt;
  const ageH = sarAgeH(now);
  const conf = modelConfidence();

  const forecasts = bergs.map((b) => generateForecast(b, now, 72));

  const score = scoreRoute({
    corridor: voyage.corridor,
    speedKt: voyage.speedKt,
    departAt: voyage.departAt,
    bufferNm: voyage.bufferNm,
    hullClass: voyage.hullClass,
    bergs: forecasts.map((f) => ({
      bergId: f.bergId,
      displayName: f.bergId,
      path: f.centre,
      cone: { slices: f.cone.slices, coverage: f.cone.coverage },
    })),
    iceAt: (lat, lon, epochSec) => ({
      sic: seaIceConcentration(lat, lon, epochSec),
      thicknessM: iceThicknessM(lat, lon, epochSec),
    }),
    dataAgeH: ageH,
    modelConfidence: conf.value,
    thresholds: opts.thresholds ?? thresholdsForHull(voyage.hullClass),
  });

  return {
    score,
    forecasts,
    voyage,
    dataAgeH: ageH,
    modelConfidence: conf.value,
    modelVersion: conf.version,
  };
}

/** Deterministic integer seed from a berg ID. */
export function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export const LIGHT_META: Record<Light, { label: string; action: string }> = {
  GO: { label: "GO", action: "Proceed on plan. Recheck at next SAR pass." },
  SLOW: { label: "SLOW", action: "Reduce speed, widen lookout, consider a detour." },
  NO_GO: { label: "NO-GO", action: "Hold or reroute." },
};

export { geodesicKm, kmToNm, thresholdsForHull };
