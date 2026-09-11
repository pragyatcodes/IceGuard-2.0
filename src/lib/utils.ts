import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function fmt(n: number, d = 1): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-IN", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
}

export function fmtKm(km: number): string {
  if (!Number.isFinite(km)) return "—";
  if (km >= 1000) return `${(km / 1000).toFixed(1)}k km`;
  return `${km.toFixed(km < 10 ? 1 : 0)} km`;
}

export function pct(f: number, d = 0): string {
  return `${(f * 100).toFixed(d)}%`;
}

export function utcClock(d: Date): string {
  return d.toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

export function relAge(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  if (hours < 48) return `${Math.round(hours)} h`;
  return `${(hours / 24).toFixed(1)} d`;
}

export function latLon(lat: number, lon: number): string {
  const ns = lat < 0 ? "S" : "N";
  const ew = lon < 0 ? "W" : "E";
  return `${Math.abs(lat).toFixed(2)}°${ns} ${Math.abs(lon).toFixed(2)}°${ew}`;
}
