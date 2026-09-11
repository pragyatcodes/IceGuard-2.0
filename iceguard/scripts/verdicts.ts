import { PrismaClient } from "@prisma/client";
import { scoreVoyage, dataHealth, modelConfidence } from "@/lib/pipeline/forecast";
const p = new PrismaClient();
async function main(){
  const bergs = await p.iceberg.findMany();
  const voyages = await p.voyage.findMany();
  const conf = modelConfidence();
  console.log("model confidence:", conf.value.toFixed(3), "| SAR age:", dataHealth().find(f=>f.code==="SENTINEL1")!.ageH, "h");
  for (const v of voyages) {
    const bs = bergs.map(b=>({id:b.id,bergId:b.bergId,displayName:b.displayName,sizeClass:b.sizeClass as any,lat:b.lat,lon:b.lon,
      u:b.speedKt*0.514444*Math.sin(b.headingDeg*Math.PI/180), v:b.speedKt*0.514444*Math.cos(b.headingDeg*Math.PI/180),
      areaKm2:b.areaKm2, keelDepthM:b.keelDepthM}));
    const r = scoreVoyage({id:v.id,code:v.code,name:v.name,vessel:v.vessel,hullClass:v.hullClass as any,
      corridor:JSON.parse(v.corridorJson),speedKt:v.speedKt,bufferNm:v.bufferNm,departAt:v.departAt}, bs);
    console.log(`\n${v.code} (${v.hullClass})`);
    console.log("  LIGHT:", r.score.light, "| timeToHazard:", r.score.timeToHazardH, "h | minClear:", r.score.minClearanceKm.toFixed(1), "km | maxSIC:", (r.score.maxIceOnRoute*100).toFixed(0)+"%");
    console.log("  REASON:", r.score.reason);
    console.log("  ACTION:", r.score.action);
    console.log("  hazards:", r.score.hazards.slice(0,3).map(h=>`${h.bergId}@T+${h.h}h ${h.kind} ${h.clearanceKm.toFixed(1)}km`));
  }
  console.log("\nRegimes:", bergs.map(b=>`${b.bergId}:${b.regime}`).join("  "));
}
main().finally(()=>p.$disconnect());
