"use client";
/**
 * The 3D operations globe: Earth with berg pins, corridors as 3D arcs, the
 * selected berg's exaggerated track + conformal cone funnel, the animated
 * ship of the viewing captain, and a Google-Maps-style route comparison
 * (baseline corridor vs a suggested alternate) with live time/distance
 * deltas scored by the same engine that drives the verdict badge.
 */
import * as React from "react";
import { Globe3D, type GlobeMarker } from "@/components/ui/3d-globe";
import {
  ArcLine,
  ConeFunnel,
  ShipActor,
  TrackLayer,
  bergIcon,
  shipIcon,
  stationIcon,
  useZoomed,
} from "@/components/iceguard/globe/layers";
import { destination, bearingDeg, geodesicKm, nmToKm, polylineLengthKm, KM_PER_NM } from "@/lib/geo/geodesic";
import type { LatLng } from "@/lib/geo/geodesic";
import { Badge } from "@/components/ui/primitives";
import { fmt } from "@/lib/utils";

const R = 2;

const REGIME_PIN: Record<string, string> = {
  OPEN: "#38d3f5",
  DRAG: "#fbbf4a",
  LOCK: "#b79bff",
};

const STATIONS = [
  { lat: -69.4, lon: 76.1, label: "Bharati" },
  { lat: -70.8, lon: 11.7, label: "Maitri" },
];

export interface GlobeBerg {
  bergId: string;
  lat: number;
  lon: number;
  sizeClass: string;
  regime: string;
}
export interface GlobeDetail {
  berg: { bergId: string; lat: number; lon: number };
  history: { lat: number; lon: number }[];
  forecast: {
    centre: { t: number; lat: number; lon: number }[];
    cone: { calibratedRadiusKm: number };
  };
}
export interface GlobeVoyage {
  id: string;
  code: string;
  name: string;
  speedKt: number;
  bufferNm: number;
  corridor: LatLng[];
}
export interface GlobeScore {
  score: {
    light: string;
    hazards: { bergId: string; h: number; clearanceKm: number; kind: string }[];
    minClearanceKm: number;
  };
}

interface RouteOption {
  light: string;
  distanceKm: number;
  hours: number;
  hazards: number;
  minClearanceKm: number;
}
interface AltState {
  corridor: LatLng[];
  a: RouteOption;
  b: RouteOption;
}

function ZoomGatedLayers(props: {
  detail: GlobeDetail | null;
  voyage: GlobeVoyage | null;
  voyages: GlobeVoyage[];
  selectedCorridor: LatLng[];
  score: GlobeScore | null;
  hour: number;
  alt: AltState | null;
}) {
  const zoomed = useZoomed(3.1);
  const { detail, voyage, voyages, selectedCorridor, score, hour, alt } = props;

  return (
    <>
      {voyages.map((v) => (
        <ArcLine
          key={v.id}
          points={v.id === voyage?.id ? selectedCorridor : v.corridor}
          R={R}
          color={v.id === voyage?.id ? "#38d3f5" : "#5f90bd"}
          width={v.id === voyage?.id ? 2.2 : 1.2}
          dashed={v.id !== voyage?.id}
          opacity={v.id === voyage?.id ? 0.95 : 0.45}
        />
      ))}

      {alt && (
        <ArcLine points={alt.corridor} R={R} lift={1.02} color="#fbbf4a" width={2.4} />
      )}

      {detail && (
        <>
          <TrackLayer
            anchor={{ lat: detail.berg.lat, lon: detail.berg.lon }}
            history={detail.history}
            centre={detail.forecast.centre}
            R={R}
            detail={zoomed}
          />
          <ConeFunnel
            anchor={{ lat: detail.berg.lat, lon: detail.berg.lon }}
            centre={detail.forecast.centre}
            calibKm={detail.forecast.cone.calibratedRadiusKm}
            R={R}
          />
        </>
      )}

      {voyage && (
        <ShipActor
          corridor={selectedCorridor}
          speedKt={voyage.speedKt}
          hour={hour}
          R={R}
          showLabel={zoomed}
        />
      )}
    </>
  );
}

