/**
 * Force-balance drift physics for Antarctic icebergs.
 *
 *   m · a = F_air + F_water + F_Coriolis + F_slope + F_ice
 *
 * stepped forward with RK4 (analysis §3 "Force-balance / drift physics").
 *
 * Two Antarctic-specific points from the analysis are load-bearing here:
 *
 *  L6 — the Arctic "2% of wind" rule must NOT be applied to giant tabular
 *       bergs. The per-class drag coefficients below are calibrated so a
 *       GIANT berg responds to the ocean current at ~0.07% of wind speed,
 *       while a SMALL berg responds at ~2.6%. See drift.test.ts.
 *
 *  L5 — a berg inside dense pack is not a free particle. The ice force is
 *       coupled continuously through ω (couplingWeight) and hard-locks the
 *       berg to the ice velocity at ω = 1.
 *
 * The effective coefficients are calibrated against observed berg speeds, not
 * derived from first principles — keel shape and small-scale currents are
 * never known perfectly (analysis §4.3). They are exposed as data so an admin
 * can retune them from a replay without touching this file.
 */

import {
  classifyRegime,
  couplingWeight,
  type Regime,
} from "@/lib/physics/regimes";

export const OMEGA = 7.2921159e-5; // Earth's angular velocity, rad/s
export const G = 9.80665;

export type SizeClass = "GIANT" | "LARGE" | "MEDIUM" | "SMALL";

export interface DriftCoefficients {
  /** Air-drag acceleration coefficient, 1/m. */
  kAir: number;
  /** Water-drag acceleration coefficient, 1/m. */
  kWater: number;
  /** Ice-relaxation rate, 1/s. */
  kIce: number;
  /** Sea-surface slope acceleration magnitude, m/s². */
  slopeAccel: number;
  /** Slope bearing, degrees clockwise from north. */
  slopeBearingDeg: number;
}

/**
 * Calibrated per-class coefficients.
 * τ_water = 1 / (2 · kWater · |current|) is the response time to the ocean;
 * the wind offset is √(kAir·|W|² / kWater). Tuned so that:
 *   GIANT  τ ≈ 12 h, wind ≈ 0.07% of wind speed   (current-dominated, L6)
 *   SMALL  τ ≈ 0.5 h, wind ≈ 2.6% of wind speed   (wind-sensitive)
 */
export const COEFFICIENTS: Record<SizeClass, DriftCoefficients> = {
  GIANT: { kAir: 4.0e-11, kWater: 8.0e-5, kIce: 1.0e-4, slopeAccel: 1.2e-5, slopeBearingDeg: 78 },
  LARGE: { kAir: 1.0e-9, kWater: 1.5e-4, kIce: 1.4e-4, slopeAccel: 1.2e-5, slopeBearingDeg: 78 },
  MEDIUM: { kAir: 2.5e-7, kWater: 8.0e-4, kIce: 2.0e-4, slopeAccel: 1.0e-5, slopeBearingDeg: 82 },
  SMALL: { kAir: 1.4e-6, kWater: 2.0e-3, kIce: 3.0e-4, slopeAccel: 6.0e-6, slopeBearingDeg: 85 },
};

export interface Vec2 {
  u: number;
  v: number;
}

export interface BergState {
  lat: number;
  lon: number;
  u: number; // eastward, m/s
  v: number; // northward, m/s
}

export interface Forcing {
  sic: number;
  thicknessM: number;
  wind: Vec2;
  current: Vec2;
  ice: Vec2;
}

/** Coriolis parameter; negative in the Southern Hemisphere. */
export function coriolisF(latDeg: number): number {
  return 2 * OMEGA * Math.sin((latDeg * Math.PI) / 180);
}

