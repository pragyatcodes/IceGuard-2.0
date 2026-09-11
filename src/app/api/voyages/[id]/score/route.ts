import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  scoreVoyage,
  thresholdsForHull,
  type BergRecord,
  type VoyageRecord,
} from "@/lib/pipeline/forecast";
import type { LatLng } from "@/lib/geo/geodesic";

export const dynamic = "force-dynamic";

/**
 * Full pipeline for one voyage: forecast every berg → conformal cone → route
 * score → GO/SLOW/NO-GO with the reason in words (§4.4, §4.5).
 *
 * POST accepts an optional corridor and threshold override so a duty officer
 * can test an alternate route and watch the badge change. That is the demo the
 * analysis asks for: "Load a fake Bharati corridor that the cone crosses.
 * Badge flips to NO-GO."
 */
const Body = z.object({
  corridor: z
    .array(z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) }))
    .min(2)
    .optional(),
  speedKt: z.number().min(1).max(40).optional(),
  bufferNm: z.number().min(0.5).max(20).optional(),
  hullClass: z.enum(["ICE_CLASS_1A", "ICE_CLASS_1C", "NON_ICE"]).optional(),
  thresholds: z
    .object({
      iceBlockingSic: z.number().min(0).max(1).optional(),
      iceBlockingThicknessM: z.number().min(0).max(10).optional(),
      iceModerateSic: z.number().min(0).max(1).optional(),
      maxDataAgeH: z.number().min(1).max(168).optional(),
      confidenceFloor: z.number().min(0).max(1).optional(),
      standoffKm: z.number().min(0).max(50).optional(),
    })
    .optional(),
  dataAgeH: z.number().min(0).max(720).optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid body", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const body = parsed.data;

  const voyage = await prisma.voyage.findFirst({ where: { OR: [{ id }, { code: id }] } });
  if (!voyage) return NextResponse.json({ error: "voyage not found" }, { status: 404 });

  const bergs = await prisma.iceberg.findMany();
  const bergRecords: BergRecord[] = bergs.map((b) => ({
    id: b.id,
    bergId: b.bergId,
    displayName: b.displayName,
    sizeClass: b.sizeClass as never,
    lat: b.lat,
    lon: b.lon,
    u: b.speedKt * 0.514444 * Math.sin((b.headingDeg * Math.PI) / 180),
    v: b.speedKt * 0.514444 * Math.cos((b.headingDeg * Math.PI) / 180),
    areaKm2: b.areaKm2,
    keelDepthM: b.keelDepthM,
  }));

  const hullClass = (body.hullClass ?? voyage.hullClass) as VoyageRecord["hullClass"];
  const corridor = (body.corridor ?? JSON.parse(voyage.corridorJson)) as LatLng[];

  const rec: VoyageRecord = {
    id: voyage.id,
    code: voyage.code,
    name: voyage.name,
    vessel: voyage.vessel,
    hullClass,
    corridor,
    speedKt: body.speedKt ?? voyage.speedKt,
    bufferNm: body.bufferNm ?? voyage.bufferNm,
    departAt: voyage.departAt,
  };

  const thresholds = {
    ...thresholdsForHull(hullClass),
    ...(body.thresholds ?? {}),
  };

  const verdict = scoreVoyage(rec, bergRecords, {
    thresholds,
    now: voyage.departAt,
  });

  // Override the SAR age after scoring when the caller is testing L8
  // explicitly ("what if the radar feed goes stale?").
  const s = body.dataAgeH !== undefined
    ? reScoreWithAge(verdict, body.dataAgeH, thresholds)
    : verdict.score;

  return NextResponse.json({
    voyage: {
      id: voyage.id,
      code: voyage.code,
      name: voyage.name,
      vessel: voyage.vessel,
      hullClass,
      speedKt: rec.speedKt,
      bufferNm: rec.bufferNm,
      corridor,
    },
    dataAgeH: verdict.dataAgeH,
    modelConfidence: +verdict.modelConfidence.toFixed(3),
    modelVersion: verdict.modelVersion,
    score: {
      light: s.light,
      reason: s.reason,
      action: s.action,
      timeToHazardH: s.timeToHazardH,
      minClearanceKm: +s.minClearanceKm.toFixed(1),
      maxIceOnRoute: +s.maxIceOnRoute.toFixed(3),
      degraded: s.degraded,
      cappedByStaleData: s.cappedByStaleData,
      confidence: +s.confidence.toFixed(3),
      coverage: s.coverage,
      thresholds: s.thresholds,
      hazards: s.hazards.slice(0, 24).map((h) => ({
        ...h,
        clearanceKm: +h.clearanceKm.toFixed(1),
      })),
      perHour: s.perHour.map((p) => ({
        h: p.h,
        lat: +p.ship.lat.toFixed(4),
        lon: +p.ship.lon.toFixed(4),
        sic: +p.sic.toFixed(3),
        thicknessM: +p.thicknessM.toFixed(2),
        clearanceKm: +p.clearanceKm.toFixed(1),
        worstBerg: p.worstBerg,
        worstRegime: p.worstRegime,
      })),
    },
    forecasts: verdict.forecasts.map((f) => ({
      bergId: f.bergId,
      regime: f.regime,
      forces: f.forces,
      distanceKm72: +f.distanceKm72.toFixed(1),
      coneWidthKm: +f.cone.calibratedRadiusKm.toFixed(1),
      calibration: f.calibration,
      centre: f.centre.map((p) => ({
        t: p.t,
        lat: +p.lat.toFixed(4),
        lon: +p.lon.toFixed(4),
        sic: +p.sic.toFixed(3),
        regime: p.regime,
      })),
      cone: f.cone.slices.map((sl) => ({
        t: sl.t,
        crossKm: +sl.crossKm.toFixed(1),
        lat: +sl.center.lat.toFixed(4),
        lon: +sl.center.lon.toFixed(4),
      })),
      polygon: f.cone.polygon.map((p) => [+p.lat.toFixed(4), +p.lon.toFixed(4)]),
    })),
  });
}

/**
 * Re-derive the badge under a different SAR age. Kept as a pure re-score
 * rather than a mutation of the original so the audit trail stays honest.
 */
function reScoreWithAge(
  verdict: Awaited<ReturnType<typeof scoreVoyage>>,
  dataAgeH: number,
  thresholds: ReturnType<typeof thresholdsForHull>,
) {
  const stale = dataAgeH > thresholds.maxDataAgeH;
  let light = verdict.score.light;
  let reason = verdict.score.reason;
  let action = verdict.score.action;
  let capped = false;

  if (stale && light === "GO") {
    light = "SLOW";
    capped = true;
    reason = `Advice would be GO, but the newest SAR scene is ${dataAgeH.toFixed(0)} h old (threshold ${thresholds.maxDataAgeH} h). The badge cannot be GO on stale radar.`;
    action =
      "Treat as SLOW. Proceed with reduced speed and heightened lookout until a fresh Sentinel-1 pass lands.";
  }

  return {
    ...verdict.score,
    light,
    reason,
    action,
    cappedByStaleData: capped,
    degraded: stale,
  };
}
