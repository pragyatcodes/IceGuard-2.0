/**
 * Trajectory integration + ensemble.
 *
 * Analysis §4.4 step 5: "For each berg, integrate the force-balance for 24,
 * 48, 72 hours using forecast wind/current. Apply lock/drag/open. Add ML
 * residual. Spawn an ensemble (slightly perturbed winds and coefficients)."
 */

import {
  COEFFICIENTS,
  rk4Step,
  speedKt,
  headingDeg,
  type BergState,
  type DriftCoefficients,
  type Forcing,
  type SizeClass,
  type Vec2,
} from "@/lib/physics/force-balance";
import { forcingAt as fieldForcingAt } from "@/lib/fields/forcing";
import type { Regime } from "@/lib/physics/regimes";

/** Forcing plus the regime label, which the raw force-balance type omits. */
export type ForcingWithRegime = Forcing & { regime: Regime };
import {
  makeResidualCorrector,
  DEFAULT_RESIDUAL_MODEL,
  type ResidualModel,
} from "@/lib/physics/residual";

export const DT_SEC = 1800; // 30-minute integrator step
export const HORIZONS_H = [24, 48, 72] as const;
export type Horizon = (typeof HORIZONS_H)[number];

export interface TrajectoryPoint {
  /** Hours since forecast issue. */
  t: number;
  epochSec: number;
  lat: number;
  lon: number;
  u: number;
  v: number;
  speedKt: number;
  headingDeg: number;
  sic: number;
  thicknessM: number;
  regime: "OPEN" | "DRAG" | "LOCK";
  /** Cumulative distance travelled from the origin, km. */
  distanceKm: number;
  forces: { wind: number; current: number; ice: number };
}

export interface Trajectory {
  member: number;
  points: TrajectoryPoint[];
}

export interface DriftRequest {
  start: BergState;
  issueAt: Date;
  sizeClass: SizeClass;
  horizonHours?: number;
  /** 0 = physics-only baseline; 1 = physics + learned residual. */
  useResidual?: boolean;
  residualModel?: ResidualModel;
  coefficients?: DriftCoefficients;
  /** Member-specific multiplicative perturbations. */
  perturb?: { wind?: number; current?: number; kWater?: number; kAir?: number };
}

/** mulberry32 — small deterministic PRNG so ensembles replay exactly. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const M_PER_DEG = 111320;

function forceBreakdown(state: BergState, f: Forcing, c: DriftCoefficients) {
  const wU = f.wind.u - state.u;
  const wV = f.wind.v - state.v;
  const wMag = Math.hypot(wU, wV);
  const cU = f.current.u - state.u;
  const cV = f.current.v - state.v;
  const cMag = Math.hypot(cU, cV);

  const wind = c.kAir * wMag * wMag;
  const current = c.kWater * cMag * cMag;
  const ice = Math.abs(c.kIce * Math.hypot(f.ice.u - state.u, f.ice.v - state.v));
  const total = wind + current + ice || 1;
  return {
    wind: wind / total,
    current: current / total,
    ice: ice / total,
  };
}

export function integrateTrajectory(req: DriftRequest): Trajectory {
  const horizonHours = req.horizonHours ?? 72;
  const coeffs = { ...(req.coefficients ?? COEFFICIENTS[req.sizeClass]) };
  const p = req.perturb ?? {};
  if (p.kWater !== undefined) coeffs.kWater *= p.kWater;
  if (p.kAir !== undefined) coeffs.kAir *= p.kAir;

  const windScale = p.wind ?? 1;
  const currentScale = p.current ?? 1;

  const corrector =
    req.useResidual === false
      ? null
      : makeResidualCorrector(req.residualModel ?? DEFAULT_RESIDUAL_MODEL);

  const issueSec = req.issueAt.getTime() / 1000;

  const forcingAt = (lat: number, lon: number, tSec: number): ForcingWithRegime => {
    const base = fieldForcingAt(lat, lon, tSec);
    return {
      ...base,
      wind: { u: base.wind.u * windScale, v: base.wind.v * windScale } as Vec2,
      current: { u: base.current.u * currentScale, v: base.current.v * currentScale } as Vec2,
    };
  };

  let state: BergState = { ...req.start };
  const origin = { lat: state.lat, lon: state.lon };
  const points: TrajectoryPoint[] = [];

  const stepsPerHour = 3600 / DT_SEC;
  const totalSteps = horizonHours * stepsPerHour;
  let distanceM = 0;

  for (let step = 0; step <= totalSteps; step++) {
    const tSec = issueSec + step * DT_SEC;
    const f = forcingAt(state.lat, state.lon, tSec);

    if (step % stepsPerHour === 0) {
      const t = step / stepsPerHour;
      const dLatM = (state.lat - origin.lat) * M_PER_DEG;
      const dLonM =
        (state.lon - origin.lon) *
        M_PER_DEG *
        Math.cos((state.lat * Math.PI) / 180);

      // In LOCK the berg velocity IS the ice velocity, by definition. Snap the
      // reported velocity on the sample where the regime flips, otherwise the
      // first locked sample still carries the pre-lock free-drift velocity and
      // contradicts its own regime label.
      const locked = f.regime === "LOCK";
      const u = locked ? f.ice.u : state.u;
      const v = locked ? f.ice.v : state.v;

      points.push({
        t,
        epochSec: tSec,
        lat: state.lat,
        lon: state.lon,
        u,
        v,
        speedKt: speedKt(u, v),
        headingDeg: headingDeg(u, v),
        sic: f.sic,
        thicknessM: f.thicknessM,
        regime: f.regime,
        distanceKm: Math.hypot(dLatM, dLonM) / 1000,
        forces: forceBreakdown({ ...state, u, v }, f, coeffs),
      });
    }

    if (step === totalSteps) break;

    let next = rk4Step(state, DT_SEC, coeffs, forcingAt, tSec);

    // Learned residual, applied as a velocity bias on the position increment
    // and OUTSIDE the force balance so drag cannot damp it away. Skipped in
    // ice-lock, where the pack — not the model — decides the motion (L5).
    if (corrector) {
      const fNext = forcingAt(next.lat, next.lon, tSec + DT_SEC);
      if (fNext.regime !== "LOCK") {
        // ABSOLUTE epoch seconds: the climatological basis is indexed by
        // day-of-record, matching the forcing fields and the replay truth.
        const rv = corrector(next, fNext, tSec + DT_SEC);
        const cosLat = Math.max(0.05, Math.cos((next.lat * Math.PI) / 180));
        next = {
          ...next,
          lat: next.lat + (rv.v * DT_SEC) / M_PER_DEG,
          lon: next.lon + (rv.u * DT_SEC) / (M_PER_DEG * cosLat),
        };
      }
    }

    distanceM +=
      Math.hypot(
        (next.lat - state.lat) * M_PER_DEG,
        (next.lon - state.lon) *
          M_PER_DEG *
          Math.cos((next.lat * Math.PI) / 180),
      );
    state = next;
  }

  return { member: 0, points };
}

export interface EnsemblePerturbations {
  windSigma: number;
  currentSigma: number;
  kWaterSigma: number;
  kAirSigma: number;
}

export const DEFAULT_PERTURB: EnsemblePerturbations = {
  windSigma: 0.1,
  currentSigma: 0.08,
  kWaterSigma: 0.15,
  kAirSigma: 0.2,
};

/**
 * Ensemble of `members` perturbed integrations. The spread across members is
 * what the conformal cone is calibrated against — the cone is never drawn
 * from the centre line alone (L3).
 */