export function GlobeMap({
  bergs,
  voyages,
  selectedBergId,
  onSelectBerg,
  detail,
  voyage,
  score,
  activeCorridor,
  hour,
  onApplyCorridor,
}: {
  bergs: GlobeBerg[];
  voyages: GlobeVoyage[];
  selectedBergId: string | null;
  onSelectBerg: (id: string) => void;
  detail: GlobeDetail | null;
  voyage: GlobeVoyage | null;
  score: GlobeScore | null;
  activeCorridor: LatLng[];
  hour: number;
  onApplyCorridor: (c: LatLng[]) => void;
}) {
  const [alt, setAlt] = React.useState<AltState | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);

  React.useEffect(() => setAlt(null), [voyage?.id, activeCorridor]);

  const markers: GlobeMarker[] = React.useMemo(
    () => [
      ...bergs.map((b) => ({
        lat: b.lat,
        lng: b.lon,
        src: bergIcon(REGIME_PIN[b.regime] ?? "#38d3f5"),
        label: `${b.bergId} · ${b.sizeClass}`,
        color: REGIME_PIN[b.regime] ?? "#38d3f5",
        size: b.sizeClass === "GIANT" ? 26 : b.sizeClass === "LARGE" ? 22 : 18,
      })),
      ...STATIONS.map((s) => ({
        lat: s.lat,
        lng: s.lon,
        src: stationIcon(),
        label: s.label,
        color: "#34e39b",
        size: 16,
      })),
    ],
    [bergs],
  );

  async function suggestAlternate() {
    if (!voyage || !score) return;
    setBusy(true);
    setNotice(null);
    try {
      const hazard = score.score.hazards[0]?.bergId ?? selectedBergId;
      if (!hazard) {
        setNotice("No hazard on this corridor — the optimiser has nothing to avoid.");
        return;
      }
      const r = await fetch(`/api/icebergs/${encodeURIComponent(hazard)}`);
      const d = await r.json();
      const hz = Math.min(score.score.hazards[0]?.h ?? 48, 72);
      const P: LatLng = d.forecast.centre[Math.min(hz, 72)] ?? d.forecast.centre[0];
      const coneKm = d.forecast.cone.calibratedRadiusKm as number;

      const base = activeCorridor;
      let bi = 1;
      let best = Infinity;
      for (let i = 1; i < base.length - 1; i++) {
        const dd = geodesicKm(base[i], P);
        if (dd < best) {
          best = dd;
          bi = i;
        }
      }
      const C = base[bi];
      const segB = bearingDeg(base[bi - 1], base[Math.min(bi + 1, base.length - 1)]);
      const bToP = bearingDeg(C, P);
      const rel = ((bToP - segB + 540) % 360) - 180;
      const away = segB + (rel > 0 ? -90 : 90);
      const off = coneKm + nmToKm(voyage.bufferNm) + 40;

      const wp1 = destination(C, away, off);
      const wp2 = destination(destination(C, segB, 150), away, off * 0.7);
      const corridor = [base[0], wp1, wp2, base[base.length - 1]];

      const [sa, sb] = await Promise.all([
        fetch(`/api/voyages/${voyage.id}/score`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ corridor: base }),
        }).then((x) => x.json()),
        fetch(`/api/voyages/${voyage.id}/score`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ corridor }),
        }).then((x) => x.json()),
      ]);

      const opt = (s: typeof sa, c: LatLng[]): RouteOption => ({
        light: s.score.light,
        distanceKm: polylineLengthKm(c),
        hours: polylineLengthKm(c) / (voyage.speedKt * KM_PER_NM),
        hazards: s.score.hazards.length,
        minClearanceKm: s.score.minClearanceKm,
      });

      setAlt({ corridor, a: opt(sa, base), b: opt(sb, corridor) });
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "alternate route failed");
    } finally {
      setBusy(false);
    }
  }

  const lightTone = (l: string) => (l === "GO" ? "green" : l === "SLOW" ? "amber" : "red") as "green" | "amber" | "red";

  return (
    <div className="relative h-full w-full">
      <Globe3D
        className="h-full w-full"
        markers={markers}
        onMarkerClick={(m) => {
          const b = bergs.find((x) => m.label?.startsWith(x.bergId));
          if (b) onSelectBerg(b.bergId);
        }}
        config={{
          atmosphereColor: "#38d3f5",
          atmosphereIntensity: 1.1,
          atmosphereBlur: 2.4,
          showAtmosphere: true,
          bumpScale: 2,
          autoRotateSpeed: 0.25,
          enableZoom: true,
          enablePan: false,
          minDistance: 2.25,
          maxDistance: 9,
          showWireframe: false,
          markerSize: 0.18,
        }}
      >
        <ZoomGatedLayers
          detail={detail}
          voyage={voyage}
          voyages={voyages}
          selectedCorridor={activeCorridor}
          score={score}
          hour={hour}
          alt={alt}
        />
      </Globe3D>

      {/* legend + hints */}
      <div className="pointer-events-none absolute left-3 top-3 flex flex-col gap-1.5">
        <div className="rounded-lg border border-frost-400/15 bg-abyss-950/80 px-2.5 py-1.5 text-[10px] text-frost-300 backdrop-blur">
          <span className="font-bold text-frost-100">3D globe</span> · drag to orbit · scroll to
          zoom · pins at true position
        </div>
        <div className="rounded-lg border border-frost-400/15 bg-abyss-950/80 px-2.5 py-1.5 text-[10px] text-frost-400 backdrop-blur">
          drift tracks ×25 exaggeration · cone = 90% conformal · ship synced to scrubber
        </div>
      </div>

      {/* route comparison — Google-Maps style */}
      {voyage && (
        <div className="absolute bottom-3 left-3 w-72">
          {alt ? (
            <div className="glass rounded-xl p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-frost-300">
                  Routes · {voyage.code}
                </span>
                <button
                  type="button"
                  onClick={() => setAlt(null)}
                  className="text-[10px] text-frost-500 hover:text-frost-200"
                >
                  dismiss
                </button>
              </div>

              {(["a", "b"] as const).map((k) => {
                const o = alt[k];
                return (
                  <div
                    key={k}
                    className={`mb-1.5 rounded-lg border px-2.5 py-2 ${
                      k === "a" ? "border-glacier-400/30 bg-glacier-500/10" : "border-slow-400/30 bg-slow-500/10"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[11px] font-bold text-frost-50">
                        {k === "a" ? "A · current" : "B · alternate"}
                      </span>
                      <Badge tone={lightTone(o.light)}>{o.light === "NO_GO" ? "NO-GO" : o.light}</Badge>
                    </div>
                    <div className="mt-1 grid grid-cols-3 gap-1 font-mono text-[10px] tabular-nums text-frost-200">
                      <span>{fmt(o.distanceKm, 0)} km</span>
                      <span>{fmt(o.hours, 1)} h</span>
                      <span>{o.hazards} haz</span>
                    </div>
                  </div>
                );
              })}

              <p className="mb-2 font-mono text-[10px] text-frost-400">
                Δ {fmt(alt.b.distanceKm - alt.a.distanceKm, 0)} km ·{" "}
                {fmt(alt.b.hours - alt.a.hours, 1)} h · clearance{" "}
                {fmt(alt.a.minClearanceKm, 0)}→{fmt(alt.b.minClearanceKm, 0)} km
              </p>

              <button
                type="button"
                onClick={() => {
                  onApplyCorridor(alt.corridor);
                  setAlt(null);
                }}
                className="w-full rounded-lg bg-glacier-500 px-3 py-1.5 text-[11px] font-bold text-abyss-950 hover:bg-glacier-400"
              >
                Apply alternate corridor
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={suggestAlternate}
              disabled={busy}
              className="rounded-lg border border-frost-400/25 bg-abyss-950/80 px-3 py-1.5 text-[11px] font-semibold text-frost-100 backdrop-blur hover:border-glacier-400/60 disabled:opacity-50"
            >
              {busy ? "Scoring alternate…" : "Suggest alternate route"}
            </button>
          )}
          {notice && (
            <p className="mt-1.5 rounded-md border border-frost-400/15 bg-abyss-950/80 px-2 py-1 text-[10px] text-frost-300">
              {notice}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default GlobeMap;
