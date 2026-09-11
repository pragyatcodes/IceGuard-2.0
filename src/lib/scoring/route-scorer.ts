/**
 * Route scoring → GO / SLOW / NO-GO. Analysis §4.5.
 *
 *   GO     90% cone stays outside the ship buffer; ice along route below a
 *          configurable threshold.
 *   SLOW   Cone grazes the buffer, or ice is moderate, or data is older than
 *          a set age.
 *   NO-GO  Cone intersects the hull envelope, or lock-zone ice blocks the
 *          corridor, or model confidence is below a floor.
 *
 * Two rules are hard-wired because the analysis names them as failure modes:
 *
 *  L8  — if SAR age exceeds the threshold the badge CANNOT be GO. Maximum
 *        SLOW, and the response is flagged `degraded`.
 *  L3  — the test is cone-vs-hull, never centre-line-vs-hull.
 *
 * Every verdict carries a human sentence and the force tags that produced it,
 * because "the UI must show why, not just the colour".
 */

import {
  geodesicKm,
  interpolatePolyline,
  nmToKm,
  polylineLengthKm,
  type LatLng,
} from "@/lib/geo/geodesic";
import type { UncertaintyCone } from "@/lib/stats/conformal";

export type Light = "GO" | "SLOW" | "NO_GO";

export type HullClass = "ICE_CLASS_1A" | "ICE_CLASS_1C" | "NON_ICE";

export interface ScoringThresholds {
  /** SIC at/above which ice on the corridor may force NO-GO. */
  iceBlockingSic: number;
  /**
   * Ice thickness (m) that must accompany that concentration before the
   * corridor is actually blocked. Concentration alone is the wrong test: an
   * ice-class hull transits 100% concentration pack routinely — what stops it
   * is thick, deformed ice. Requiring both keeps "lock-zone ice blocks the
   * corridor" a statement about ice the ship cannot break.
   */
  iceBlockingThicknessM: number;
  /** SIC at/above which ice on the corridor forces at least SLOW. */
  iceModerateSic: number;
  /** Data older than this (hours) caps the badge at SLOW (L8). */
  maxDataAgeH: number;
  /** Model confidence below this floors the badge at NO-GO. */
  confidenceFloor: number;
  /** Extra standoff beyond the hull buffer, km. */
  standoffKm: number;
}

export const DEFAULT_THRESHOLDS: ScoringThresholds = {
  iceBlockingSic: 0.9,
  iceBlockingThicknessM: 1.0,
  iceModerateSic: 0.3,
  maxDataAgeH: 24,
  confidenceFloor: 0.5,
  standoffKm: 3,
};

/**
 * Hull class relaxes or tightens the ice thresholds. Analysis §4.5:
 * "NCPOR can tighten them for a thin-hulled ship and loosen them for an
 * ice-class hull."
 */
export function thresholdsForHull(
  hull: HullClass,
  base: ScoringThresholds = DEFAULT_THRESHOLDS,
): ScoringThresholds {
  switch (hull) {
    case "ICE_CLASS_1A":
      return {
        ...base,
        iceBlockingSic: 0.97,
        iceBlockingThicknessM: 1.5,
        iceModerateSic: 0.45,
        standoffKm: 2,
      };
    case "ICE_CLASS_1C":
      return {
        ...base,
        iceBlockingSic: 0.93,
        iceBlockingThicknessM: 1.0,
        iceModerateSic: 0.35,
        standoffKm: 3,
      };
    case "NON_ICE":
    default:
      return {
        ...base,
        iceBlockingSic: 0.6,
        iceBlockingThicknessM: 0.3,
        iceModerateSic: 0.2,
        standoffKm: 6,
      };
  }
}

export interface ScoredBerg {
  bergId: string;
  displayName: string;
  path: { t: number; lat: number; lon: number; regime: string; forces: { wind: number; current: number; ice: number }; sic: number }[];
  cone: Pick<UncertaintyCone, "slices" | "coverage">;
}

export interface RouteScoreRequest {
  corridor: LatLng[];
  speedKt: number;
  departAt: Date;
  bufferNm: number;
  hullClass: HullClass;
  bergs: ScoredBerg[];
  iceAt: (lat: number, lon: number, epochSec: number) => { sic: number; thicknessM: number };
  dataAgeH: number;
  modelConfidence: number;
  horizonHours?: number;
  thresholds?: ScoringThresholds;
}

