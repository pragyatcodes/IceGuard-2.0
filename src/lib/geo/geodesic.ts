/**
 * Geodesy. Analysis L4: near the pole, 1° of longitude is tiny in kilometres,
 * so every score in ICEGUARD is a geodesic distance, never a degree delta.
 */

export const EARTH_RADIUS_KM = 6371.0088;
export const KM_PER_NM = 1.852; // exact by definition
export const NM_PER_KM = 1 / KM_PER_NM; // exact inverse, not a rounded literal

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

export interface LatLng {
  lat: number;
  lon: number;
}

/** Great-circle distance in kilometres (haversine). */
export function geodesicKm(a: LatLng, b: LatLng): number {
  const dLat = (b.lat - a.lat) * RAD;
  const dLon = (b.lon - a.lon) * RAD;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Initial bearing a → b in degrees clockwise from true north. */
export function bearingDeg(a: LatLng, b: LatLng): number {
  const φ1 = a.lat * RAD;
  const φ2 = b.lat * RAD;
  const Δλ = (b.lon - a.lon) * RAD;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) * DEG + 360) % 360;
}

/**
 * Move `distanceKm` along `bearingDeg` from a point. Uses the spherical
 * destination formula — accurate enough at the tens-of-kilometres scale of
 * a 72-hour berg drift, and it keeps latitude monotone near the pole.
 */
export function destination(from: LatLng, bearing: number, distanceKm: number): LatLng {
  const δ = distanceKm / EARTH_RADIUS_KM;
  const θ = bearing * RAD;
  const φ1 = from.lat * RAD;
  const λ1 = from.lon * RAD;

  const φ2 = Math.asin(
    Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ),
  );
  const λ2 =
    λ1 +
    Math.atan2(
      Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
      Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2),
    );

  let lon = ((λ2 * DEG + 540) % 360) - 180;
  let lat = φ2 * DEG;

  // Pole wrap: crossing the pole flips bearing and reflects latitude.
  if (lat > 90) {
    lat = 180 - lat;
    lon = (lon + 180) % 360;
    if (lon > 180) lon -= 360;
  } else if (lat < -90) {
    lat = -180 - lat;
    lon = (lon + 180) % 360;
    if (lon > 180) lon -= 360;
  }
  return { lat, lon };
}

/**
 * Shortest distance in km from point p to the segment a–b, on a locally flat
 * approximation. The corridors we score are short, so a local equirectangular
 * projection is both accurate and fast.
 */
export function pointToSegmentKm(p: LatLng, a: LatLng, b: LatLng): number {
  const cosLat = Math.cos(((a.lat + b.lat) / 2) * RAD);
  const ax = a.lon * cosLat;
  const ay = a.lat;
  const bx = b.lon * cosLat;
  const by = b.lat;
  const px = p.lon * cosLat;
  const py = p.lat;

  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));

  const cx = ax + t * dx;
  const cy = ay + t * dy;
  // (px, cx) are already in cosLat-scaled degree units, so the difference is a
  // plain degree delta — do NOT divide by cosLat again.
  const dLon = px - cx;
  const dLat = py - cy;
  return Math.hypot(dLon, dLat) * (Math.PI / 180) * EARTH_RADIUS_KM;
}

/** Interpolate a position `fraction` along a polyline (0..1 by arc length). */
export function interpolatePolyline(points: LatLng[], fraction: number): LatLng {
  if (points.length === 0) throw new Error("empty polyline");
  if (points.length === 1) return points[0];

  const legs: number[] = [];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const d = geodesicKm(points[i - 1], points[i]);
    legs.push(d);
    total += d;
  }
  if (total === 0) return points[0];

  let target = Math.max(0, Math.min(1, fraction)) * total;
  for (let i = 0; i < legs.length; i++) {
    if (target <= legs[i] || i === legs.length - 1) {
      const f = legs[i] === 0 ? 0 : target / legs[i];
      const a = points[i];
      const b = points[i + 1];
      return {
        lat: a.lat + (b.lat - a.lat) * f,
        lon: a.lon + (b.lon - a.lon) * f,
      };
    }
    target -= legs[i];
  }
  return points[points.length - 1];
}

export function polylineLengthKm(points: LatLng[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += geodesicKm(points[i - 1], points[i]);
  return total;
}

export function kmToNm(km: number): number {
  return km * NM_PER_KM;
}
export function nmToKm(nm: number): number {
  return nm * KM_PER_NM;
}

/**
 * Antarctic polar stereographic projection. Used for the canvas ops chart:
 * it keeps the pack-ice geometry recognisable and avoids the gross longitude
 * distortion a Mercator basemap would apply at 70°S.
 */
export function polarStereographic(
  p: LatLng,
  opts: { centerLat?: number; scaleKm?: number } = {},
): { x: number; y: number } {
  const centerLat = opts.centerLat ?? -72;
  const scaleKm = opts.scaleKm ?? 1;
  const φ = p.lat * RAD;
  const λ = p.lon * RAD;
  const φ0 = centerLat * RAD;

  // Standard parallel at the equator of projection; k scales to km.
  const k = 2 * EARTH_RADIUS_KM / (1 + Math.sin(φ0));
  const t = Math.tan(Math.PI / 4 + φ / 2);
  const t0 = Math.tan(Math.PI / 4 + φ0 / 2);
  const rho = k * t0 * (t / t0) * 0 + k * t;
  return {
    x: (rho * Math.sin(λ)) / scaleKm,
    y: (-rho * Math.cos(λ)) / scaleKm,
  };
}
