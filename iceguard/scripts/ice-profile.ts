import { PrismaClient } from "@prisma/client";
import { seaIceConcentration, iceThicknessM } from "@/lib/fields/forcing";
import { interpolatePolyline, polylineLengthKm } from "@/lib/geo/geodesic";
const p = new PrismaClient();
const NOW = new Date(Date.UTC(2026,0,18,6));
async function main(){
  const voyages = await p.voyage.findMany();
  for (const v of voyages) {
    const cor = JSON.parse(v.corridorJson);
    const L = polylineLengthKm(cor);
    console.log(`\n${v.code}  hull=${v.hullClass}  speed=${v.speedKt}kt  corridor=${L.toFixed(0)} km  72h reach=${(v.speedKt*1.852*72).toFixed(0)} km`);
    console.log("  h   lat     lon    SIC  thick(m)");
    let maxSic=0, maxTh=0, firstBlock1A:number|null=null, firstBlock1C:number|null=null;
    for (let h=0; h<=72; h+=6) {
      const f = Math.min(1, (v.speedKt*1.852*h)/L);
      const pt = interpolatePolyline(cor, f);
      const sic = seaIceConcentration(pt.lat, pt.lon, NOW.getTime()/1000 + h*3600);
      const th = iceThicknessM(pt.lat, pt.lon, NOW.getTime()/1000 + h*3600);
      maxSic=Math.max(maxSic,sic); maxTh=Math.max(maxTh,th);
      if (firstBlock1A===null && sic>=0.97 && th>=1.5) firstBlock1A=h;
      if (firstBlock1C===null && sic>=0.93 && th>=1.0) firstBlock1C=h;
      console.log(`  ${String(h).padStart(2)}  ${pt.lat.toFixed(2).padStart(6)} ${pt.lon.toFixed(2).padStart(6)}  ${sic.toFixed(2)}  ${th.toFixed(2)}`);
    }
    console.log(`  maxSIC=${maxSic.toFixed(2)} maxThick=${maxTh.toFixed(2)}m | block1A@${firstBlock1A} block1C@${firstBlock1C}`);
  }
}
main().finally(()=>p.$disconnect());