export interface HourSample {
  h: number;
  ship: LatLng;
  sic: number;
  thicknessM: number;
  /** Minimum cone-boundary clearance across all bergs, km. Negative = inside a cone. */
  clearanceKm: number;
  worstBerg: string | null;
  worstRegime: string | null;
}

export interface Hazard {
  h: number;
  bergId: string;
  displayName: string;
  clearanceKm: number;
  regime: string;
  dominantForce: "wind" | "current" | "ice";
  kind: "CONE_HULL" | "CONE_GRAZE";
}

export interface RouteScore {
  light: Light;
  reason: string;
  /** Actionable instruction for the duty officer. */
  action: string;
  timeToHazardH: number | null;
  minClearanceKm: number;
  maxIceOnRoute: number;
  degraded: boolean;
  /** True when the verdict would have been GO but L8 capped it. */
  cappedByStaleData: boolean;
  confidence: number;
  coverage: number;
  hazards: Hazard[];
  perHour: HourSample[];
  thresholds: ScoringThresholds;
}

const FORCE_LABEL: Record<"wind" | "current" | "ice", string> = {
  wind: "wind",
  current: "ocean current",
  ice: "pack-ice stress",
};

export function dominantForce(f: { wind: number; current: number; ice: number }) {
  if (f.ice >= f.current && f.ice >= f.wind) return "ice" as const;
  if (f.current >= f.wind) return "current" as const;
  return "wind" as const;
}

