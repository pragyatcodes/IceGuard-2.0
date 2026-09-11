import { describe, expect, it } from "vitest";
import {
  seaIceConcentration,
  iceThicknessM,
  wind,
  current,
  iceDrift,
  seasonalIce,
  valueNoise,
  mesoscaleBiasField,
  climatologicalBias,
} from "@/lib/fields/forcing";
import { classifyRegime } from "@/lib/physics/regimes";
import { toDate, toHours } from "@/lib/fields/forcing";

const JAN = new Date(Date.UTC(2026, 0, 18, 6));
const SEP = new Date(Date.UTC(2026, 8, 15));

describe("seasonalIce", () => {
  it("is minimal in February and maximal in September", () => {
    expect(seasonalIce(45)).toBeLessThan(0.05); // mid-Feb minimum
    expect(seasonalIce(228)).toBeGreaterThan(0.99); // late-Aug maximum
    expect(seasonalIce(255)).toBeGreaterThan(0.94); // still near max in Sep
  });
});

describe("sea-ice geography", () => {
  it("puts the Scotia Sea in open water at the summer minimum", () => {
    // A23a's actual location in January 2026. A field that says otherwise is
    // not Antarctica.
    const sic = seaIceConcentration(-59.4, -33.2, JAN);
    expect(sic).toBeLessThan(0.3);
  });

  it("keeps consolidated pack in the Weddell and Amundsen seas", () => {
    expect(seaIceConcentration(-74.6, -38.2, JAN)).toBeGreaterThan(0.95);
    expect(seaIceConcentration(-73.1, -102.5, JAN)).toBeGreaterThan(0.95);
  });

  it("is ice-free at Cape Town and in the open Southern Ocean", () => {
    // A sigmoid plus the floe-noise term never returns an exact 0, so assert
    // "operationally ice-free": well under the 15% ice-edge definition.
    expect(seaIceConcentration(-33.9, 18.4, JAN)).toBeLessThan(1e-3);
    expect(seaIceConcentration(-50.0, 60.0, JAN)).toBeLessThan(1e-3);
  });

  it("advances far northward at the September maximum", () => {
    // The Scotia Sea is ice-covered in austral winter.
    expect(seaIceConcentration(-59.4, -33.2, SEP)).toBeGreaterThan(0.7);
  });

  it("stays inside [0,1] across the domain", () => {
    for (let lat = -85; lat <= -45; lat += 2.5) {
      for (let lon = -180; lon <= 180; lon += 15) {
        for (const t of [JAN, SEP]) {
          const s = seaIceConcentration(lat, lon, t);
          expect(s).toBeGreaterThanOrEqual(0);
          expect(s).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});

describe("ice thickness and lock", () => {
  it("is zero in open water", () => {
    expect(iceThicknessM(-50, 60, JAN)).toBe(0);
  });

  it("thickens deeper inside the pack", () => {
    const marginal = iceThicknessM(-66.4, 47.2, JAN);
    const deep = iceThicknessM(-74.6, -38.2, JAN);
    expect(deep).toBeGreaterThan(marginal);
  });

  it("locks the Weddell pack but leaves the marginal Enderby pack in drag", () => {
    const weddell = { sic: seaIceConcentration(-74.6, -38.2, JAN), thicknessM: iceThicknessM(-74.6, -38.2, JAN) };
    const enderby = { sic: seaIceConcentration(-66.4, 47.2, JAN), thicknessM: iceThicknessM(-66.4, 47.2, JAN) };
    expect(classifyRegime(weddell)).toBe("LOCK");
    expect(classifyRegime(enderby)).toBe("DRAG");
  });
});

describe("wind and current", () => {
  it("gives westerly flow in the Southern Ocean", () => {
    // "Westerlies" are winds FROM the west, so their eastward (u) component
    // is positive.
    const w = wind(-58, 0, JAN);
    expect(w.u).toBeGreaterThan(0);
  });

  it("gives an eastward Antarctic Circumpolar Current", () => {
    const c = current(-60, 0, JAN);
    expect(c.u).toBeGreaterThan(0);
  });

  it("drifts ice to the LEFT of the wind in the Southern Hemisphere", () => {
    // At low SIC the ice free-drifts at ~2% of wind, rotated leftward.
    const w = wind(-52, 10, JAN);
    const d = iceDrift(-52, 10, JAN);
    const windBearing = (Math.atan2(w.u, w.v) * 180) / Math.PI;
    const iceBearing = (Math.atan2(d.u, d.v) * 180) / Math.PI;
    let delta = (iceBearing - windBearing + 540) % 360 - 180;
    expect(delta).toBeLessThan(0); // left of the wind
    expect(delta).toBeGreaterThan(-70);
  });

  it("keeps ice drift far slower than the wind", () => {
    const w = wind(-52, 10, JAN);
    const d = iceDrift(-52, 10, JAN);
    expect(Math.hypot(d.u, d.v)).toBeLessThan(Math.hypot(w.u, w.v) * 0.1);
  });
});

describe("time convention (Date vs epoch seconds must agree)", () => {
  const asDate = new Date(Date.UTC(2026, 0, 18, 6));
  const asSeconds = asDate.getTime() / 1000;

  it("toDate and toHours agree on both input forms", () => {
    expect(toDate(asSeconds).getTime()).toBe(asDate.getTime());
    expect(toHours(asSeconds)).toBeCloseTo(toHours(asDate), 9);
  });

  it("seaIceConcentration is identical for Date and epoch seconds", () => {
    for (const [lat, lon] of [[-59.4, -33.2], [-66.4, 47.2], [-74.6, -38.2]]) {
      expect(seaIceConcentration(lat, lon, asSeconds)).toBeCloseTo(
        seaIceConcentration(lat, lon, asDate), 12);
    }
  });

  it("iceThicknessM is identical for Date and epoch seconds", () => {
    for (const [lat, lon] of [[-66.4, 47.2], [-74.6, -38.2]]) {
      expect(iceThicknessM(lat, lon, asSeconds)).toBeCloseTo(
        iceThicknessM(lat, lon, asDate), 12);
    }
  });

  it("wind and current are identical for Date and epoch seconds", () => {
    const wd = wind(-60, 0, asDate);
    const ws = wind(-60, 0, asSeconds);
    expect(ws.u).toBeCloseTo(wd.u, 12);
    expect(ws.v).toBeCloseTo(wd.v, 12);
    const cd = current(-60, 0, asDate);
    const cs = current(-60, 0, asSeconds);
    expect(cs.u).toBeCloseTo(cd.u, 12);
    expect(cs.v).toBeCloseTo(cd.v, 12);
  });

  it("varies smoothly in space — no open-water/solid-pack jumps over 100 km", () => {
    // The signature of the unit bug: SIC oscillating violently along a route.
    let worst = 0;
    for (let i = 0; i < 60; i++) {
      const a = seaIceConcentration(-58 - i * 0.2, 66 + i * 0.17, asSeconds);
      const b = seaIceConcentration(-58 - (i + 1) * 0.2, 66 + (i + 1) * 0.17, asSeconds);
      worst = Math.max(worst, Math.abs(a - b));
    }
    // ~25 km steps; concentration should not swing more than ~0.35 per step.
    expect(worst).toBeLessThan(0.35);
  });
});

describe("noise and bias fields", () => {
  it("valueNoise stays in [0,1) and is deterministic", () => {
    for (let i = 0; i < 200; i++) {
      const n = valueNoise(-60 + i * 0.1, i * 3.7, 2, i % 5);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(1);
    }
    expect(valueNoise(-66.4, 47.2, 3, 7)).toBe(valueNoise(-66.4, 47.2, 3, 7));
  });

  it("bias fields are bounded in [-1,1]", () => {
    for (let i = 0; i < 100; i++) {
      const m = mesoscaleBiasField(-65 + i * 0.1, i * 5, i / 24, 1.2);
      const c = climatologicalBias(-65 + i * 0.1, i * 5, i / 24);
      expect(Math.abs(m.u)).toBeLessThanOrEqual(1);
      expect(Math.abs(m.v)).toBeLessThanOrEqual(1);
      expect(Math.abs(c.u)).toBeLessThanOrEqual(1);
      expect(Math.abs(c.v)).toBeLessThanOrEqual(1);
    }
  });
});
