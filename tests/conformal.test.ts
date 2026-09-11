import { describe, expect, it } from "vitest";
import {
  buildCone,
  calibrationCurve,
  conformalQuantile,
  distanceToConeKm,
  empiricalCoverage,
  DEFAULT_COVERAGE,
} from "@/lib/stats/conformal";

describe("conformalQuantile", () => {
  it("returns the finite-sample split-conformal radius", () => {
    const scores = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100
    // ceil((100+1)*0.9)/100 = 0.909 -> ceil(0.909*100)-1 = 90 -> scores[90] = 91
    expect(conformalQuantile(scores, 0.9)).toBe(91);
  });

  it("is monotonically increasing in coverage", () => {
    const scores = Array.from({ length: 500 }, (_, i) => (i * 37) % 500);
    const qs = [0.5, 0.7, 0.8, 0.9, 0.95].map((c) => conformalQuantile(scores, c));
    for (let i = 1; i < qs.length; i++) expect(qs[i]).toBeGreaterThanOrEqual(qs[i - 1]);
  });

  it("achieves at least the nominal coverage on the calibration set", () => {
    const scores = Array.from({ length: 200 }, (_, i) => (i * 53) % 200);
    const r = conformalQuantile(scores, DEFAULT_COVERAGE);
    expect(empiricalCoverage(scores, r)).toBeGreaterThanOrEqual(0.9 - 1e-9);
  });

  it("is infinite with no calibration data (never a false GO)", () => {
    expect(conformalQuantile([], 0.9)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("calibrationCurve", () => {
  it("returns a point per nominal level", () => {
    const scores = Array.from({ length: 100 }, (_, i) => i);
    const curve = calibrationCurve(scores);
    expect(curve).toHaveLength(6);
    for (const p of curve) {
      expect(p.observed).toBeGreaterThanOrEqual(p.nominal - 0.02);
    }
  });
});

describe("buildCone", () => {
  const path = Array.from({ length: 25 }, (_, i) => ({
    t: i * 3,
    lat: -68 + i * 0.05,
    lon: 25 + i * 0.02,
  }));

  it("throws on a degenerate path (L3: never a bare line)", () => {
    expect(() => buildCone([path[0]], [1], [1])).toThrow();
  });

  it("produces one slice per path point and a closed polygon", () => {
    const cone = buildCone(
      path,
      path.map((_, i) => 2 + i * 0.6),
      path.map((_, i) => 5 + i * 1.2),
    );
    expect(cone.slices).toHaveLength(path.length);
    expect(cone.polygon).toHaveLength(path.length * 2);
  });

  it("never lets ensemble spread shrink the cone below the calibrated floor", () => {
    const calibrated = path.map(() => 40);
    const tiny = path.map(() => 0.1);
    const cone = buildCone(path, tiny, calibrated);
    for (const s of cone.slices) {
      expect(s.crossKm).toBeGreaterThanOrEqual(40);
    }
  });

  it("widens with ensemble disagreement", () => {
    const small = buildCone(path, path.map(() => 1), path.map(() => 0));
    const large = buildCone(path, path.map(() => 60), path.map(() => 0));
    expect(large.slices[10].crossKm).toBeGreaterThan(small.slices[10].crossKm);
  });

  it("reports a negative distance for a point inside the cone", () => {
    const cone = buildCone(path, path.map(() => 1), path.map(() => 30));
    const center = cone.slices[12].center;
    expect(distanceToConeKm(center, cone, 36)).toBeLessThan(0);
    expect(distanceToConeKm({ lat: center.lat + 3, lon: center.lon + 3 }, cone, 36)).toBeGreaterThan(0);
  });
});
