/**
 * Antarctic polar-stereographic renderer.
 *
 * Deliberately NOT MapLibre/Cesium with a tile service. Analysis §5.3 and L9
 * require a UI that survives a Bharati/Maitri link and keeps working when the
 * network does not: "We never require a 2 GB scene on the ice." A canvas
 * renderer driven by our own fields has zero external dependencies, renders
 * in a few milliseconds, and degrades to the lite layer set rather than to a
 * blank box.
 *
 * The projection keeps pack-ice geometry recognisable, which a Mercator
 * basemap at 70°S does not.
 */

export const RAD = Math.PI / 180;

export interface Pt {
  lat: number;
  lon: number;
}

export interface ViewState {
  /** Latitude that maps to the outer edge of the view. */
  edgeLat: number;
  /** Rotate the chart so this longitude points up. */
  centreLon: number;
}

export const DEFAULT_VIEW: ViewState = { edgeLat: -48, centreLon: 40 };

function rhoOf(lat: number): number {
  return Math.tan(Math.PI / 4 + (lat * RAD) / 2);
}

export function project(
  p: Pt,
  w: number,
  h: number,
  view: ViewState,
): { x: number; y: number } {
  const cx = w / 2;
  const cy = h / 2;
  const edge = rhoOf(view.edgeLat);
  const scale = (Math.min(w, h) / 2) * 0.96 / edge;
  const r = rhoOf(p.lat) * scale;
  const th = (p.lon - view.centreLon) * RAD;
  return { x: cx + r * Math.sin(th), y: cy - r * Math.cos(th) };
}

export function unproject(
  x: number,
  y: number,
  w: number,
  h: number,
  view: ViewState,
): Pt {
  const cx = w / 2;
  const cy = h / 2;
  const edge = rhoOf(view.edgeLat);
  const scale = (Math.min(w, h) / 2) * 0.96 / edge;
  const dx = (x - cx) / scale;
  const dy = -(y - cy) / scale;
  const r = Math.hypot(dx, dy);
  const lat = (2 * Math.atan(r) - Math.PI / 2) / RAD;
  const lon = (Math.atan2(dx, dy) / RAD + view.centreLon + 540) % 360 - 180;
  return { lat, lon };
}

/** Ice concentration → colour. Deep ocean → steel blue → pale pack.
 *  Top end is deliberately below pure white so overlays stay readable. */
export function sicColor(sic: number, alpha = 1): string {
  const [r, g, b] = sicToRgb(sic);
  return `rgba(${r | 0}, ${g | 0}, ${b | 0}, ${alpha})`;
}

export const REGIME_COLOR: Record<string, string> = {
  OPEN: "#38d3f5",
  DRAG: "#fbbf4a",
  LOCK: "#b79bff",
};

export const LIGHT_COLOR: Record<string, string> = {
  GO: "#34e39b",
  SLOW: "#fbbf4a",
  NO_GO: "#ff6b7d",
};

export interface ChartBerg {
  bergId: string;
  lat: number;
  lon: number;
  regime: string;
  sizeClass: string;
  selected?: boolean;
  label?: string;
}

export interface ChartTrack {
  bergId: string;
  regime: string;
  centre: Pt[];
  cone?: Pt[];
  members?: Pt[][];
  coneKm?: number;
}

export interface ChartVoyage {
  corridor: Pt[];
  ship?: Pt & { headingDeg: number };
  hazardHours?: { h: number; kind: string }[];
  perHour?: { h: number; lat: number; lon: number; sic: number }[];
}

export interface ChartLayers {
  ice: boolean;
  graticule: boolean;
  cones: boolean;
  tracks: boolean;
  members: boolean;
  corridor: boolean;
  labels: boolean;
  stations: boolean;
}

export const DEFAULT_LAYERS: ChartLayers = {
  ice: true,
  graticule: true,
  cones: true,
  tracks: true,
  members: false,
  corridor: true,
  labels: true,
  stations: true,
};

export const STATIONS: (Pt & { name: string })[] = [
  { lat: -69.4, lon: 76.1, name: "Bharati" },
  { lat: -70.8, lon: 11.7, name: "Maitri" },
];

