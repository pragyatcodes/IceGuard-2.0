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

/** Ice concentration → colour. Deep ocean → cyan → solid white pack. */
export function sicColor(sic: number, alpha = 1): string {
  const s = Math.max(0, Math.min(1, sic));
  if (s < 0.02) return `rgba(4, 12, 26, ${alpha})`;
  if (s < 0.15) {
    const t = s / 0.15;
    return `rgba(${8 + 10 * t}, ${38 + 40 * t}, ${72 + 50 * t}, ${alpha})`;
  }
  if (s < 0.4) {
    const t = (s - 0.15) / 0.25;
    return `rgba(${18 + 8 * t}, ${78 + 60 * t}, ${122 + 60 * t}, ${alpha})`;
  }
  if (s < 0.7) {
    const t = (s - 0.4) / 0.3;
    return `rgba(${26 + 60 * t}, ${138 + 60 * t}, ${182 + 40 * t}, ${alpha})`;
  }
  if (s < 0.9) {
    const t = (s - 0.7) / 0.2;
    return `rgba(${86 + 90 * t}, ${198 + 40 * t}, ${222 + 25 * t}, ${alpha})`;
  }
  const t = (s - 0.9) / 0.1;
  return `rgba(${176 + 74 * t}, ${238 + 17 * t}, ${247 + 8 * t}, ${alpha})`;
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

const ICE_STEP_PX = 5;

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
  if (s < 0.02) return [4, 12, 26];
  if (s < 0.15) {
    const t = s / 0.15;
    return [8 + 10 * t, 38 + 40 * t, 72 + 50 * t];
  }
  if (s < 0.4) {
    const t = (s - 0.15) / 0.25;
    return [18 + 8 * t, 78 + 60 * t, 122 + 60 * t];
  }
  if (s < 0.7) {
    const t = (s - 0.4) / 0.3;
    return [26 + 60 * t, 138 + 60 * t, 182 + 40 * t];
  }
  if (s < 0.9) {
    const t = (s - 0.7) / 0.2;
    return [86 + 90 * t, 198 + 40 * t, 222 + 25 * t];
  }
  const t = (s - 0.9) / 0.1;
  return [176 + 74 * t, 238 + 17 * t, 247 + 8 * t];
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

  // ---- Graticule -------------------------------------------------------
  if (layers.graticule) {
    ctx.strokeStyle = "rgba(143, 184, 222, 0.13)";
    ctx.lineWidth = 1;
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
    // Ice edge reference at 15% is drawn by the raster itself.
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
        ctx.font = "600 10px ui-sans-serif, system-ui, sans-serif";
        ctx.fillStyle = "rgba(242,248,255,0.92)";
        ctx.fillText(s.name, p.x + 7, p.y + 3);
      }
    }
  }

  // ---- Corridor --------------------------------------------------------
  if (layers.corridor && o.voyage?.corridor.length) {
    const cor = o.voyage.corridor;
    ctx.setLineDash([]);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = "rgba(242,248,255,0.55)";
    ctx.beginPath();
    cor.forEach((pt, i) => {
      const p = project(pt, w, h, view);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.stroke();

    // Ice load along the route, coloured by local SIC.
    if (o.voyage.perHour) {
      for (const s of o.voyage.perHour) {
        if (s.h % 3 !== 0) continue;
        const p = project({ lat: s.lat, lon: s.lon }, w, h, view);
        ctx.fillStyle = sicColor(Math.max(0.2, s.sic), 0.9);
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Waypoints
    for (const pt of cor) {
      const p = project(pt, w, h, view);
      ctx.fillStyle = "rgba(242,248,255,0.85)";
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.2, 0, Math.PI * 2);
      ctx.fill();
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
    const r = b.sizeClass === "GIANT" ? 8 : b.sizeClass === "LARGE" ? 6.5 : b.sizeClass === "MEDIUM" ? 5 : 4;

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
      ctx.font = "700 10px ui-monospace, monospace";
      ctx.fillStyle = "rgba(242,248,255,0.95)";
      const label = b.label ?? b.bergId;
      ctx.fillText(label, p.x + r + 5, p.y + 3.5);
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
    ctx.moveTo(0, -9);
    ctx.lineTo(6, 7);
    ctx.lineTo(0, 4);
    ctx.lineTo(-6, 7);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(3,7,17,0.9)";
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();

    // Pulse ring — the ship is the thing the officer is responsible for.
    ctx.strokeStyle = "rgba(242,248,255,0.35)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 14, 0, Math.PI * 2);
    ctx.stroke();
  }

  return cache;
}

function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
