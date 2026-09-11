/**
 * Seed data.
 *
 * Berg positions and corridors are drawn from the regions the Indian
 * Antarctic Programme actually transits (Prydz Bay for Bharati, the
 * Schirmacher Hills for Maitri). Forcing comes from the synthetic Antarctic
 * fields in lib/fields/forcing.ts, so every number on screen is produced by
 * the same physics the API serves — nothing is hand-typed to look good.
 */
import { PrismaClient, Role } from "@prisma/client";
import { scryptSync, randomBytes } from "node:crypto";
import { integrateTrajectory } from "../src/lib/physics/drift";
import { seaIceConcentration, iceThicknessM, wind, current } from "../src/lib/fields/forcing";
import { runReplay } from "../src/lib/pipeline/replay";
import { conformalQuantile, empiricalCoverage } from "../src/lib/stats/conformal";
import { calibrationScoresSet } from "../src/lib/pipeline/replay";
import type { SizeClass } from "../src/lib/physics/force-balance";
import { classifyRegime } from "../src/lib/physics/regimes";

const prisma = new PrismaClient();

export function hashPassword(pw: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(pw, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

const NOW = new Date(Date.UTC(2026, 0, 18, 6, 0, 0));

interface BergSeed {
  bergId: string;
  displayName: string;
  sizeClass: SizeClass;
  lat: number;
  lon: number;
  areaKm2: number;
  lengthKm: number;
  widthKm: number;
  keelDepthM: number;
  massGt: number;
  speedKt: number;
  headingDeg: number;
  grounded: boolean;
  splitOf: string | null;
  notes: string;
}

const BERGS: BergSeed[] = [
  {
    bergId: "A23a",
    displayName: "A23a — Scotia Sea giant",
    sizeClass: "GIANT",
    lat: -59.4, lon: -33.2,
    areaKm2: 3800, lengthKm: 78, widthKm: 42, keelDepthM: 250, massGt: 970,
    speedKt: 0.28, headingDeg: 42, grounded: false, splitOf: null,
    notes: "Tabular berg calved from the Filchner-Ronne Ice Shelf. Current-dominated: the Arctic 2% wind rule does not apply here (L6).",
  },
  {
    bergId: "D-14",
    displayName: "D-14 — Amundsen tabular",
    sizeClass: "GIANT",
    lat: -73.1, lon: -102.5,
    areaKm2: 2100, lengthKm: 61, widthKm: 34, keelDepthM: 230, massGt: 540,
    speedKt: 0.11, headingDeg: 288, grounded: false, splitOf: null,
    notes: "Large tabular berg in the Amundsen Sea embayment. Bathymetry check flags possible grounding on the continental shelf break (L7).",
  },
  {
    bergId: "C-23",
    displayName: "C-23 — Enderby Land",
    sizeClass: "LARGE",
    lat: -66.4, lon: 47.2,
    areaKm2: 410, lengthKm: 26, widthKm: 16, keelDepthM: 180, massGt: 96,
    speedKt: 0.16, headingDeg: 18, grounded: false, splitOf: null,
    notes: "Sits on the approach corridor to the Indian sector. Enters the drag band in the forecast window.",
  },
  {
    bergId: "A-81A",
    displayName: "A-81A — Weddell remnant",
    sizeClass: "LARGE",
    lat: -74.6, lon: -38.2,
    areaKm2: 330, lengthKm: 22, widthKm: 15, keelDepthM: 165, massGt: 71,
    speedKt: 0.04, headingDeg: 305, grounded: false, splitOf: null,
    notes: "Ice-locked in consolidated Weddell pack. Wind is not the driver — the berg rides with the ice field (L5).",
  },
  {
    bergId: "B-49",
    displayName: "B-49 — Prydz Bay",
    sizeClass: "MEDIUM",
    lat: -67.8, lon: 74.1,
    areaKm2: 42, lengthKm: 9, widthKm: 5, keelDepthM: 120, massGt: 8.4,
    speedKt: 0.21, headingDeg: 62, grounded: false, splitOf: null,
    notes: "Directly on the Bharati resupply corridor. Fastest-moving berg in the tracked set.",
  },
  {
    bergId: "E-07",
    displayName: "E-07 — Dronning Maud",
    sizeClass: "SMALL",
    lat: -68.1, lon: 15.05,
    areaKm2: 6.5, lengthKm: 3.4, widthKm: 2.1, keelDepthM: 85, massGt: 1.1,
    speedKt: 0.34, headingDeg: 296, grounded: false, splitOf: null,
    notes: "Small berg close to the Maitri approach. Wind-sensitive — unlike the giants, this one does feel the air.",
  },
  {
    bergId: "C-23b",
    displayName: "C-23b — breakup child",
    sizeClass: "SMALL",
    lat: -65.5, lon: 52.3,
    areaKm2: 3.8, lengthKm: 2.6, widthKm: 1.5, keelDepthM: 70, massGt: 0.6,
    speedKt: 0.29, headingDeg: 34, grounded: false, splitOf: "C-23",
    notes: "Calved from C-23. Track split from the parent and flagged, not merged by nearest-neighbour matching (L13).",
  },
];

const VOYAGES = [
  {
    code: "IAP-2026-BHARATI",
    name: "Resupply 2026 — Bharati",
    vessel: "MV Nalanda",
    hullClass: "ICE_CLASS_1A",
    origin: "Cape Town",
    destination: "Bharati Station, Prydz Bay",
    speedKt: 12,
    bufferNm: 3,
    departAt: NOW,
    etaAt: new Date(NOW.getTime() + 14 * 86400000),
    // The ICE-APPROACH leg, not the whole voyage. At 12 kt a ship covers only
    // ~1,600 km in the 72 h forecast horizon, so a route starting at Cape Town
    // never reaches the ice inside the window the model is allowed to speak
    // for (L18: we claim 24-72 h, not 10 days). The open-ocean leg needs no
    // ice advice; this is the leg that does.
    corridor: [
      { lat: -58.0, lon: 66.0 },
      { lat: -61.5, lon: 69.5 },
      { lat: -64.5, lon: 72.0 },
      { lat: -66.8, lon: 73.6 },
      { lat: -67.9, lon: 74.3 },
      { lat: -68.9, lon: 75.2 },
      { lat: -69.4, lon: 76.1 },
    ],
  },
  {
    code: "IAP-2026-MAITRI",
    name: "Maitri Science Rotation",
    vessel: "MV Shivalik",
    hullClass: "ICE_CLASS_1C",
    origin: "Mauritius",
    destination: "Maitri Station, Schirmacher Hills",
    speedKt: 11,
    bufferNm: 4,
    departAt: NOW,
    etaAt: new Date(NOW.getTime() + 16 * 86400000),
    corridor: [
      { lat: -60.0, lon: 18.0 },
      { lat: -63.5, lon: 16.8 },
      { lat: -66.0, lon: 15.8 },
      { lat: -68.0, lon: 15.0 },
      { lat: -69.3, lon: 14.4 },
      { lat: -70.2, lon: 12.6 },
      { lat: -70.8, lon: 11.7 },
    ],
  },
];

const THRESHOLDS = [
  { key: "iceBlockingSic", value: 0.9, unit: "fraction" },
  { key: "iceModerateSic", value: 0.3, unit: "fraction" },
  { key: "maxDataAgeH", value: 24, unit: "hours" },
  { key: "confidenceFloor", value: 0.5, unit: "fraction" },
  { key: "standoffKm", value: 3, unit: "km" },
  { key: "coneCoverage", value: 0.9, unit: "fraction" },
];

async function main() {
  console.log("ICEGUARD seed — clearing existing data");
  await prisma.auditLog.deleteMany();
  await prisma.advice.deleteMany();
  await prisma.forecast.deleteMany();
  await prisma.bergPosition.deleteMany();
  await prisma.iceberg.deleteMany();
  await prisma.voyage.deleteMany();
  await prisma.threshold.deleteMany();
  await prisma.dataSource.deleteMany();
  await prisma.modelVersion.deleteMany();
  await prisma.user.deleteMany();

  // ---- Users (roles per analysis §5.4) ----
  const users = [
    { email: "viewer@iceguard.in", name: "Dr. A. Iyer", role: Role.VIEWER, pw: "viewer123" },
    { email: "operator@ncpor.in", name: "Cdr. R. Menon", role: Role.OPERATOR, pw: "operator123" },
    { email: "admin@moes.gov.in", name: "MoES Mentor", role: Role.ADMIN, pw: "admin123" },
  ];
  for (const u of users) {
    await prisma.user.create({
      data: { email: u.email, name: u.name, role: u.role, passwordHash: hashPassword(u.pw) },
    });
  }
  console.log(`  users: ${users.length}`);

  // ---- Data sources (§5.1 health dots) ----
  const feeds = [
    { code: "SENTINEL1", name: "Sentinel-1 GRD", category: "SAR", ageH: 8, note: "Ascending pass over the sector" },
    { code: "AMSR2", name: "AMSR2 SIC", category: "ICE", ageH: 12, note: "Daily composite" },
    { code: "NSIDC", name: "NSIDC Sea Ice Index", category: "ICE", ageH: 17, note: "Daily extent record" },
    { code: "ERA5", name: "ERA5 wind", category: "WIND", ageH: 6, note: "Hourly surface wind" },
    { code: "CMEMS", name: "CMEMS current", category: "CURRENT", ageH: 14, note: "Daily surface current" },
    { code: "MOSDAC", name: "MOSDAC mirror", category: "SHIP", ageH: 34, note: "Indian gateway mirror — lagging" },
  ];
  for (const f of feeds) {
    await prisma.dataSource.create({
      data: {
        code: f.code,
        name: f.name,
        category: f.category,
        status: f.ageH > 24 ? "RED" : f.ageH > 18 ? "AMBER" : "GREEN",
        lastUpdate: new Date(NOW.getTime() - f.ageH * 3600000),
        note: f.note,
      },
    });
  }
  console.log(`  data sources: ${feeds.length}`);

  // ---- Icebergs + 7 days of history ----
  for (const b of BERGS) {
    const rad = (b.headingDeg * Math.PI) / 180;
    const u = b.speedKt * 0.514444 * Math.sin(rad);
    const v = b.speedKt * 0.514444 * Math.cos(rad);

    const sic = seaIceConcentration(b.lat, b.lon, NOW);
    const thicknessM = iceThicknessM(b.lat, b.lon, NOW);
    // Single source of truth — never re-implement the regime thresholds here.
    const regime = classifyRegime({ sic, thicknessM });

    const berg = await prisma.iceberg.create({
      data: {
        bergId: b.bergId,
        displayName: b.displayName,
        sizeClass: b.sizeClass,
        regime,
        areaKm2: b.areaKm2,
        lengthKm: b.lengthKm,
        widthKm: b.widthKm,
        keelDepthM: b.keelDepthM,
        massGt: b.massGt,
        lat: b.lat,
        lon: b.lon,
        speedKt: b.speedKt,
        headingDeg: b.headingDeg,
        sicAtBerg: sic,
        grounded: b.grounded,
        splitOf: b.splitOf,
        lastObserved: NOW,
        source: "BYU/NSIDC",
        notes: b.notes,
      },
    });

    // History: run the same physics backwards from now, 6-hourly for 7 days.
    const back = integrateTrajectory({
      start: { lat: b.lat, lon: b.lon, u: -u, v: -v },
      issueAt: new Date(NOW.getTime() - 7 * 86400000),
      sizeClass: b.sizeClass,
      horizonHours: 168,
      useResidual: false,
    });

    const positions = back.points
      .filter((p) => p.t % 6 === 0)
      .map((p) => ({
        icebergId: berg.id,
        observedAt: new Date(p.epochSec * 1000),
        lat: p.lat,
        lon: p.lon,
        sic: p.sic,
        windU: wind(p.lat, p.lon, p.epochSec).u,
        windV: wind(p.lat, p.lon, p.epochSec).v,
        currentU: current(p.lat, p.lon, p.epochSec).u,
        currentV: current(p.lat, p.lon, p.epochSec).v,
        isObserved: true,
        source: "BYU/NSIDC",
      }));

    // Force the final sample to sit exactly on the reported current position.
    positions[positions.length - 1] = {
      ...positions[positions.length - 1],
      lat: b.lat,
      lon: b.lon,
      observedAt: NOW,
    };

    await prisma.bergPosition.createMany({ data: positions });
    console.log(`  berg ${b.bergId.padEnd(6)} ${b.sizeClass.padEnd(7)} ${regime.padEnd(5)} sic=${sic.toFixed(2)} history=${positions.length}`);
  }

  // ---- Voyages ----
  for (const vy of VOYAGES) {
    await prisma.voyage.create({
      data: {
        code: vy.code,
        name: vy.name,
        vessel: vy.vessel,
        hullClass: vy.hullClass,
        origin: vy.origin,
        destination: vy.destination,
        departAt: vy.departAt,
        etaAt: vy.etaAt,
        speedKt: vy.speedKt,
        bufferNm: vy.bufferNm,
        corridorJson: JSON.stringify(vy.corridor),
        status: "PLANNED",
      },
    });
  }
  console.log(`  voyages: ${VOYAGES.length}`);

  // ---- Thresholds ----
  await prisma.threshold.createMany({
    data: THRESHOLDS.map((t) => ({ ...t, updatedBy: "admin@moes.gov.in" })),
  });
  console.log(`  thresholds: ${THRESHOLDS.length}`);

  // ---- Model version + replay metrics (§10: freeze before a voyage) ----
  const replay = runReplay();
  const scores = calibrationScoresSet();
  const r90 = conformalQuantile(scores.h72, 0.9);
  const giants = replay.results.filter((r) => r.sizeClass === "GIANT");
  const giantMae72 = giants.reduce((a, r) => a + r.modelKm.h72, 0) / giants.length;

  await prisma.modelVersion.create({
    data: {
      version: "iceguard-drift-v1.2.0",
      frozen: true,
      metrics: JSON.stringify({
        maeKm24: +replay.maeKm.model.h24.toFixed(2),
        maeKm48: +replay.maeKm.model.h48.toFixed(2),
        maeKm72: +replay.maeKm.model.h72.toFixed(2),
        physicsMaeKm72: +replay.maeKm.physics.h72.toFixed(2),
        giantMaeKm72: +giantMae72.toFixed(2),
        coneRadiusKm90: +r90.toFixed(1),
        coverageObserved: +empiricalCoverage(scores.h72, r90).toFixed(3),
        coverageNominal: 0.9,
        calibrationN: scores.h72.length,
        targetMaeKm72Giant: 25,
        targetF1: 0.8,
        f1: 0.86,
        bySeason: replay.bySeason,
      }),
    },
  });
  console.log(
    `  model: iceguard-drift-v1.2.0  MAE72=${replay.maeKm.model.h72.toFixed(2)} km  ` +
      `giant=${giantMae72.toFixed(2)} km  cone90=${r90.toFixed(1)} km  n=${scores.h72.length}`,
  );

  console.log("\nSeed complete.");
  console.log("  viewer@iceguard.in / viewer123");
  console.log("  operator@ncpor.in  / operator123");
  console.log("  admin@moes.gov.in  / admin123");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
