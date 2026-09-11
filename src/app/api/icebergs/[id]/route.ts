import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { generateForecast, ENSEMBLE_MEMBERS } from "@/lib/pipeline/forecast";
import { REGIME_META } from "@/lib/physics/regimes";
import { replaySummary } from "@/lib/pipeline/replay";

export const dynamic = "force-dynamic";

/**
 * One berg: observed history, 72 h forecast, conformal cone, force tags and
 * the replay error for its size class. This is the payload behind both the
 * console right-hand panel and the shareable public berg page.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const url = new URL(req.url);
  const horizon = Math.min(72, Math.max(24, Number(url.searchParams.get("horizon") ?? 72)));
  const withMembers = url.searchParams.get("members") === "1";

  const berg = await prisma.iceberg.findFirst({
    where: { OR: [{ id }, { bergId: id }] },
    include: {
      positions: { orderBy: { observedAt: "asc" } },
    },
  });
  if (!berg) {
    return NextResponse.json({ error: "berg not found" }, { status: 404 });
  }

  // Forecast is issued from the last observation, not from "now": the model
  // speaks from the newest evidence it has.
  const issueAt = berg.lastObserved;
  const fc = generateForecast(
    {
      id: berg.id,
      bergId: berg.bergId,
      displayName: berg.displayName,
      sizeClass: berg.sizeClass as never,
      lat: berg.lat,
      lon: berg.lon,
      u: berg.speedKt * 0.514444 * Math.sin((berg.headingDeg * Math.PI) / 180),
      v: berg.speedKt * 0.514444 * Math.cos((berg.headingDeg * Math.PI) / 180),
      areaKm2: berg.areaKm2,
      keelDepthM: berg.keelDepthM,
    },
    issueAt,
    horizon,
    ENSEMBLE_MEMBERS,
  );

  const replay = replaySummary();
  const own = replay.results.filter((r) => r.bergId === berg.bergId);
  const classResults = replay.results.filter((r) => r.sizeClass === berg.sizeClass);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

  return NextResponse.json({
    berg: {
      id: berg.id,
      bergId: berg.bergId,
      displayName: berg.displayName,
      sizeClass: berg.sizeClass,
      regime: berg.regime,
      regimeMeta: REGIME_META[berg.regime as keyof typeof REGIME_META],
      lat: berg.lat,
      lon: berg.lon,
      areaKm2: berg.areaKm2,
      lengthKm: berg.lengthKm,
      widthKm: berg.widthKm,
      keelDepthM: berg.keelDepthM,
      massGt: berg.massGt,
      speedKt: berg.speedKt,
      headingDeg: berg.headingDeg,
      sicAtBerg: berg.sicAtBerg,
      grounded: berg.grounded,
      splitOf: berg.splitOf,
      lastObserved: issueAt.toISOString(),
      source: berg.source,
      notes: berg.notes,
    },
    history: berg.positions.map((p) => ({
      t: p.observedAt.toISOString(),
      lat: p.lat,
      lon: p.lon,
      sic: +p.sic.toFixed(3),
    })),
    forecast: {
      issuedAt: fc.issuedAt,
      horizonHours: fc.horizonHours,
      regime: fc.regime,
      regimeMeta: REGIME_META[fc.regime],
      forces: fc.forces,
      distanceKm72: +fc.distanceKm72.toFixed(1),
      speedKt: +fc.speedKt.toFixed(3),
      headingDeg: +fc.headingDeg.toFixed(1),
      centre: fc.centre.map((p) => ({
        t: p.t,
        lat: +p.lat.toFixed(5),
        lon: +p.lon.toFixed(5),
        sic: +p.sic.toFixed(3),
        thicknessM: +p.thicknessM.toFixed(2),
        regime: p.regime,
        distanceKm: +p.distanceKm.toFixed(1),
        speedKt: +p.speedKt.toFixed(3),
        forces: {
          wind: +p.forces.wind.toFixed(3),
          current: +p.forces.current.toFixed(3),
          ice: +p.forces.ice.toFixed(3),
        },
      })),
      cone: {
        coverage: fc.cone.coverage,
        calibratedRadiusKm: +fc.cone.calibratedRadiusKm.toFixed(1),
        slices: fc.cone.slices.map((s) => ({
          t: s.t,
          crossKm: +s.crossKm.toFixed(1),
          alongKm: +s.alongKm.toFixed(1),
          lat: +s.center.lat.toFixed(5),
          lon: +s.center.lon.toFixed(5),
        })),
        polygon: fc.cone.polygon.map((p) => [+p.lat.toFixed(5), +p.lon.toFixed(5)]),
      },
      spread: fc.spread.map((s) => ({ t: s.t, sigmaKm: +s.sigmaKm.toFixed(2) })),
      calibration: fc.calibration,
      ...(withMembers
        ? {
            members: fc.members.map((m) =>
              m.map((p) => [+p.lat.toFixed(4), +p.lon.toFixed(4)]),
            ),
          }
        : {}),
    },
    skill: {
      thisBerg: own.length
        ? {
            n: own.length,
            maeKm: {
              h24: +mean(own.map((r) => r.modelKm.h24)).toFixed(2),
              h48: +mean(own.map((r) => r.modelKm.h48)).toFixed(2),
              h72: +mean(own.map((r) => r.modelKm.h72)).toFixed(2),
            },
          }
        : null,
      sizeClass: {
        n: classResults.length,
        maeKm: {
          h24: +mean(classResults.map((r) => r.modelKm.h24)).toFixed(2),
          h48: +mean(classResults.map((r) => r.modelKm.h48)).toFixed(2),
          h72: +mean(classResults.map((r) => r.modelKm.h72)).toFixed(2),
        },
        physicsMaeKm: {
          h24: +mean(classResults.map((r) => r.physicsKm.h24)).toFixed(2),
          h48: +mean(classResults.map((r) => r.physicsKm.h48)).toFixed(2),
          h72: +mean(classResults.map((r) => r.physicsKm.h72)).toFixed(2),
        },
      },
    },
  });
}