/** Per-unit-mass accelerations, decomposed so the UI can show force tags. */
export function accelerations(
  state: BergState,
  forcing: Forcing,
  c: DriftCoefficients,
): {
  air: Vec2;
  water: Vec2;
  coriolis: Vec2;
  slope: Vec2;
  ice: Vec2;
  total: Vec2;
  regime: Regime;
  omega: number;
} {
  const regime = classifyRegime({ sic: forcing.sic, thicknessM: forcing.thicknessM });
  const omega = couplingWeight({ sic: forcing.sic, thicknessM: forcing.thicknessM });

  // Air drag acts on the wind vector relative to the berg.
  const wU = forcing.wind.u - state.u;
  const wV = forcing.wind.v - state.v;
  const wMag = Math.hypot(wU, wV);
  const air = { u: c.kAir * wMag * wU, v: c.kAir * wMag * wV };

  // Water drag acts on the current vector relative to the berg.
  const cU = forcing.current.u - state.u;
  const cV = forcing.current.v - state.v;
  const cMag = Math.hypot(cU, cV);
  const water = { u: c.kWater * cMag * cU, v: c.kWater * cMag * cV };

  // Coriolis: a = f · (v, -u) for velocity (u, v).
  const f = coriolisF(state.lat);
  const coriolis = { u: f * state.v, v: -f * state.u };

  // Sea-surface slope: a = g · ∇η along a bearing.
  const th = ((c.slopeBearingDeg - 90) * Math.PI) / 180;
  const slope = { u: c.slopeAccel * Math.cos(th), v: c.slopeAccel * Math.sin(th) };

  // Sea-ice force: relax toward the ice-drift velocity, weighted by ω.
  const ice = {
    u: omega * c.kIce * (forcing.ice.u - state.u),
    v: omega * c.kIce * (forcing.ice.v - state.v),
  };

  return {
    air,
    water,
    coriolis,
    slope,
    ice,
    total: {
      u: air.u + water.u + coriolis.u + slope.u + ice.u,
      v: air.v + water.v + coriolis.v + slope.v + ice.v,
    },
    regime,
    omega,
  };
}

const M_PER_DEG = 111320;

function degPerSecond(u: number, v: number, lat: number): { dLat: number; dLon: number } {
  const cosLat = Math.max(0.05, Math.cos((lat * Math.PI) / 180));
  return { dLat: v / M_PER_DEG, dLon: u / (M_PER_DEG * cosLat) };
}

/**
 * Local stiffness of the drag terms, in 1/s.
 *
 * The quadratic drag linearises to dv/dt ≈ -λv with λ = k·|relative flow|.
 * RK4 is only stable while λ·dt < ~2.78, so this drives the substepping below.
 * Small bergs with a perturbed kWater routinely exceed that on a 30-minute
 * step and diverge to nonsense latitudes if it is ignored.
 */
export function dragStiffness(
  state: BergState,
  forcing: Forcing,
  c: DriftCoefficients,
  omega: number,
): number {
  const relWater =
    Math.hypot(forcing.current.u - state.u, forcing.current.v - state.v) +
    Math.hypot(state.u, state.v);
  const water = c.kWater * relWater;
  const ice = omega * c.kIce;
  return Math.max(water, ice);
}

/**
 * One RK4 step of the coupled state over `dt` seconds, internally subdivided
 * so the drag terms stay inside RK4's stability region.
 *
 * Pure physics only — the learned residual is deliberately NOT applied here.
 * A learned correction expressed as an acceleration gets damped to almost
 * nothing by water drag and ice relaxation; it is applied as a velocity bias
 * on the position increment in `integrateTrajectory` instead.
 */
