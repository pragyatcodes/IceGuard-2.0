import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { generateForecast } from "@/lib/pipeline/forecast";
import { seaIceConcentration } from "@/lib/fields/forcing";

export const dynamic = "force-dynamic";

/**
 * Station / low-bandwidth pack (§5.3, L9).
 *
 * Ships GeoJSON + a coarse ice raster rather than satellite cubes, and
 * reports the byte size on screen so the "5–20 MB" claim in §6.6 is measured,
 * not asserted. `?lite=1` drops the ice raster entirely for the worst links.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const lite = url.searchParams.get("lite") === "1";
  const step = lite ? 1.0 : 0.5; // degrees per ice grid cell

  const bergs = await prisma.iceberg.findMany();

  // Coarse ice raster over the operating box.
  const ice: number[] = [];
  const box = { latMin: -78, latMax: -52, lonMin: -110, lonMax: 90 };
  const t0 = Date.UTC(2026, 0, 18, 6) / 1000;
  for (let lat = box.latMin; lat <= box.latMax; lat += step) {
    for (let lon = box.lonMin; lon <= box.lonMax; lon += step) {
      ice.push(Math.round(seaIceConcentration(lat, lon, t0) * 100));
    }
  }

  const tracks = bergs.map((b) => {
    const fc = generateForecast(
      {
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
      },
      b.lastObserved,
      72,
    );
    return {
      bergId: b.bergId,
      regime: fc.regime,
      track: fc.centre
        .filter((p) => p.t % 3 === 0)
        .map((p) => [+p.lon.toFixed(3), +p.lat.toFixed(3)]),
      cone: fc.cone.polygon
        .filter((_, i) => i % 2 === 0)
        .map((p) => [+p.lon.toFixed(3), +p.lat.toFixed(3)]),
    };
  });

  const bundle = {
    generatedAt: new Date().toISOString(),
    schema: "iceguard.bundle/v1",
    grid: {
      step,
      box,
      // Run-length encode the raster: ice concentration is spatially smooth,
      // so this is where most of the saving comes from on a slow link.
      rle: rle(ice),
    },
    tracks,
  };

  const bytes = Buffer.byteLength(JSON.stringify(bundle), "utf8");

  return NextResponse.json({
    lite,
    stepDeg: step,
    cells: ice.length,
    bergs: tracks.length,
    bytes,
    mb: +(bytes / 1048576).toFixed(3),
    // §6.6 sets 5–20 MB as the allowance a station link can absorb, i.e. an
    // upper bound — not a range we have to fill. This pack is GeoJSON plus a
    // coarse raster only; a production pack would also stream COG tiles, which
    // is where the megabytes would come from.
    budgetMb: 20,
    underBudget: bytes / 1048576 <= 20,
    headroomPct: +(100 - (bytes / 1048576 / 20) * 100).toFixed(1),
    note: lite
      ? "Lite pack: tracks, cones and a 1° ice raster only."
      : "Standard pack: tracks, cones and a 0.5° ice raster.",
  });
}

function rle(values: number[]): [number, number][] {
  const out: [number, number][] = [];
  let i = 0;
  while (i < values.length) {
    let j = i;
    while (j < values.length && values[j] === values[i]) j++;
    out.push([values[i], j - i]);
    i = j;
  }
  return out;
}
