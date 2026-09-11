import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { scoreVoyage, type BergRecord, type VoyageRecord } from "@/lib/pipeline/forecast";
import { polylineLengthKm, type LatLng } from "@/lib/geo/geodesic";

export const dynamic = "force-dynamic";

/** Planned voyages with their current verdict. */
export async function GET() {
  const [voyages, bergs] = await Promise.all([
    prisma.voyage.findMany({ orderBy: { code: "asc" } }),
    prisma.iceberg.findMany(),
  ]);

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

  const out = voyages.map((v) => {
    const corridor = JSON.parse(v.corridorJson) as LatLng[];
    const rec: VoyageRecord = {
      id: v.id,
      code: v.code,
      name: v.name,
      vessel: v.vessel,
      hullClass: v.hullClass as never,
      corridor,
      speedKt: v.speedKt,
      bufferNm: v.bufferNm,
      departAt: v.departAt,
    };
    const verdict = scoreVoyage(rec, bergRecords, { now: v.departAt });
    return {
      id: v.id,
      code: v.code,
      name: v.name,
      vessel: v.vessel,
      hullClass: v.hullClass,
      origin: v.origin,
      destination: v.destination,
      departAt: v.departAt.toISOString(),
      etaAt: v.etaAt.toISOString(),
      speedKt: v.speedKt,
      bufferNm: v.bufferNm,
      corridor,
      corridorKm: +polylineLengthKm(corridor).toFixed(0),
      status: v.status,
      verdict: {
        light: verdict.score.light,
        reason: verdict.score.reason,
        action: verdict.score.action,
        timeToHazardH: verdict.score.timeToHazardH,
        minClearanceKm: +verdict.score.minClearanceKm.toFixed(1),
        maxIceOnRoute: +verdict.score.maxIceOnRoute.toFixed(3),
        degraded: verdict.score.degraded,
        cappedByStaleData: verdict.score.cappedByStaleData,
        hazardCount: verdict.score.hazards.length,
      },
    };
  });

  return NextResponse.json({ count: out.length, voyages: out });
}
