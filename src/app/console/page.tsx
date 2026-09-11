import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { dataHealth, modelConfidence } from "@/lib/pipeline/forecast";
import { replaySummary } from "@/lib/pipeline/replay";
import { forcingAt } from "@/lib/fields/forcing";
import { classifyRegime, REGIME_META } from "@/lib/physics/regimes";
import { scoreVoyage, type BergRecord, type VoyageRecord } from "@/lib/pipeline/forecast";
import { polylineLengthKm, type LatLng } from "@/lib/geo/geodesic";
import { ConsoleShell } from "@/components/iceguard/ConsoleShell";

export const metadata: Metadata = {
  title: "Ops console",
  description:
    "ICEGUARD operations console: live ice field, tracked bergs, conformal uncertainty cones and the GO / SLOW / NO-GO badge for each planned corridor.",
};

export const dynamic = "force-dynamic";

export default async function ConsolePage() {
  const session = await getSession();
  const [bergs, voyages, feeds, model, thresholds] = await Promise.all([
    prisma.iceberg.findMany({
      orderBy: [{ sizeClass: "asc" }, { bergId: "asc" }],
      include: { _count: { select: { positions: true } } },
    }),
    prisma.voyage.findMany({ orderBy: { code: "asc" } }),
    prisma.dataSource.findMany(),
    prisma.modelVersion.findFirst({ orderBy: { createdAt: "desc" } }),
    prisma.threshold.findMany(),
  ]);

  const initialBergs = bergs.map((b) => {
    const t = b.lastObserved.getTime() / 1000;
    const f = forcingAt(b.lat, b.lon, t);
    const regime = classifyRegime({ sic: f.sic, thicknessM: f.thicknessM });
    return {
      id: b.id,
      bergId: b.bergId,
      displayName: b.displayName,
      sizeClass: b.sizeClass,
      regime,
      regimeLabel: REGIME_META[regime].label,
      lat: b.lat,
      lon: b.lon,
      areaKm2: b.areaKm2,
      keelDepthM: b.keelDepthM,
      speedKt: b.speedKt,
      headingDeg: b.headingDeg,
      sic: +f.sic.toFixed(3),
      thicknessM: +f.thicknessM.toFixed(2),
      grounded: b.grounded,
      splitOf: b.splitOf,
      notes: b.notes ?? "",
      historyPoints: b._count.positions,
    };
  });

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

  const initialVoyages = voyages.map((v) => {
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
      speedKt: v.speedKt,
      bufferNm: v.bufferNm,
      corridor,
      corridorKm: +polylineLengthKm(corridor).toFixed(0),
      departAt: v.departAt.toISOString(),
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

  const live = dataHealth();
  const conf = modelConfidence();
  const sar = live.find((f) => f.code === "SENTINEL1");
  const summary = replaySummary();

  return (
    <ConsoleShell
      initialBergs={initialBergs}
      initialVoyages={initialVoyages}
      initialHealth={{
        utc: new Date().toISOString(),
        feeds: live.map((f) => ({
          ...f,
          note: feeds.find((s) => s.code === f.code)?.note ?? f.note,
        })),
        sarAgeH: sar?.ageH ?? 0,
        model: {
          version: model?.version ?? conf.version,
          frozen: model?.frozen ?? false,
          confidence: +conf.value.toFixed(3),
          metrics: model ? JSON.parse(model.metrics) : {},
        },
        thresholds: Object.fromEntries(thresholds.map((t) => [t.key, t.value])),
        replay: {
          maeKm: summary.maeKm.model,
          physicsMaeKm: summary.maeKm.physics,
          targets: summary.targets,
        },
      }}
      initialUser={session}
    />
  );
}