export function rk4Step(
  s0: BergState,
  dt: number,
  c: DriftCoefficients,
  forcingAt: (lat: number, lon: number, tSec: number) => Forcing,
  tSec: number,
): BergState {
  const f0 = forcingAt(s0.lat, s0.lon, tSec);
  const omega0 = couplingWeight({ sic: f0.sic, thicknessM: f0.thicknessM });
  const lambda = dragStiffness(s0, f0, c, omega0);

  // Safety factor well inside the RK4 limit of ~2.78.
  const n = Math.max(1, Math.min(64, Math.ceil((lambda * dt) / 1.8)));
  const h = dt / n;

  let s = s0;
  for (let i = 0; i < n; i++) {
    s = rk4Substep(s, h, c, forcingAt, tSec + i * h);
    if (!Number.isFinite(s.lat) || !Number.isFinite(s.lon)) break;
  }
  return s;
}

function rk4Substep(
  s0: BergState,
  dt: number,
  c: DriftCoefficients,
  forcingAt: (lat: number, lon: number, tSec: number) => Forcing,
  tSec: number,
): BergState {
  const deriv = (s: BergState, t: number) => {
    const f = forcingAt(s.lat, s.lon, t);
    const acc = accelerations(s, f, c);
    // In full ice-lock the berg IS the ice: no free dynamics.
    if (acc.regime === "LOCK") {
      const d = degPerSecond(f.ice.u, f.ice.v, s.lat);
      return { dLat: d.dLat, dLon: d.dLon, du: 0, dv: 0, lockU: f.ice.u, lockV: f.ice.v };
    }
    const d = degPerSecond(s.u, s.v, s.lat);
    return { dLat: d.dLat, dLon: d.dLon, du: acc.total.u, dv: acc.total.v };
  };

  const k1 = deriv(s0, tSec);
  const s1: BergState = {
    lat: s0.lat + (k1.dLat * dt) / 2,
    lon: s0.lon + (k1.dLon * dt) / 2,
    u: s0.u + (k1.du * dt) / 2,
    v: s0.v + (k1.dv * dt) / 2,
  };
  const k2 = deriv(s1, tSec + dt / 2);
  const s2: BergState = {
    lat: s0.lat + (k2.dLat * dt) / 2,
    lon: s0.lon + (k2.dLon * dt) / 2,
    u: s0.u + (k2.du * dt) / 2,
    v: s0.v + (k2.dv * dt) / 2,
  };
  const k3 = deriv(s2, tSec + dt / 2);
  const s3: BergState = {
    lat: s0.lat + k3.dLat * dt,
    lon: s0.lon + k3.dLon * dt,
    u: s0.u + k3.du * dt,
    v: s0.v + k3.dv * dt,
  };
  const k4 = deriv(s3, tSec + dt);

  let lat = s0.lat + (dt / 6) * (k1.dLat + 2 * k2.dLat + 2 * k3.dLat + k4.dLat);
  let lon = s0.lon + (dt / 6) * (k1.dLon + 2 * k2.dLon + 2 * k3.dLon + k4.dLon);
  let u = s0.u + (dt / 6) * (k1.du + 2 * k2.du + 2 * k3.du + k4.du);
  let v = s0.v + (dt / 6) * (k1.dv + 2 * k2.dv + 2 * k3.dv + k4.dv);

  // Lock snap: if the final sample is in LOCK, adopt ice velocity exactly.
  const fEnd = forcingAt(lat, lon, tSec + dt);
  const endRegime = classifyRegime({ sic: fEnd.sic, thicknessM: fEnd.thicknessM });
  if (endRegime === "LOCK") {
    u = fEnd.ice.u;
    v = fEnd.ice.v;
  }

  if (lat > 90) {
    lat = 180 - lat;
    lon += 180;
  } else if (lat < -90) {
    lat = -180 - lat;
    lon += 180;
  }
  lon = ((lon + 540) % 360) - 180;

  return { lat, lon, u, v };
}

/** Speed in knots. */
export function speedKt(u: number, v: number): number {
  return (Math.hypot(u, v) * 3600) / 1852;
}

/** Compass heading of travel, degrees clockwise from north. */
export function headingDeg(u: number, v: number): number {
  return ((Math.atan2(u, v) * 180) / Math.PI + 360) % 360;
}
