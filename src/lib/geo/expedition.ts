import type { LatLng } from "./geodesic";

/**
 * Published ISEA (Indian Scientific Expedition to Antarctica) charter-vessel
 * transect: Cape Town → Bharati → Maitri → Cape Town (NCPOR voyage plans,
 * 39th–44th ISEA advertisements). Reference routing — not live AIS.
 * Leg I ≈ 10–12 d, Leg II ≈ 5–7 d, Leg III ≈ 8–12 d.
 */
export const ISEA_REFERENCE_ROUTE: LatLng[] = [
  { lat: -33.9, lon: 18.4 }, // Cape Town (port)
  { lat: -45.0, lon: 26.0 },
  { lat: -55.0, lon: 42.0 },
  { lat: -62.0, lon: 58.0 },
  { lat: -66.5, lon: 68.0 },
  { lat: -69.4, lon: 76.2 }, // Bharati, Larsemann Hills / Prydz Bay
  { lat: -68.5, lon: 60.0 },
  { lat: -67.5, lon: 45.0 },
  { lat: -68.5, lon: 28.0 },
  { lat: -69.8, lon: 11.9 }, // India Bay (Lazarev Sea), off Maitri
  { lat: -60.0, lon: 2.0 },
  { lat: -48.0, lon: 2.0 },
  { lat: -38.0, lon: 8.0 },
  { lat: -33.9, lon: 18.4 }, // back to Cape Town
];

export const CAPE_TOWN: LatLng = { lat: -33.9, lon: 18.4 };

export const ISEA_LEGS = [
  { name: "Leg I · Cape Town → Bharati", days: "10–12 d" },
  { name: "Leg II · Bharati → Maitri", days: "5–7 d" },
  { name: "Leg III · Maitri → Cape Town", days: "8–12 d" },
] as const;
