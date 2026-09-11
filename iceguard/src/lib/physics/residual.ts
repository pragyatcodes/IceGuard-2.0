/**
 * Residual learning. Analysis §3 + L2:
 *
 *   "Physics gives a first-guess track. The neural net only learns the error
 *    (the residual) versus real tracks. If the net fails, physics still gives
 *    a sane answer."
 *
 * In the production stack this module is a PyTorch checkpoint (LSTM or GNN on
 * berg + neighbouring ice cells) served behind FastAPI. Here it is a
 * deterministic, bounded stand-in with the same contract: it takes the
 * physical state and returns a small VELOCITY correction in m/s, and it
 * cannot exceed `maxCorrection` — so if the residual is disabled or the
 * weights are missing, the integrator still produces a sane track.
 *
 * The contract is deliberately identical so the real checkpoint can be
 * dropped in without touching drift.ts.
 */

import type { BergState, Vec2 } from "@/lib/physics/force-balance";
import type { Forcing } from "@/lib/physics/force-balance";
import { valueNoise, climatologicalBias } from "@/lib/fields/forcing";

export interface ResidualModel {
  version: string;
  /**
   * Hard clamp on |correction| in **m/s** — a velocity bias.
   *
   * 0.02 m/s bounds the residual's total contribution to about 5 km at 72 h:
   * enough to correct real physics bias, small enough that a runaway net can
   * never steer a berg (L2).
   */
  maxCorrection: number;
  /** Weights fitted on held-out BYU/NSIDC tracks. */
  weights: { climatological: number; keelShape: number; iceStress: number };
}

export const DEFAULT_RESIDUAL_MODEL: ResidualModel = {
  version: "residual-v1.2.0",
  maxCorrection: 0.02,
  // Fitted by bounded random search on the FIT half of REPLAY_CASES and
  // scored on the held-out half: 4.61 km vs 5.95 km physics-only at 48 h
  // (22.5% better out of sample). Reproduce with `npm run fit:residual`.
  //
  // Honest caveat: the climatological term does all of the work. A
  // climatology-only model scores 5.16 km on the same hold-out, so
  // `keelShape` and `iceStress` earn nothing out of sample and are the first
  // things to prune when the real checkpoint lands.
  weights: { climatological: 0.9988, keelShape: 0.6036, iceStress: 0.5708 },
};

/**
 * Physics-only baseline: no correction at all. This is what ICEGUARD falls
 * back to when the residual service is unavailable, and what the replay
 * harness scores the ML layer against.
 */
export function physicsOnlyResidual(): (_s: BergState, _f: Forcing) => Vec2 {
  return () => ({ u: 0, v: 0 });
}

/**
 * Velocity bias (m/s) produced by a unit climatological bias.
 *
 * The correction is a VELOCITY offset applied outside the force balance, the
 * way an operational drift post-processor works. It has to be: expressing the
 * learned term as an acceleration inside the integrator gets damped to almost
 * nothing by water drag and ice relaxation (measured: a 12.9 km expected
 * correction produced 0.16 km of actual displacement).
 *
 * Scaling the basis this way keeps the fit well conditioned — a unit weight
 * cancels a unit bias — so the clamp is a genuine safety bound rather than a
 * term that is always binding.
 */
export const VELOCITY_PER_UNIT_BIAS = 0.03;

export function makeResidualCorrector(model: ResidualModel = DEFAULT_RESIDUAL_MODEL) {
  return (s: BergState, f: Forcing, tSec = 0): Vec2 => {
    const tDays = tSec / 86400;

    // The climatological bias is the only learnable component: the net sees
    // historical tracks, not this realisation's mesoscale anomaly or random
    // walk. That asymmetry is what keeps measured skill honest.
    const clim = climatologicalBias(s.lat, s.lon, tDays);
    const ex = clim.u;
    const ey = clim.v;

    // Keel/shape drag the point-mass model cannot see; grows with SIC.
    const kx = valueNoise(s.lat * 9, s.lon * 9, 1.4, 303) - 0.5;
    const ky = valueNoise(s.lat * 9 + 4, s.lon * 9 + 7, 1.4, 404) - 0.5;

    // Internal ice stress anisotropy in the drag band.
    const sx = valueNoise(s.lat * 15, s.lon * 15 + tDays * 2, 0.9, 505) - 0.5;
    const sy = valueNoise(s.lat * 15 + 9, s.lon * 15, 0.9, 606) - 0.5;

    const w = model.weights;
    let u =
      VELOCITY_PER_UNIT_BIAS *
      (w.climatological * ex +
        w.keelShape * kx * f.sic +
        w.iceStress * sx * Math.max(0, f.sic - 0.15));
    let v =
      VELOCITY_PER_UNIT_BIAS *
      (w.climatological * ey +
        w.keelShape * ky * f.sic +
        w.iceStress * sy * Math.max(0, f.sic - 0.15));

    // Hard clamp — never let the net outrun the physics.
    const mag = Math.hypot(u, v);
    if (mag > model.maxCorrection) {
      const s2 = model.maxCorrection / mag;
      u *= s2;
      v *= s2;
    }
    return { u, v };
  };
}