export interface DrawOptions {
  width: number;
  height: number;
  view: ViewState;
  layers: ChartLayers;
  bergs: ChartBerg[];
  tracks: ChartTrack[];
  voyage?: ChartVoyage;
  /** Hours into the forecast the scrubber is on; drives the ship and highlight. */
  hour?: number;
  iceAt?: (lat: number, lon: number) => number;
  dpr?: number;
  /** Ice raster is cached on an offscreen canvas keyed by view. */
  iceCache?: { key: string; canvas: HTMLCanvasElement } | null;
}

const ICE_STEP_PX = 3;

function buildIceLayer(
  width: number,
  height: number,
  view: ViewState,
  iceAt: (lat: number, lon: number) => number,
): HTMLCanvasElement {
  const sw = Math.ceil(width / ICE_STEP_PX);
  const sh = Math.ceil(height / ICE_STEP_PX);
  const c = document.createElement("canvas");
  c.width = sw;
  c.height = sh;
  const ctx = c.getContext("2d");
  if (!ctx) return c;
  const img = ctx.createImageData(sw, sh);

  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const p = unproject(x * ICE_STEP_PX, y * ICE_STEP_PX, width, height, view);
      const i = (y * sw + x) * 4;
      if (p.lat > -40) {
        img.data[i] = 3;
        img.data[i + 1] = 7;
        img.data[i + 2] = 17;
        img.data[i + 3] = 255;
        continue;
      }
      const sic = iceAt(p.lat, p.lon);
      const rgb = sicToRgb(sic);
      img.data[i] = rgb[0];
      img.data[i + 1] = rgb[1];
      img.data[i + 2] = rgb[2];
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function sicToRgb(sic: number): [number, number, number] {
  const s = Math.max(0, Math.min(1, sic));
  const lerp = (a: number[], b: number[], t: number) =>
    [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  if (s < 0.02) return [4, 10, 22];
  if (s < 0.15) return lerp([6, 20, 40], [10, 42, 70], s / 0.15) as [number, number, number];
  if (s < 0.4) return lerp([10, 42, 70], [16, 74, 116], (s - 0.15) / 0.25) as [number, number, number];
  if (s < 0.7) return lerp([16, 74, 116], [38, 124, 168], (s - 0.4) / 0.3) as [number, number, number];
  if (s < 0.9) return lerp([38, 124, 168], [110, 190, 224], (s - 0.7) / 0.2) as [number, number, number];
  return lerp([110, 190, 224], [222, 242, 252], (s - 0.9) / 0.1) as [number, number, number];
}

/** Generalised Antarctic coastline ([lon, lat] every ~5–10°), incl. the
 *  Peninsula spike and the Weddell/Ross embayments. Drawn over the ice
 *  raster so the continent reads as land, not as a glowing white blob. */
const COAST: [number, number][] = [
  [-180, -78], [-170, -76.5], [-160, -75], [-150, -73.5], [-140, -69],
  [-130, -66.5], [-120, -66], [-110, -67.5], [-100, -69.5], [-90, -70.5],
  [-80, -70.5], [-72, -70], [-66, -67.5], [-62, -64.5], [-59, -63.5],
  [-57, -64.5], [-55, -67], [-52, -70], [-48, -73], [-44, -76],
  [-38, -77.5], [-30, -75.5], [-20, -72], [-10, -71], [0, -70],
  [10, -69.5], [20, -70], [30, -68.5], [40, -67.5], [50, -66.5],
  [60, -66.5], [68, -68], [73, -68.5], [78, -67], [85, -66.5],
  [95, -66], [105, -66], [115, -66], [125, -66.5], [135, -65.5],
  [145, -66.5], [155, -69], [165, -71.5], [175, -74], [180, -78],
];

function haloText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  font: string,
  fill = "rgba(240, 248, 255, 0.95)",
): void {
  ctx.font = font;
  ctx.lineJoin = "round";
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(3, 7, 17, 0.85)";
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

export function viewKey(view: ViewState, w: number, h: number): string {
  return `${view.edgeLat}|${view.centreLon}|${w}|${h}`;
}

export function drawChart(
  ctx: CanvasRenderingContext2D,
  o: DrawOptions,
  iceAt: (lat: number, lon: number) => number,
  iceCache: { key: string; canvas: HTMLCanvasElement } | null,
): { key: string; canvas: HTMLCanvasElement } | null {
  const { width: w, height: h, view, layers } = o;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#030711";
  ctx.fillRect(0, 0, w, h);

  const key = viewKey(view, w, h);
  let cache = iceCache && iceCache.key === key ? iceCache : null;

  if (layers.ice) {
    if (!cache) cache = { key, canvas: buildIceLayer(w, h, view, iceAt) };
    ctx.imageSmoothingEnabled = true;
    ctx.globalAlpha = 0.95;
    ctx.drawImage(cache.canvas, 0, 0, w, h);
    ctx.globalAlpha = 1;
  }

  // ---- Land mask (generalised coastline) -------------------------------
  // Drawn OVER the raster: the continent reads as land instead of a
  // saturated white pack, and everything on top of it stays legible.
  ctx.beginPath();
  COAST.forEach(([lon, lat], i) => {
    const p = project({ lat, lon }, w, h, view);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.closePath();
  ctx.fillStyle = "#0c1a2c";
  ctx.fill();
  ctx.strokeStyle = "rgba(170, 215, 245, 0.5)";
  ctx.lineWidth = 1.2;
  ctx.stroke();
  haloText(
    ctx,
    "ANTARCTICA",
    w / 2 - 33,
    h / 2 + 3,
    "700 9px ui-sans-serif, system-ui, sans-serif",
    "rgba(150, 195, 230, 0.55)",
  );

  // ---- Graticule -------------------------------------------------------
  // Dual-tone: dark pass stays visible on bright pack, light pass on ocean.
  if (layers.graticule) {
    const pass = (stroke: string, width: number) => {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = width;
      for (let lat = -80; lat <= -50; lat += 5) {
        ctx.beginPath();
        for (let lon = -180; lon <= 180; lon += 3) {
          const p = project({ lat, lon }, w, h, view);
          if (lon === -180) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
      }
      for (let lon = -180; lon < 180; lon += 30) {
        const a = project({ lat: -85, lon }, w, h, view);
        const b = project({ lat: -48, lon }, w, h, view);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    };
    pass("rgba(6, 12, 24, 0.55)", 1.3);
    pass("rgba(160, 205, 240, 0.22)", 0.7);

    // Ring + meridian labels with halo so they survive any background.
    const lblFont = "600 10px ui-monospace, monospace";
    for (const lat of [-60, -70, -80]) {
      const p = project({ lat, lon: view.centreLon }, w, h, view);
      haloText(ctx, `${-lat}°S`, p.x + 5, p.y - 4, lblFont, "rgba(205, 230, 250, 0.85)");
    }
    for (let lon = -150; lon <= 180; lon += 30) {
      const p = project({ lat: view.edgeLat + 3, lon }, w, h, view);
      const t =
        lon === 0 ? "0°" : lon === 180 ? "180°" : lon > 0 ? `${lon}°E` : `${-lon}°W`;
      haloText(ctx, t, p.x - 9, p.y + 6, lblFont, "rgba(205, 230, 250, 0.8)");
    }
  }

  // ---- Stations --------------------------------------------------------
  if (layers.stations) {
    for (const s of STATIONS) {
      const p = project(s, w, h, view);
      ctx.fillStyle = "#f2f8ff";
      ctx.beginPath();
      ctx.rect(p.x - 3.5, p.y - 3.5, 7, 7);
      ctx.fill();
      ctx.strokeStyle = "rgba(3,7,17,0.9)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      if (layers.labels) {
        haloText(ctx, `⚑ ${s.name}`, p.x + 7, p.y + 3, "700 10px ui-sans-serif, system-ui, sans-serif");
      }
    }
  }

  // ---- Corridor --------------------------------------------------------
  if (layers.corridor && o.voyage?.corridor.length) {
    const cor = o.voyage.corridor;
    const tracePath = () => {
      ctx.beginPath();
      cor.forEach((pt, i) => {
        const p = project(pt, w, h, view);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
    };
    // Cased line: dark underlay keeps it readable on bright pack.
    ctx.setLineDash([]);
    tracePath();
    ctx.lineWidth = 5;
    ctx.strokeStyle = "rgba(3,7,17,0.75)";
    ctx.stroke();
    tracePath();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(242,248,255,0.9)";
    ctx.setLineDash([7, 5]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Ice load along the route, coloured by local SIC.
    if (o.voyage.perHour) {
      for (const s of o.voyage.perHour) {
        if (s.h % 3 !== 0) continue;
        const p = project({ lat: s.lat, lon: s.lon }, w, h, view);
        ctx.fillStyle = sicColor(Math.max(0.2, s.sic), 0.95);
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(3,7,17,0.8)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    // Waypoints
    for (const pt of cor) {
      const p = project(pt, w, h, view);
      ctx.fillStyle = "rgba(242,248,255,0.95)";
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(3,7,17,0.9)";
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
  }

  // ---- Cones -----------------------------------------------------------
  if (layers.cones) {
    for (const t of o.tracks) {
      if (!t.cone || t.cone.length < 3) continue;
      const color = REGIME_COLOR[t.regime] ?? "#38d3f5";
      ctx.beginPath();
      t.cone.forEach((pt, i) => {
        const p = project(pt, w, h, view);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.closePath();
      ctx.fillStyle = hexA(color, 0.16);
      ctx.fill();
      ctx.strokeStyle = hexA(color, 0.55);
      ctx.lineWidth = 1.2;
      ctx.setLineDash([4, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // ---- Ensemble members (the "show your work" layer) --------------------
  if (layers.members) {
    ctx.strokeStyle = "rgba(125, 232, 255, 0.16)";
    ctx.lineWidth = 0.7;
    for (const t of o.tracks) {
      for (const m of t.members ?? []) {
        ctx.beginPath();
        m.forEach((pt, i) => {
          const p = project(pt, w, h, view);
          if (i === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        });
        ctx.stroke();
      }
    }
  }

  // ---- Centre-line tracks ----------------------------------------------
  if (layers.tracks) {
    for (const t of o.tracks) {
      const color = REGIME_COLOR[t.regime] ?? "#38d3f5";
      ctx.strokeStyle = hexA(color, 0.95);
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      t.centre.forEach((pt, i) => {
        const p = project(pt, w, h, view);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // ---- Bergs -----------------------------------------------------------
  for (const b of o.bergs) {
    const p = project(b, w, h, view);
    const color = REGIME_COLOR[b.regime] ?? "#38d3f5";
    const r = b.sizeClass === "GIANT" ? 10 : b.sizeClass === "LARGE" ? 8 : b.sizeClass === "MEDIUM" ? 6.5 : 5.5;

    if (b.selected) {
      ctx.strokeStyle = hexA(color, 0.5);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r + 7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = hexA(color, 0.14);
      ctx.beginPath();
      ctx.arc(p.x, p.y, r + 7, 0, Math.PI * 2);
      ctx.fill();
    }

    // Iceberg glyph: a triangle above a deeper keel line.
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - r);
    ctx.lineTo(p.x + r * 0.92, p.y + r * 0.5);
    ctx.lineTo(p.x - r * 0.92, p.y + r * 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(3,7,17,0.85)";
    ctx.lineWidth = 1.2;
    ctx.stroke();

    if (layers.labels) {
      const label = b.label ?? b.bergId;
      haloText(ctx, label, p.x + r + 6, p.y + 4, "700 11px ui-monospace, monospace");
      haloText(
        ctx,
        b.sizeClass.toLowerCase(),
        p.x + r + 6,
        p.y + 15,
        "600 8.5px ui-monospace, monospace",
        "rgba(180, 210, 235, 0.85)",
      );
    }
  }

  // ---- Ship ------------------------------------------------------------
  if (layers.corridor && o.voyage?.ship) {
    const s = o.voyage.ship;
    const p = project(s, w, h, view);
    const th = (s.headingDeg - view.centreLon) * RAD;

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(th);
    ctx.fillStyle = "#f2f8ff";
    ctx.beginPath();
    ctx.moveTo(0, -11);
    ctx.lineTo(7, 8);
    ctx.lineTo(0, 5);
    ctx.lineTo(-7, 8);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(3,7,17,0.9)";
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.restore();

    // Pulse ring — the ship is the thing the officer is responsible for.
    ctx.strokeStyle = "rgba(242,248,255,0.4)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 16, 0, Math.PI * 2);
    ctx.stroke();
    if (layers.labels) {
      haloText(ctx, "your ship", p.x + 14, p.y + 4, "700 10px ui-monospace, monospace");
    }
  }

  return cache;
}

function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
