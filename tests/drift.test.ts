import { describe, expect, it } from "vitest";
import {
  accelerations,
  coriolisF,
  rk4Step,
  COEFFICIENTS,
  headingDeg,
  speedKt,
  type BergState,
  type Forcing,
} from "@/lib/physics/force-balance";
import {
  buildEnsemble,
  ensembleSpreadKm,
  integrateTrajectory,
  mulberry32,
} from "@/lib/physics/drift";
import { physicsOnlyResidual, makeResidualCorrector, DEFAULT_RESIDUAL_MODEL } from "@/lib/physics/residual";
import { iceDrift } from "@/lib/fields/forcing";

const OPEN_WATER: Forcing = {
  sic: 0.02,
  thicknessM: 0,
  wind: { u: -14, v: -4 },
  current: { u: 0.16, v: 0.01 },
  ice: { u: 0.12, v: 0.0 },
};

const PACK_ICE: Forcing = {
  sic: 0.97,
  thicknessM: 1.4,
  wind: { u: -14, v: -4 },
  current: { u: 0.16, v: 0.01 },
  ice: { u: 0.05, v: -0.03 },
};

const atRest = (lat = -68, lon = 25): BergState => ({ lat, lon, u: 0, v: 0 });

describe("coriolisF", () => {
  it("is negative in the Southern Hemisphere", () => {
    expect(coriolisF(-70)).toBeLessThan(0);
    expect(coriolisF(70)).toBeGreaterThan(0);
  });
  it("vanishes at the equator", () => {
    expect(coriolisF(0)).toBeCloseTo(0, 10);
  });
});

describe("force balance", () => {
  it("deflects a moving berg to the LEFT in the Southern Hemisphere", () => {
    // Berg heading east (u>0). SH Coriolis must turn it left, i.e. give a
    // northward... no: in SH, moving objects deflect to the left of motion.
    // Heading east, left is north => positive v acceleration.
    const acc = accelerations({ lat: -70, lon: 0, u: 0.2, v: 0 }, OPEN_WATER, COEFFICIENTS.GIANT);
    expect(acc.coriolis.u).toBeCloseTo(coriolisF(-70) * 0, 12);
    expect(acc.coriolis.v).toBeGreaterThan(0);
  });

  it("reports OPEN regime and zero ice force in open water", () => {
    const acc = accelerations(atRest(), OPEN_WATER, COEFFICIENTS.GIANT);
    expect(acc.regime).toBe("OPEN");
    expect(acc.omega).toBe(0);
    expect(acc.ice.u).toBe(0);
    expect(acc.ice.v).toBe(0);
  });

  it("reports LOCK and drives the berg toward ice velocity in dense pack", () => {
    const acc = accelerations(atRest(), PACK_ICE, COEFFICIENTS.GIANT);
    expect(acc.regime).toBe("LOCK");
    expect(acc.omega).toBe(1);
    // Ice force pulls toward the ice velocity (0.05, -0.03) from rest.
    expect(acc.ice.u).toBeGreaterThan(0);
    expect(acc.ice.v).toBeLessThan(0);
  });
});