export function buildEnsemble(
  req: Omit<DriftRequest, "perturb">,
  members = 24,
  perturb: EnsemblePerturbations = DEFAULT_PERTURB,
  seed = 1337,
): Trajectory[] {
  const rand = mulberry32(seed);
  const gauss = () => {
    // Box–Muller
    const u1 = Math.max(1e-9, rand());
    const u2 = rand();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  };

  const out: Trajectory[] = [];
  for (let m = 0; m < members; m++) {
    const traj = integrateTrajectory({
      ...req,
      perturb: {
        wind: 1 + perturb.windSigma * gauss(),
        current: 1 + perturb.currentSigma * gauss(),
        kWater: Math.max(0.2, 1 + perturb.kWaterSigma * gauss()),
        kAir: Math.max(0.1, 1 + perturb.kAirSigma * gauss()),
      },
    });
    // Defensive: a single diverged member would otherwise poison the ensemble
    // mean and blow the conformal cone out to 1e30 km. rk4Step substeps to
    // stay stable, but a DSS should never emit a cone built on a NaN.
    const finite = traj.points.every(
      (p) => Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90,
    );
    if (finite) out.push({ ...traj, member: m });
  }

  if (out.length === 0) {
    throw new Error("every ensemble member diverged; refusing to publish a forecast");
  }
  return out;
}

/** Member-wise spread in km at each hour. */
export function ensembleSpreadKm(ens: Trajectory[]): { t: number; sigmaKm: number; centroid: { lat: number; lon: number } }[] {
  const hours = ens[0]?.points.map((p) => p.t) ?? [];
  return hours.map((t, i) => {
    const lats = ens.map((m) => m.points[i].lat);
    const lons = ens.map((m) => m.points[i].lon);
    const meanLat = lats.reduce((a, b) => a + b, 0) / lats.length;
    const meanLon = lons.reduce((a, b) => a + b, 0) / lons.length;
    const M_PER_DEG2 = 111320;
    const cosLat = Math.cos((meanLat * Math.PI) / 180);
    let ss = 0;
    for (let k = 0; k < lats.length; k++) {
      const dy = (lats[k] - meanLat) * M_PER_DEG2;
      const dx = (lons[k] - meanLon) * M_PER_DEG2 * cosLat;
      ss += dx * dx + dy * dy;
    }
    return {
      t,
      sigmaKm: Math.sqrt(ss / lats.length) / 1000,
      centroid: { lat: meanLat, lon: meanLon },
    };
  });
}
