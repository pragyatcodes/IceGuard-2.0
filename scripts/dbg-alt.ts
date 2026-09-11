import { bearingDeg, destination, geodesicKm, nmToKm, polylineLengthKm, KM_PER_NM } from "../src/lib/geo/geodesic";
import type { LatLng } from "../src/lib/geo/geodesic";

async function main() {
  const voyages = await fetch("http://127.0.0.1:3000/api/voyages").then(r => r.json());
  const v = voyages.voyages.find((x: any) => x.code.includes("MAITRI"));
  const base: LatLng[] = v.corridor;
  const scoreA = await fetch(`http://127.0.0.1:3000/api/voyages/${v.id}/score`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ corridor: base }) }).then(r => r.json());
  const hazard = scoreA.score.hazards[0]?.bergId ?? "E-07"; // component falls back to selected berg
  console.log("baseline:", scoreA.score.light, "hazards:", scoreA.score.hazards.length);
  if (!hazard) { console.log("no hazard - nothing to avoid"); return; }
  const d = await fetch(`http://127.0.0.1:3000/api/icebergs/${hazard}`).then(r => r.json());
  const hz = Math.min(scoreA.score.hazards[0]?.h ?? 43, 72);
  const P: LatLng = d.forecast.centre[hz] ?? d.forecast.centre[0];
  const coneKm = d.forecast.cone.calibratedRadiusKm;

  let bi = 1, best = Infinity;
  for (let i = 1; i < base.length - 1; i++) { const dd = geodesicKm(base[i], P); if (dd < best) { best = dd; bi = i; } }
  const C = base[bi];
  const segB = bearingDeg(base[bi - 1], base[Math.min(bi + 1, base.length - 1)]);
  const rel = ((bearingDeg(C, P) - segB + 540) % 360) - 180;
  const away = segB + (rel > 0 ? -90 : 90);
  const off = coneKm + nmToKm(v.bufferNm) + 40;
  const corridor = [base[0], destination(C, away, off), destination(destination(C, segB, 150), away, off * 0.7), base[base.length - 1]];
  console.log("alt corridor finite:", corridor.every(p => Number.isFinite(p.lat) && Number.isFinite(p.lon)));

  const sb = await fetch(`http://127.0.0.1:3000/api/voyages/${v.id}/score`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ corridor }) }).then(r => r.json());
  const dA = polylineLengthKm(base), dB = polylineLengthKm(corridor);
  console.log(`A: ${scoreA.score.light} ${dA.toFixed(0)} km ${(dA/(v.speedKt*KM_PER_NM)).toFixed(1)}h clear=${scoreA.score.minClearanceKm.toFixed(1)}km`);
  console.log(`B: ${sb.score.light} ${dB.toFixed(0)} km ${(dB/(v.speedKt*KM_PER_NM)).toFixed(1)}h clear=${sb.score.minClearanceKm.toFixed(1)}km hazards=${sb.score.hazards.length}`);
}
main();
