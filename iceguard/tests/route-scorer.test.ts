import { describe, expect, it } from "vitest";
import {
  DEFAULT_THRESHOLDS,
  scoreRoute,
  thresholdsForHull,
  dominantForce,
  type ScoredBerg,
} from "@/lib/scoring/route-scorer";
import { buildCone } from "@/lib/stats/conformal";
import type { LatLng } from "@/lib/geo/geodesic";

const corridor: LatLng[] = [
  { lat: -62.0, lon: 55.0 },
  { lat: -66.0, lon: 58.0 },
  { lat: -69.0, lon: 60.0 },
];

const departAt = new Date(Date.UTC(2026, 0, 15, 0, 0, 0));

function bergOnRoute(id = "C-23"): ScoredBerg {
  // A berg parked exactly on the corridor at ~T+24h.
  const path = Array.from({ length: 73 }, (_, h) => ({
    t: h,
    lat: -64.0 - h * 0.02,
    lon: 56.5 + h * 0.015,
    regime: "DRAG",
    forces: { wind: 0.1, current: 0.75, ice: 0.15 },
    sic: 0.4,
  }));
  const cone = buildCone(
    path,
    path.map((_, i) => 1 + i * 0.4),
    path.map((_, i) => 4 + i * 1.1),
  );
  return { bergId: id, displayName: id, path, cone };
}

function bergFarAway(id = "B-49"): ScoredBerg {
  const path = Array.from({ length: 73 }, (_, h) => ({
    t: h,
    lat: -50.0 - h * 0.001,
    lon: -30.0,
    regime: "OPEN",
    forces: { wind: 0.1, current: 0.8, ice: 0.1 },
    sic: 0.02,
  }));
  const cone = buildCone(
    path,
    path.map((_, i) => 1 + i * 0.4),
    path.map((_, i) => 4 + i * 1.1),
  );
  return { bergId: id, displayName: id, path, cone };
}

const iceAt = (lat: number, lon: number, epochSec: number) => {
  // Thin ice along the test corridor so the berg, not the pack, drives verdicts.
  const d = new Date(epochSec * 1000);
  const season = 0.5 - 0.5 * Math.cos(((15 / 365.25) * 2 * Math.PI));
  void d;
  void season;
  const sic = Math.max(0, Math.min(1, 0.12 + (-60 - lat) * 0.012));
  return { sic, thicknessM: sic * 0.4 };
};

const base = {
  corridor,
  speedKt: 12,
  departAt,
  bufferNm: 3,
  hullClass: "ICE_CLASS_1C" as const,
  dataAgeH: 4,
  modelConfidence: 0.92,
  iceAt,
};

describe("dominantForce", () => {
  it("picks the largest component", () => {
    expect(dominantForce({ wind: 0.7, current: 0.2, ice: 0.1 })).toBe("wind");
    expect(dominantForce({ wind: 0.1, current: 0.8, ice: 0.1 })).toBe("current");
    expect(dominantForce({ wind: 0.1, current: 0.2, ice: 0.7 })).toBe("ice");
  });
});

describe("thresholdsForHull", () => {
  it("loosens ice limits for an ice-class hull and tightens them for a non-ice hull", () => {
    const a = thresholdsForHull("ICE_CLASS_1A");
    const n = thresholdsForHull("NON_ICE");
    expect(a.iceBlockingSic).toBeGreaterThan(DEFAULT_THRESHOLDS.iceBlockingSic);
    expect(n.iceBlockingSic).toBeLessThan(DEFAULT_THRESHOLDS.iceBlockingSic);
    expect(n.standoffKm).toBeGreaterThan(a.standoffKm);
  });
});