describe("L6 — Antarctic tabular bergs are current-dominated, not wind-dominated", () => {
  // This is the specific scientific error the analysis calls out: applying the
  // Arctic "2% of wind" rule to a giant Antarctic berg.
  it("a GIANT berg feels the wind at well under 1% of wind speed", async () => {
    const traj = integrateTrajectory({
      start: atRest(),
      issueAt: new Date(Date.UTC(2026, 0, 15)),
      sizeClass: "GIANT",
      horizonHours: 72,
      useResidual: false,
    });
    const end = traj.points[traj.points.length - 1];
    const windSpeed = Math.hypot(OPEN_WATER.wind.u, OPEN_WATER.wind.v);
    // Wind-only terminal offset is sqrt(kAir*|W|^2 / kWater).
    const windOffset = Math.sqrt(
      (COEFFICIENTS.GIANT.kAir * windSpeed * windSpeed) / COEFFICIENTS.GIANT.kWater,
    );
    expect(windOffset / windSpeed).toBeLessThan(0.01);
    // And the track must be driven by the current instead.
    expect(end.distanceKm).toBeGreaterThan(10);
  });

  it("a SMALL berg responds to wind at the expected few-percent level", () => {
    const windSpeed = Math.hypot(OPEN_WATER.wind.u, OPEN_WATER.wind.v);
    const windOffset = Math.sqrt(
      (COEFFICIENTS.SMALL.kAir * windSpeed * windSpeed) / COEFFICIENTS.SMALL.kWater,
    );
    const fraction = windOffset / windSpeed;
    expect(fraction).toBeGreaterThan(0.015);
    expect(fraction).toBeLessThan(0.05);
  });

  it("wind influence increases monotonically as bergs get smaller", () => {
    const windSpeed = Math.hypot(OPEN_WATER.wind.u, OPEN_WATER.wind.v);
    const order = ["GIANT", "LARGE", "MEDIUM", "SMALL"] as const;
    const fractions = order.map((k) => {
      const c = COEFFICIENTS[k];
      return Math.sqrt((c.kAir * windSpeed * windSpeed) / c.kWater) / windSpeed;
    });
    for (let i = 1; i < fractions.length; i++) {
      expect(fractions[i]).toBeGreaterThan(fractions[i - 1]);
    }
  });
});

describe("drift integration", () => {
  const issueAt = new Date(Date.UTC(2026, 0, 15, 0, 0, 0));

  it("produces hourly samples across the full 72 h horizon", () => {
    const traj = integrateTrajectory({
      start: atRest(),
      issueAt,
      sizeClass: "LARGE",
      horizonHours: 72,
      useResidual: false,
    });
    expect(traj.points).toHaveLength(73);
    expect(traj.points[0].t).toBe(0);
    expect(traj.points[72].t).toBe(72);
  });

  it("keeps a berg locked to the ice field when the pack is dense (L5)", () => {
    const traj = integrateTrajectory({
      start: { lat: -69.5, lon: -30, u: 0.2, v: 0.15 },
      issueAt,
      sizeClass: "GIANT",
      horizonHours: 24,
      useResidual: false,
      coefficients: { ...COEFFICIENTS.GIANT },
    });
    // The Weddell sector at -69.5S in mid-January is consolidated pack.
    const locked = traj.points.filter((p) => p.regime === "LOCK");
    expect(locked.length).toBeGreaterThan(0);

    for (const p of locked) {
      // In LOCK the berg velocity IS the ice velocity. Compare against the
      // independent ice-drift field rather than an arbitrary speed cap: the
      // ACC at -69.5S really does run near 0.26 m/s.
      const ice = iceDrift(p.lat, p.lon, p.epochSec);
      expect(Math.abs(p.u - ice.u)).toBeLessThan(0.05);
      expect(Math.abs(p.v - ice.v)).toBeLessThan(0.05);
    }

    // Every locked sample sits in ice dense enough to justify the label, and
    // never outruns the ice it is locked into. (Speed alone is not a valid
    // test here: the ACC at -69.5S genuinely runs near 0.26 m/s, so a locked
    // berg there is fast — the invariant is that it moves WITH the ice.)
    for (const p of locked) {
      expect(p.sic).toBeGreaterThanOrEqual(0.9);
      const ice = iceDrift(p.lat, p.lon, p.epochSec);
      expect(Math.hypot(p.u, p.v)).toBeCloseTo(Math.hypot(ice.u, ice.v), 6);
    }
  });

  it("residual learning is bounded and cannot outrun the physics", () => {
    const corrector = makeResidualCorrector(DEFAULT_RESIDUAL_MODEL);
    for (let i = 0; i < 200; i++) {
      const c = corrector(
        { lat: -68 - (i % 20) * 0.3, lon: (i * 7) % 360 - 180, u: 0.1, v: 0 },
        PACK_ICE,
        i * 3600,
      );
      expect(Math.hypot(c.u, c.v)).toBeLessThanOrEqual(DEFAULT_RESIDUAL_MODEL.maxCorrection + 1e-12);
    }
  });

  it("physics-only baseline returns exactly zero correction", () => {
    const f = physicsOnlyResidual();
    expect(f(atRest(), OPEN_WATER)).toEqual({ u: 0, v: 0 });
  });

  it("is deterministic for a fixed seed", () => {
    const a = buildEnsemble(
      { start: atRest(), issueAt, sizeClass: "MEDIUM", horizonHours: 24, useResidual: false },
      8,
      undefined,
      42,
    );
    const b = buildEnsemble(
      { start: atRest(), issueAt, sizeClass: "MEDIUM", horizonHours: 24, useResidual: false },
      8,
      undefined,
      42,
    );
    expect(a.map((m) => m.points[24].lat)).toEqual(b.map((m) => m.points[24].lat));
  });

  it("ensemble spread grows with horizon", () => {
    const ens = buildEnsemble(
      { start: atRest(), issueAt, sizeClass: "LARGE", horizonHours: 72, useResidual: false },
      16,
      undefined,
      7,
    );
    const spread = ensembleSpreadKm(ens);
    expect(spread[72].sigmaKm).toBeGreaterThan(spread[12].sigmaKm);
  });
});

