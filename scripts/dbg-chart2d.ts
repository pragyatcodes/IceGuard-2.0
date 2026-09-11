/** Headless smoke test of the 2D polar renderer math (no DOM canvas). */
import { drawChart, project, DEFAULT_VIEW, DEFAULT_LAYERS } from "../src/lib/chart/polar";

let bad = 0;
let pts = 0;
const num = (v: unknown) => {
  if (typeof v === "number") {
    pts++;
    if (!Number.isFinite(v)) bad++;
  }
};
const ctx = new Proxy(
  {},
  {
    get(_t, prop) {
      if (prop === "measureText") return () => ({ width: 10 });
      return (...args: unknown[]) => {
        args.forEach((a) => {
          if (typeof a === "number") num(a);
          if (Array.isArray(a)) a.forEach(num);
        });
        return undefined;
      };
    },
    set() {
      return true;
    },
  },
) as unknown as CanvasRenderingContext2D;

const view = DEFAULT_VIEW;
const tracks = [
  {
    bergId: "A23a",
    regime: "OPEN",
    centre: [
      { lat: -59.4, lon: -33.2 },
      { lat: -60.1, lon: -32.0 },
      { lat: -60.8, lon: -30.9 },
    ],
    cone: [
      { lat: -60.9, lon: -31.4 },
      { lat: -60.2, lon: -30.2 },
      { lat: -61.2, lon: -30.0 },
    ],
    members: [],
  },
];
const voyage = {
  corridor: [
    { lat: -60, lon: 18 },
    { lat: -64, lon: 17.5 },
    { lat: -67.9, lon: 16.42 },
    { lat: -70.8, lon: 11.7 },
  ],
  ship: { lat: -62.3, lon: 17.6, headingDeg: 190 },
  perHour: [
    { h: 0, lat: -60, lon: 18, sic: 0.1 },
    { h: 3, lat: -61, lon: 17.8, sic: 0.4 },
    { h: 6, lat: -62, lon: 17.6, sic: 0.8 },
  ],
};
const bergs = [
  { bergId: "A23a", lat: -59.4, lon: -33.2, regime: "OPEN", sizeClass: "GIANT", selected: true },
  { bergId: "C-23", lat: -66.4, lon: 47.2, regime: "DRAG", sizeClass: "LARGE" },
  { bergId: "D-14", lat: -73.1, lon: -102.5, regime: "LOCK", sizeClass: "GIANT" },
];

drawChart(
  ctx,
  {
    width: 900,
    height: 640,
    view,
    layers: { ...DEFAULT_LAYERS, ice: false },
    bergs,
    tracks,
    voyage,
    hour: 12,
  },
  () => 0.5,
  null,
);

// Land polygon should surround the pole (centre of the chart).
const pole = project({ lat: -90, lon: 0 }, 900, 640, view);
const coastPt = project({ lat: -70, lon: 40 }, 900, 640, view);
console.log(`coords checked: ${pts}, non-finite: ${bad}`);
console.log(`pole at (${pole.x.toFixed(0)}, ${pole.y.toFixed(0)}) — expect (450, 320)`);
console.log(`coast sample at (${coastPt.x.toFixed(0)}, ${coastPt.y.toFixed(0)})`);
if (bad > 0) {
  console.error("FAIL: NaN/Infinity in draw coordinates");
  process.exit(1);
}
console.log("chart math OK");
