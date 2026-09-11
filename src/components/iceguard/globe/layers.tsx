"use client";
/**
 * ICEGUARD layers drawn inside the Globe3D scene: corridor arcs, the selected
 * berg's observed track + 72 h centre line (horizontally exaggerated so a
 * ~100 km drift is visible on a planet-scale globe), the conformal cone as a
 * translucent funnel, and the animated ship of the viewing captain.
 */
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { Html, Line } from "@react-three/drei";
import { useMemo, useState } from "react";
import { EARTH_RADIUS_KM, latLngToVector3 } from "@/components/ui/3d-globe";
import {
  KM_PER_NM,
  bearingDeg,
  interpolatePolyline,
  polylineLengthKm,
} from "@/lib/geo/geodesic";
import type { LatLng } from "@/lib/geo/geodesic";

/** Horizontal exaggeration for drift tracks — labelled in the UI legend. */
export const TRACK_EXAGGERATION = 25;

export const kmToUnits = (km: number, R: number) => (km / EARTH_RADIUS_KM) * R;

function exagLatLng(anchor: LatLng, p: LatLng, K: number): LatLng {
  return {
    lat: anchor.lat + (p.lat - anchor.lat) * K,
    lon: anchor.lon + (p.lon - anchor.lon) * K,
  };
}

/* ---------------------------------------------------------------- pin art */

const svgUri = (svg: string) => `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;

export function bergIcon(color: string): string {
  return svgUri(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="14.5" fill="#060d1c" stroke="${color}" stroke-width="2.5"/><path d="M16 6.5 L24 20 L20 18 L16 25.5 L12 18 L8 20 Z" fill="#eaf6ff"/><path d="M16 6.5 L24 20 L20 18 L16 25.5 Z" fill="#9cc4e8"/></svg>`,
  );
}

export function shipIcon(): string {
  return svgUri(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="14.5" fill="#060d1c" stroke="#f2f8ff" stroke-width="2.5"/><path d="M16 7 L22 24 L16 20 L10 24 Z" fill="#7de8ff"/></svg>`,
  );
}

export function stationIcon(): string {
  return svgUri(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="14.5" fill="#060d1c" stroke="#34e39b" stroke-width="2.5"/><rect x="10" y="14" width="12" height="8" rx="1.5" fill="#34e39b"/><path d="M16 14 V8 M13 10.5 H19" stroke="#34e39b" stroke-width="2"/></svg>`,
  );
}

/* ------------------------------------------------------------------ arcs */

export function ArcLine({
  points,
  R,
  lift = 1.012,
  color = "#38d3f5",
  width = 2,
  dashed = false,
  opacity = 1,
}: {
  points: LatLng[];
  R: number;
  lift?: number;
  color?: string;
  width?: number;
  dashed?: boolean;
  opacity?: number;
}) {
  const pts = useMemo(
    () => points.map((p) => latLngToVector3(p.lat, p.lon, R * lift)),
    [points, R, lift],
  );
  if (pts.length < 2) return null;
  return (
    <Line
      points={pts}
      color={color}
      lineWidth={width}
      dashed={dashed}
      transparent
      opacity={opacity}
    />
  );
}

/* ------------------------------------------------- exaggerated track pair */

export function TrackLayer({
  anchor,
  history,
  centre,
  R,
  K = TRACK_EXAGGERATION,
  detail,
}: {
  anchor: LatLng;
  history: LatLng[];
  centre: { t: number; lat: number; lon: number }[];
  R: number;
  K?: number;
  detail: boolean;
}) {
  const hPts = useMemo(
    () => history.map((p) => latLngToVector3(exagLatLng(anchor, p, K).lat, exagLatLng(anchor, p, K).lon, R * 1.012)),
    [anchor, history, K, R],
  );
  const cPts = useMemo(
    () => centre.map((p) => latLngToVector3(exagLatLng(anchor, p, K).lat, exagLatLng(anchor, p, K).lon, R * 1.014)),
    [anchor, centre, K, R],
  );
  const ticks = useMemo(() => centre.filter((c) => c.t === 24 || c.t === 48 || c.t === 72), [centre]);

  return (
    <group>
      {hPts.length > 1 && (
        <Line points={hPts} color="#8fb8de" lineWidth={1.4} dashed transparent opacity={0.8} />
      )}
      {cPts.length > 1 && <Line points={cPts} color="#38d3f5" lineWidth={2.4} />}
      {detail &&
        ticks.map((c) => {
          const p = latLngToVector3(exagLatLng(anchor, c, K).lat, exagLatLng(anchor, c, K).lon, R * 1.016);
          return (
            <group key={c.t} position={p}>
              <mesh>
                <sphereGeometry args={[0.012, 12, 12]} />
                <meshBasicMaterial color="#7de8ff" />
              </mesh>
              <Html center sprite distanceFactor={9} style={{ pointerEvents: "none" }}>
                <div className="whitespace-nowrap rounded-md border border-glacier-400/40 bg-abyss-950/85 px-1.5 py-0.5 font-mono text-[10px] text-glacier-300 backdrop-blur">
                  T+{c.t} h
                </div>
              </Html>
            </group>
          );
        })}
    </group>
  );
}

