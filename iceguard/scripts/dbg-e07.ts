import { PrismaClient } from "@prisma/client";
import { generateForecast } from "@/lib/pipeline/forecast";
import { integrateTrajectory, buildEnsemble, ensembleSpreadKm } from "@/lib/physics/drift";
import { calibrationScores } from "@/lib/pipeline/replay";
import { conformalQuantile } from "@/lib/stats/conformal";
const p = new PrismaClient();
async function main(){
  const b = await p.iceberg.findUnique({ where: { bergId: "E-07" } });
  if (!b) throw new Error("no E-07");
  const now = new Date(Date.UTC(2026,0,18,6));
  const u = b.speedKt*0.514444*Math.sin(b.headingDeg*Math.PI/180);
  const v = b.speedKt*0.514444*Math.cos(b.headingDeg*Math.PI/180);
  const berg = { id:b.id, bergId:b.bergId, displayName:b.displayName, sizeClass:b.sizeClass as any, lat:b.lat, lon:b.lon, u, v, areaKm2:b.areaKm2, keelDepthM:b.keelDepthM };
  console.log("start:", {lat:b.lat, lon:b.lon, u:+u.toFixed(4), v:+v.toFixed(4)}, b.sizeClass);

  const single = integrateTrajectory({ start:{lat:b.lat,lon:b.lon,u,v}, issueAt: now, sizeClass:b.sizeClass as any, horizonHours:72, useResidual:true });
  const bad = single.points.findIndex(pt=>!Number.isFinite(pt.lat)||!Number.isFinite(pt.lon));
  console.log("single-track first non-finite idx:", bad, "| final lat/lon:", single.points[72].lat.toFixed(3), single.points[72].lon.toFixed(3));

  const ens = buildEnsemble({ start:{lat:b.lat,lon:b.lon,u,v}, issueAt: now, sizeClass:b.sizeClass as any, horizonHours:72, useResidual:true }, 24);
  const runaway = ens.map((m,i)=>({i, lat:m.points[72].lat, lon:m.points[72].lon})).filter(m=>!Number.isFinite(m.lat)||Math.abs(m.lat)>90);
  console.log("runaway members:", runaway.length, JSON.stringify(runaway.slice(0,3)));
  const spread = ensembleSpreadKm(ens);
  console.log("spread km @24/48/72:", [24,48,72].map(h=>+spread[h].sigmaKm.toFixed(1)));
  const scores = calibrationScores(72);
  console.log("calib n:", scores.length, "q90:", conformalQuantile(scores,0.9).toFixed(2), "max:", Math.max(...scores).toFixed(2));

  const f = generateForecast(berg, now, 72);
  console.log("cone crossKm @0/24/48/72:", [0,24,48,72].map(h=>+f.cone.slices[h].crossKm.toFixed(1)));
  console.log("centre @72:", {lat:+f.centre[72].lat.toFixed(3), lon:+f.centre[72].lon.toFixed(3), reg:f.centre[72].regime});
}
main().finally(()=>p.$disconnect());
