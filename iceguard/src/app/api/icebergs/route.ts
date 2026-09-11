import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { forcingAt } from "@/lib/fields/forcing";
import { classifyRegime, REGIME_META } from "@/lib/physics/regimes";

export const dynamic = "force-dynamic";

/** Tracked bergs with their live forcing state and current regime. */
export async function GET() {
  const bergs = await prisma.iceberg.findMany({
    orderBy: [{ sizeClass: "asc" }, { bergId: "asc" }],
    include: {
      _count: { select: { positions: true, forecasts: true } },
    },
  });

  const out = bergs.map((b) => {
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
      regimeBlurb: REGIME_META[regime].blurb,
      lat: b.lat,
      lon: b.lon,
      areaKm2: b.areaKm2,
      lengthKm: b.lengthKm,
      widthKm: b.widthKm,
      keelDepthM: b.keelDepthM,
      massGt: b.massGt,
      speedKt: b.speedKt,
      headingDeg: b.headingDeg,
      sic: +f.sic.toFixed(3),
      thicknessM: +f.thicknessM.toFixed(2),
      grounded: b.grounded,
      splitOf: b.splitOf,
      lastObserved: b.lastObserved.toISOString(),
      source: b.source,
      notes: b.notes,
      historyPoints: b._count.positions,
    };
  });

  return NextResponse.json({ count: out.length, icebergs: out });
}