describe("scoreRoute — the traffic light", () => {
  it("returns GO when every cone stays outside the hull buffer", () => {
    const res = scoreRoute({ ...base, bergs: [bergFarAway()] });
    expect(res.light).toBe("GO");
    expect(res.hazards).toHaveLength(0);
    expect(res.reason).toMatch(/outside the .* hull buffer/);
  });

  it("returns NO-GO when a cone crosses the hull envelope (L3)", () => {
    const res = scoreRoute({ ...base, bergs: [bergOnRoute()] });
    expect(res.light).toBe("NO_GO");
    expect(res.hazards.some((h) => h.kind === "CONE_HULL")).toBe(true);
    expect(res.timeToHazardH).not.toBeNull();
    // The reason must name the berg and the force, not just the colour.
    expect(res.reason).toContain("C-23");
    expect(res.reason).toMatch(/ocean current|wind|pack-ice/);
  });

  it("returns SLOW on low model confidence floor breach -> NO-GO instead", () => {
    const res = scoreRoute({ ...base, bergs: [bergFarAway()], modelConfidence: 0.2 });
    expect(res.light).toBe("NO_GO");
    expect(res.reason).toMatch(/confidence/i);
  });

  it("L8: stale SAR data caps a GO at SLOW and flags it degraded", () => {
    const fresh = scoreRoute({ ...base, bergs: [bergFarAway()], dataAgeH: 4 });
    const stale = scoreRoute({ ...base, bergs: [bergFarAway()], dataAgeH: 52 });
    expect(fresh.light).toBe("GO");
    expect(stale.light).toBe("SLOW");
    expect(stale.degraded).toBe(true);
    expect(stale.cappedByStaleData).toBe(true);
    expect(stale.reason).toMatch(/stale radar/i);
  });

  it("L8: stale data never upgrades a NO-GO", () => {
    const res = scoreRoute({ ...base, bergs: [bergOnRoute()], dataAgeH: 99 });
    expect(res.light).toBe("NO_GO");
  });

  it("SLOW when consolidated pack blocks the corridor", () => {
    const blocked = (lat: number) => ({
      sic: lat < -66 ? 0.96 : 0.05,
      thicknessM: 1.6, // thick enough for a 1C hull to be stopped
    });
    const res = scoreRoute({
      ...base,
      bergs: [bergFarAway()],
      iceAt: (lat, _lon, _t) => blocked(lat),
    });
    expect(res.light).toBe("NO_GO");
    expect(res.maxIceOnRoute).toBeGreaterThanOrEqual(0.9);
    expect(res.reason).toMatch(/blocks the corridor/i);
  });

  it("SLOW on moderate ice even with clear cones", () => {
    const res = scoreRoute({
      ...base,
      bergs: [bergFarAway()],
      iceAt: (lat) => ({ sic: lat < -65 ? 0.55 : 0.1, thicknessM: 0.5 }),
    });
    expect(res.light).toBe("SLOW");
    expect(res.reason).toMatch(/Moderate ice/i);
  });

  it("does NOT block on concentration alone — thickness decides", () => {
    // 100% concentration pack that is only 0.8 m thick: an ice-class hull
    // transits this. Blocking here would make every station unreachable.
    const res = scoreRoute({
      ...base,
      bergs: [bergFarAway()],
      hullClass: "ICE_CLASS_1A",
      iceAt: () => ({ sic: 1.0, thicknessM: 0.8 }),
    });
    expect(res.maxIceOnRoute).toBe(1.0);
    expect(res.reason).not.toMatch(/blocks the corridor/i);
    expect(res.light).not.toBe("NO_GO");
  });

  it("emits a per-hour sample for the whole horizon", () => {
    const res = scoreRoute({ ...base, bergs: [bergFarAway()], horizonHours: 72 });
    expect(res.perHour).toHaveLength(73);
    expect(res.perHour[0].h).toBe(0);
    expect(res.perHour[72].h).toBe(72);
  });

  it("an ice-class hull tolerates ice that stops a non-ice hull", () => {
    const ice = (lat: number) => ({ sic: lat < -66 ? 0.8 : 0.05, thicknessM: 0.9 });
    const nonIce = scoreRoute({
      ...base,
      bergs: [bergFarAway()],
      hullClass: "NON_ICE",
      iceAt: (lat) => ice(lat),
    });
    const iceClass = scoreRoute({
      ...base,
      bergs: [bergFarAway()],
      hullClass: "ICE_CLASS_1A",
      iceAt: (lat) => ice(lat),
    });
    expect(nonIce.light).toBe("NO_GO");
    expect(iceClass.light).not.toBe("NO_GO");
  });
});
