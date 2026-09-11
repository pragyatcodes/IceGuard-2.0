import { describe, expect, it } from "vitest";
import {
  geodesicKm,
  bearingDeg,
  destination,
  pointToSegmentKm,
  interpolatePolyline,
  polylineLengthKm,
  kmToNm,
  nmToKm,
} from "@/lib/geo/geodesic";

describe("geodesicKm", () => {
  it("returns 0 for identical points", () => {
    expect(geodesicKm({ lat: -70, lon: 20 }, { lat: -70, lon: 20 })).toBeCloseTo(0, 6);
  });

  it("measures one degree of latitude as ~111.2 km", () => {
    const d = geodesicKm({ lat: -70, lon: 0 }, { lat: -69, lon: 0 });
    expect(d).toBeGreaterThan(110.5);
    expect(d).toBeLessThan(111.8);
  });

  it("shrinks longitude degrees toward the pole (L4)", () => {
    const at60 = geodesicKm({ lat: -60, lon: 0 }, { lat: -60, lon: 1 });
    const at75 = geodesicKm({ lat: -75, lon: 0 }, { lat: -75, lon: 1 });
    expect(at60).toBeCloseTo(55.6, 0);
    expect(at75).toBeCloseTo(28.8, 0);
    expect(at75).toBeLessThan(at60 * 0.6);
  });

  it("is symmetric", () => {
    const a = { lat: -68.4, lon: 12.1 };
    const b = { lat: -71.9, lon: 18.7 };
    expect(geodesicKm(a, b)).toBeCloseTo(geodesicKm(b, a), 9);
  });
});

describe("bearingDeg", () => {
  it("reports due north as ~0", () => {
    expect(bearingDeg({ lat: -70, lon: 0 }, { lat: -69, lon: 0 })).toBeCloseTo(0, 5);
  });
  it("reports due east as ~90", () => {
    expect(bearingDeg({ lat: -70, lon: 0 }, { lat: -70, lon: 1 })).toBeCloseTo(90, 0);
  });
});

describe("destination", () => {
  it("round-trips a northward leg", () => {
    const from = { lat: -70, lon: 20 };
    const to = destination(from, 0, 100);
    expect(geodesicKm(from, to)).toBeCloseTo(100, 5);
    expect(to.lat).toBeGreaterThan(from.lat);
    expect(to.lon).toBeCloseTo(20, 6);
  });

  it("wraps over the south pole and reflects latitude", () => {
    // 2000 km due south from -80S passes the pole and comes back the other side.
    const to = destination({ lat: -80, lon: 0 }, 180, 2000);
    expect(to.lat).toBeLessThan(0);
    expect(to.lat).toBeGreaterThan(-90);
    expect(Math.abs(to.lon)).toBeCloseTo(180, 0);
  });
});

describe("pointToSegmentKm", () => {
  it("is ~0 for a point on the segment", () => {
    const d = pointToSegmentKm({ lat: -70, lon: 0.5 }, { lat: -70, lon: 0 }, { lat: -70, lon: 1 });
    expect(d).toBeLessThan(1);
  });

  it("measures perpendicular offset", () => {
    const d = pointToSegmentKm({ lat: -69.9, lon: 0.5 }, { lat: -70, lon: 0 }, { lat: -70, lon: 1 });
    expect(d).toBeGreaterThan(10);
    expect(d).toBeLessThan(12);
  });

  it("clamps beyond the segment ends", () => {
    const d = pointToSegmentKm({ lat: -70, lon: 5 }, { lat: -70, lon: 0 }, { lat: -70, lon: 1 });
    expect(d).toBeCloseTo(geodesicKm({ lat: -70, lon: 5 }, { lat: -70, lon: 1 }), 0);
  });
});

describe("interpolatePolyline", () => {
  const line = [
    { lat: -70, lon: 0 },
    { lat: -70, lon: 1 },
    { lat: -70, lon: 2 },
  ];

  it("returns endpoints at 0 and 1", () => {
    expect(interpolatePolyline(line, 0)).toEqual(line[0]);
    expect(interpolatePolyline(line, 1).lon).toBeCloseTo(2, 6);
  });

  it("returns the midpoint at 0.5 by arc length", () => {
    const mid = interpolatePolyline(line, 0.5);
    expect(mid.lon).toBeCloseTo(1, 4);
  });

  it("clamps out-of-range fractions", () => {
    expect(interpolatePolyline(line, 5).lon).toBeCloseTo(2, 6);
  });

  it("reports total length matching the sum of legs", () => {
    const total = polylineLengthKm(line);
    const legs = geodesicKm(line[0], line[1]) + geodesicKm(line[1], line[2]);
    expect(total).toBeCloseTo(legs, 6);
  });
});

describe("unit conversion", () => {
  it("converts nm and km consistently", () => {
    expect(nmToKm(1)).toBeCloseTo(1.852, 6);
    expect(kmToNm(nmToKm(37.4))).toBeCloseTo(37.4, 6);
  });
});
