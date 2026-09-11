/**
 * The three ice–berg regimes. Analysis §3 + L5:
 *   OPEN  SIC <  15%   ice force ≈ 0, berg is a free particle
 *   DRAG  15%–90%      ice pushes and drags the berg
 *   LOCK  SIC ≥ 90%    dense pack traps the berg; berg velocity = ice velocity
 *
 * Thresholds come from Lichey & Hellmer (2001) and later regime papers.
 * A generic LSTM tracker has no concept of this transition, which is the
 * scientific mistake ICEGUARD exists to avoid (L2).
 */

export type Regime = "OPEN" | "DRAG" | "LOCK";

export const SIC_ICE_EDGE = 0.15; // conventional ice-edge definition
export const SIC_LOCK = 0.9; // lock onset, if the ice is also strong enough

/**
 * Ice strength proxy. Concentration alone is not enough: thin young ice at
 * 95% does not trap a giant berg. We require concentration AND a minimum
 * mean thickness to enter LOCK.
 */
export interface IceState {
  sic: number; // 0..1
  thicknessM: number;
}

export function classifyRegime(ice: IceState, minLockThicknessM = 0.8): Regime {
  if (ice.sic >= SIC_LOCK && ice.thicknessM >= minLockThicknessM) return "LOCK";
  if (ice.sic >= SIC_ICE_EDGE) return "DRAG";
  return "OPEN";
}

/**
 * Continuous coupling weight ω ∈ [0,1] between free drift (0) and full
 * ice-lock (1). A hard switch would make the integrator discontinuous and
 * the ensemble cone would jitter; a smooth ramp over the drag band keeps the
 * physics differentiable while still snapping to LOCK at the top.
 */
export function couplingWeight(ice: IceState, minLockThicknessM = 0.8): number {
  if (classifyRegime(ice, minLockThicknessM) === "LOCK") return 1;
  if (ice.sic <= SIC_ICE_EDGE) return 0;
  const c = (ice.sic - SIC_ICE_EDGE) / (SIC_LOCK - SIC_ICE_EDGE);
  return Math.max(0, Math.min(1, c));
}

export const REGIME_META: Record<
  Regime,
  { label: string; blurb: string; tone: "cyan" | "amber" | "violet" }
> = {
  OPEN: {
    label: "Open water",
    blurb: "SIC below the ice edge. Berg is a free particle: ocean current dominates.",
    tone: "cyan",
  },
  DRAG: {
    label: "Drag zone",
    blurb: "Pack is pushing and dragging the berg. Motion is a blend of water and ice.",
    tone: "amber",
  },
  LOCK: {
    label: "Ice-lock",
    blurb: "Dense pack has captured the berg. It drifts with the ice field, not on its own.",
    tone: "violet",
  },
};