describe("helpers", () => {
  it("converts m/s to knots", () => {
    expect(speedKt(0.514444, 0)).toBeCloseTo(1, 3);
  });
  it("reports compass heading", () => {
    expect(headingDeg(0, 1)).toBeCloseTo(0, 6); // north
    expect(headingDeg(1, 0)).toBeCloseTo(90, 6); // east
    expect(headingDeg(0, -1)).toBeCloseTo(180, 6); // south
    expect(headingDeg(-1, 0)).toBeCloseTo(270, 6); // west
  });
  it("mulberry32 stays in [0,1)", () => {
    const r = mulberry32(9);
    for (let i = 0; i < 1000; i++) {
      const x = r();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});

describe("numerical stability", () => {
  const issueAt = new Date(Date.UTC(2026, 0, 18, 6));

  it("keeps every ensemble member finite for every size class", () => {
    // Regression: a SMALL berg with perturbed kWater made the quadratic drag
    // stiff enough to exceed RK4's stability limit, and two diverged members
    // pushed the ensemble mean and the conformal cone to 1e30 km.
    const classes = ["GIANT", "LARGE", "MEDIUM", "SMALL"] as const;
    const starts = [
      { lat: -68.1, lon: 15.05, u: -0.157, v: 0.077 },
      { lat: -59.4, lon: -33.2, u: 0.11, v: 0.05 },
      { lat: -67.8, lon: 74.1, u: 0.02, v: 0.03 },
      { lat: -74.6, lon: -38.2, u: 0.01, v: 0.0 },
    ];
    for (const sizeClass of classes) {
      for (const start of starts) {
        const ens = buildEnsemble({ start, issueAt, sizeClass, horizonHours: 72 }, 24);
        expect(ens.length).toBeGreaterThan(20);
        for (const m of ens) {
          for (const p of m.points) {
            expect(Number.isFinite(p.lat)).toBe(true);
            expect(Number.isFinite(p.lon)).toBe(true);
            expect(Math.abs(p.lat)).toBeLessThanOrEqual(90);
          }
        }
      }
    }
  });

  it("produces an ensemble spread in a physically sane range", () => {
    const ens = buildEnsemble(
      { start: { lat: -68.1, lon: 15.05, u: -0.157, v: 0.077 }, issueAt, sizeClass: "SMALL", horizonHours: 72 },
      24,
    );
    const spread = ensembleSpreadKm(ens);
    expect(spread[72].sigmaKm).toBeGreaterThan(0.1);
    expect(spread[72].sigmaKm).toBeLessThan(200);
  });

  it("rk4Step substeps when the drag is stiff", () => {
    const c = { ...COEFFICIENTS.SMALL, kWater: COEFFICIENTS.SMALL.kWater * 6 };
    const state = { lat: -68, lon: 15, u: 1.2, v: -0.9 };
    const next = rk4Step(state, 1800, c, () => OPEN_WATER, 1768716000);
    expect(Number.isFinite(next.lat)).toBe(true);
    expect(Number.isFinite(next.u)).toBe(true);
    // A stiff, opposed flow must decay, not explode.
    expect(Math.hypot(next.u, next.v)).toBeLessThan(Math.hypot(state.u, state.v));
  });
});