/* --------------------------------------------------- conformal cone funnel */

export function ConeFunnel({
  anchor,
  centre,
  calibKm,
  R,
  K = TRACK_EXAGGERATION,
}: {
  anchor: LatLng;
  centre: { t: number; lat: number; lon: number }[];
  calibKm: number;
  R: number;
  K?: number;
}) {
  const geo = useMemo(() => {
    const samples = centre.filter((c, i) => i % 6 === 0 || i === centre.length - 1);
    if (samples.length < 2) return null;
    const M = 20;
    const positions: number[] = [];
    const indices: number[] = [];

    samples.forEach((c) => {
      const rKm = Math.max(1.5, calibKm * Math.sqrt(c.t / 72));
      const r = Math.max(kmToUnits(rKm, R) * K, 0.007);
      const e = exagLatLng(anchor, c, K);
      const base = latLngToVector3(e.lat, e.lon, R * 1.013);
      const n = base.clone().normalize();
      const up = Math.abs(n.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
      const e1 = new THREE.Vector3().crossVectors(up, n).normalize();
      const e2 = new THREE.Vector3().crossVectors(n, e1).normalize();
      for (let m = 0; m < M; m++) {
        const th = (m / M) * Math.PI * 2;
        const v = base
          .clone()
          .add(e1.clone().multiplyScalar(Math.cos(th) * r))
          .add(e2.clone().multiplyScalar(Math.sin(th) * r));
        positions.push(v.x, v.y, v.z);
      }
    });

    for (let s = 0; s < samples.length - 1; s++) {
      for (let m = 0; m < M; m++) {
        const a = s * M + m;
        const b = s * M + ((m + 1) % M);
        const c = (s + 1) * M + m;
        const d = (s + 1) * M + ((m + 1) % M);
        indices.push(a, c, b, b, c, d);
      }
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    g.setIndex(indices);
    g.computeVertexNormals();
    return g;
  }, [anchor, centre, calibKm, R, K]);

  if (!geo) return null;
  return (
    <mesh geometry={geo}>
      <meshBasicMaterial
        color="#9270f0"
        transparent
        opacity={0.16}
        side={THREE.DoubleSide}
        depthWrite={false}
      />
    </mesh>
  );
}

/* ------------------------------------------------------- animated captain */

export function ShipActor({
  corridor,
  speedKt,
  hour,
  R,
  showLabel,
}: {
  corridor: LatLng[];
  speedKt: number;
  hour: number;
  R: number;
  showLabel: boolean;
}) {
  const [curKm, setCurKm] = useState(0);
  const total = useMemo(() => polylineLengthKm(corridor), [corridor]);

  useFrame((_, dt) => {
    const target = Math.min(Math.max(hour, 0) * speedKt * KM_PER_NM, total);
    setCurKm((c) => {
      const next = c + (target - c) * Math.min(1, dt * 3);
      return Math.abs(next - c) < 0.01 ? target : next;
    });
  });

  const frac = total > 0 ? Math.min(1, curKm / total) : 0;
  const pos = interpolatePolyline(corridor, frac);
  const ahead = interpolatePolyline(corridor, Math.min(1, frac + 0.02));
  const pV = latLngToVector3(pos.lat, pos.lon, R * 1.015);
  const dir = latLngToVector3(ahead.lat, ahead.lon, R * 1.015).sub(pV).normalize();
  const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);

  const wakePts = useMemo(() => {
    const from = Math.max(0, frac - 80 / Math.max(total, 1));
    return [0.25, 0.5, 0.75, 1].map((f) => {
      const w = interpolatePolyline(corridor, from + (frac - from) * f);
      return latLngToVector3(w.lat, w.lon, R * 1.014);
    });
  }, [corridor, frac, total, R]);

  return (
    <group>
      <mesh position={pV} quaternion={quat}>
        <coneGeometry args={[0.014, 0.055, 4]} />
        <meshBasicMaterial color="#f2f8ff" />
      </mesh>
      <Line points={wakePts} color="#7de8ff" lineWidth={1.6} transparent opacity={0.6} />
      {showLabel && (
        <Html position={[pV.x, pV.y + 0.06, pV.z]} center style={{ pointerEvents: "none" }}>
          <div className="whitespace-nowrap rounded-md border border-frost-400/30 bg-abyss-950/85 px-1.5 py-0.5 font-mono text-[10px] text-frost-100 backdrop-blur">
            your ship · {Math.round(curKm)} km
          </div>
        </Html>
      )}
    </group>
  );
}

/* ------------------------------------- zoom gate for fine detail labels */

export function useZoomed(threshold: number): boolean {
  const { camera } = useThree();
  const [z, setZ] = useState(false);
  useFrame(() => {
    const d = camera.position.length();
    if (!z && d < threshold) setZ(true);
    else if (z && d > threshold * 1.15) setZ(false);
  });
  return z;
}

export { bearingDeg };