export function scoreRoute(req: RouteScoreRequest): RouteScore {
  const thresholds = req.thresholds ?? thresholdsForHull(req.hullClass);
  const horizon = req.horizonHours ?? 72;
  const bufferKm = nmToKm(req.bufferNm) + thresholds.standoffKm;
  const corridorKm = polylineLengthKm(req.corridor);
  const perHour: HourSample[] = [];
  const hazards: Hazard[] = [];

  let minClearanceKm = Number.POSITIVE_INFINITY;
  let maxIceOnRoute = 0;
  let blockingIceH: number | null = null;
  let moderateIceH: number | null = null;

  const kmPerHour = req.speedKt * 1.852;

  for (let h = 0; h <= horizon; h++) {
    const travelledKm = kmPerHour * h;
    const fraction = corridorKm === 0 ? 0 : Math.min(1, travelledKm / corridorKm);
    const ship = interpolatePolyline(req.corridor, fraction);
    const epochSec = req.departAt.getTime() / 1000 + h * 3600;
    const ice = req.iceAt(ship.lat, ship.lon, epochSec);

    if (ice.sic > maxIceOnRoute) maxIceOnRoute = ice.sic;
    if (
      ice.sic >= thresholds.iceBlockingSic &&
      ice.thicknessM >= thresholds.iceBlockingThicknessM &&
      blockingIceH === null
    ) {
      blockingIceH = h;
    }
    if (ice.sic >= thresholds.iceModerateSic && moderateIceH === null) moderateIceH = h;

    let clearanceKm = Number.POSITIVE_INFINITY;
    let worstBerg: string | null = null;
    let worstRegime: string | null = null;

    for (const berg of req.bergs) {
      const i = Math.max(0, Math.min(berg.path.length - 1, h));
      const p = berg.path[i];
      const slice = berg.cone.slices[i];
      if (!slice) continue;

      const coneClearance = geodesicKm(ship, slice.center) - slice.crossKm;
      if (coneClearance < clearanceKm) {
        clearanceKm = coneClearance;
        worstBerg = berg.bergId;
        worstRegime = p.regime;

        const d = dominantForce(p.forces);
        if (coneClearance < 0) {
          hazards.push({
            h,
            bergId: berg.bergId,
            displayName: berg.displayName,
            clearanceKm: coneClearance,
            regime: p.regime,
            dominantForce: d,
            kind: "CONE_HULL",
          });
        } else if (coneClearance < bufferKm) {
          hazards.push({
            h,
            bergId: berg.bergId,
            displayName: berg.displayName,
            clearanceKm: coneClearance,
            regime: p.regime,
            dominantForce: d,
            kind: "CONE_GRAZE",
          });
        }
      }
    }

    if (clearanceKm < minClearanceKm) minClearanceKm = clearanceKm;

    perHour.push({
      h,
      ship,
      sic: ice.sic,
      thicknessM: ice.thicknessM,
      clearanceKm: Number.isFinite(clearanceKm) ? clearanceKm : 9999,
      worstBerg,
      worstRegime,
    });
  }

  const hullHits = hazards.filter((x) => x.kind === "CONE_HULL");
  const grazes = hazards.filter((x) => x.kind === "CONE_GRAZE");

  const degraded = req.dataAgeH > thresholds.maxDataAgeH;
  const lowConfidence = req.modelConfidence < thresholds.confidenceFloor;

  let light: Light;
  let reason: string;
  let action: string;
  let cappedByStaleData = false;

  const firstHull = hullHits[0];
  const firstGraze = grazes[0];

  if (lowConfidence) {
    light = "NO_GO";
    reason = `Model confidence ${(req.modelConfidence * 100).toFixed(0)}% is below the ${(thresholds.confidenceFloor * 100).toFixed(0)}% floor for this voyage — the forecast cannot be trusted to plan on.`;
    action = "Hold. Do not sail on this forecast. Re-run after the next SAR pass or freeze a validated model version.";
  } else if (firstHull) {
    light = "NO_GO";
    const forceWord = FORCE_LABEL[firstHull.dominantForce];
    const regimeWord =
      firstHull.regime === "LOCK"
        ? "is ice-locked and riding with the pack"
        : firstHull.regime === "DRAG"
          ? "is being pushed through the drag zone"
          : "is in open water and current-driven";
    const covPct = Math.round((req.bergs[0]?.cone.coverage ?? 0.9) * 100);
    reason = `Berg ${firstHull.displayName} ${regimeWord}. Its ${covPct}% cone crosses the hull envelope at T+${firstHull.h} h; ${forceWord} supplies the forcing.`;
    action = `Hold or reroute. Delay departure past T+${firstHull.h} h, or take an alternate corridor the optimiser suggests.`;
  } else if (blockingIceH !== null) {
    light = "NO_GO";
    reason = `Lock-zone ice (SIC ≥ ${Math.round(thresholds.iceBlockingSic * 100)}%, ${thresholds.iceBlockingThicknessM.toFixed(1)} m thick) blocks the corridor at T+${blockingIceH} h. No berg contact is needed for this to be a no-go.`;
    action = "Hold. The corridor is blocked by consolidated pack; reroute or wait for the ice edge to retreat.";
  } else if (firstGraze) {
    light = "SLOW";
    const forceWord = FORCE_LABEL[firstGraze.dominantForce];
    reason = `Berg ${firstGraze.displayName} cone grazes the ${req.bufferNm.toFixed(1)} nm hull buffer at T+${firstGraze.h} h (clearance ${firstGraze.clearanceKm.toFixed(1)} km). ${forceWord} dominates.`;
    action = "Reduce speed and widen the lookout. Do not treat the centre line as truth — plan against the cone.";
  } else if (moderateIceH !== null) {
    light = "SLOW";
    reason = `Moderate ice (SIC ${Math.round(maxIceOnRoute * 100)}%) is on the corridor from T+${moderateIceH} h. Cones stay clear, but the margin is thin.`;
    action = "Proceed at reduced speed. Recheck at the next SAR pass before committing to the full corridor.";
  } else {
    light = "GO";
    reason = `Every 90% cone stays outside the ${req.bufferNm.toFixed(1)} nm hull buffer for the whole ${horizon} h horizon, and ice along the corridor peaks at ${Math.round(maxIceOnRoute * 100)}% SIC.`;
    action = "Proceed on plan. Recheck at the next SAR pass.";
  }

  // L8: stale data caps the badge. GO becomes SLOW, never the reverse.
  if (degraded && light === "GO") {
    light = "SLOW";
    cappedByStaleData = true;
    reason = `Advice would be GO, but the newest SAR scene is ${req.dataAgeH.toFixed(0)} h old (threshold ${thresholds.maxDataAgeH} h). The badge cannot be GO on stale radar.`;
    action = "Treat as SLOW. Proceed with reduced speed and heightened lookout until a fresh Sentinel-1 pass lands.";
  }

  const timeToHazardH = hullHits[0]?.h ?? grazes[0]?.h ?? blockingIceH;

  return {
    light,
    reason,
    action,
    timeToHazardH,
    minClearanceKm: Number.isFinite(minClearanceKm) ? minClearanceKm : 9999,
    maxIceOnRoute,
    degraded,
    cappedByStaleData,
    confidence: req.modelConfidence,
    coverage: req.bergs[0]?.cone.coverage ?? 0.9,
    hazards,
    perHour,
    thresholds,
  };
}
