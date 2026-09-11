"use client";

import * as React from "react";
import {
  Activity,
  AlertTriangle,
  Anchor,
  CheckCircle2,
  Copy,
  Gauge,
  MountainSnow,
  Layers,
  Link2,
  PauseCircle,
  Radio,
  Route as RouteIcon,
  Ruler,
  Search,
  ShieldAlert,
  Snowflake,
  Waves,
  Wind,
  X,
} from "lucide-react";
import { Badge, Button, Card, CardHeader, Stat, Tip, Toggle } from "@/components/ui/primitives";
import { PolarChart } from "@/components/iceguard/PolarChart";
import dynamic from "next/dynamic";

const GlobeMap = dynamic(() => import("@/components/iceguard/GlobeMap"), {
  ssr: false,
  loading: () => (
    <div className="grid h-full w-full place-items-center text-xs text-frost-400">
      Loading 3D globe…
    </div>
  ),
});
import { cn, fmt, fmtKm, latLon, pct, relAge, utcClock } from "@/lib/utils";
import { DEFAULT_LAYERS, type ChartBerg, type ChartLayers, type ChartTrack } from "@/lib/chart/polar";
import type { LatLng } from "@/lib/geo/geodesic";

interface Berg {
  id: string;
  bergId: string;
  displayName: string;
  sizeClass: string;
  regime: string;
  regimeLabel: string;
  lat: number;
  lon: number;
  areaKm2: number;
  keelDepthM: number;
  speedKt: number;
  headingDeg: number;
  sic: number;
  thicknessM: number;
  grounded: boolean;
  splitOf: string | null;
  notes: string;
  historyPoints: number;
}

interface Voyage {
  id: string;
  code: string;
  name: string;
  vessel: string;
  hullClass: string;
  speedKt: number;
  bufferNm: number;
  corridor: LatLng[];
  corridorKm: number;
  departAt: string;
  verdict: {
    light: string;
    reason: string;
    action: string;
    timeToHazardH: number | null;
    minClearanceKm: number;
    maxIceOnRoute: number;
    degraded: boolean;
    cappedByStaleData: boolean;
    hazardCount: number;
  };
}

interface ScoreResponse {
  score: {
    light: string;
    reason: string;
    action: string;
    timeToHazardH: number | null;
    minClearanceKm: number;
    maxIceOnRoute: number;
    degraded: boolean;
    cappedByStaleData: boolean;
    confidence: number;
    coverage: number;
    thresholds: Record<string, number>;
    hazards: { h: number; bergId: string; clearanceKm: number; regime: string; dominantForce: string; kind: string }[];
    perHour: { h: number; lat: number; lon: number; sic: number; thicknessM: number; clearanceKm: number; worstBerg: string | null }[];
  };
  forecasts: {
    bergId: string;
    regime: string;
    forces: { wind: number; current: number; ice: number };
    distanceKm72: number;
    coneWidthKm: number;
    calibration: { n: number; radiusKm: number; observedCoverage: number; nominalCoverage: number };
    centre: { t: number; lat: number; lon: number; sic: number; regime: string }[];
    cone: { t: number; crossKm: number; lat: number; lon: number }[];
    polygon: [number, number][];
  }[];
  dataAgeH: number;
  modelConfidence: number;
  modelVersion: string;
}

interface BergDetail {
  berg: Berg & { regimeMeta: { label: string; blurb: string } };
  history: { t: string; lat: number; lon: number; sic: number }[];
  forecast: {
    issuedAt: string;
    horizonHours: number;
    regime: string;
    regimeMeta: { label: string; blurb: string };
    forces: { wind: number; current: number; ice: number };
    distanceKm72: number;
    speedKt: number;
    headingDeg: number;
    centre: { t: number; lat: number; lon: number; sic: number; thicknessM: number; regime: string; distanceKm: number; speedKt: number; forces: { wind: number; current: number; ice: number } }[];
    cone: { coverage: number; calibratedRadiusKm: number; slices: { t: number; crossKm: number; alongKm: number; lat: number; lon: number }[]; polygon: [number, number][] };
    spread: { t: number; sigmaKm: number }[];
    calibration: { n: number; radiusKm: number; observedCoverage: number; nominalCoverage: number };
    members?: [number, number][][];
  };
  skill: {
    thisBerg: { n: number; maeKm: { h24: number; h48: number; h72: number } } | null;
    sizeClass: { n: number; maeKm: { h24: number; h48: number; h72: number }; physicsMaeKm: { h24: number; h48: number; h72: number } };
  };
}

interface Health {
  utc: string;
  feeds: { code: string; name: string; category: string; status: string; ageH: number; note: string }[];
  sarAgeH: number;
  model: { version: string; frozen: boolean; confidence: number; metrics: Record<string, unknown> };
  thresholds: Record<string, number>;
  replay: {
    maeKm: { h24: number; h48: number; h72: number };
    physicsMaeKm: { h24: number; h48: number; h72: number };
    targets: Record<string, unknown>;
  };
}

const LIGHT_STYLES: Record<string, { bg: string; text: string; ring: string; label: string }> = {
  GO: { bg: "bg-go-500/15", text: "text-go-400", ring: "ring-go-500/45", label: "GO" },
  SLOW: { bg: "bg-slow-500/15", text: "text-slow-400", ring: "ring-slow-500/45", label: "SLOW" },
  NO_GO: { bg: "bg-nogo-500/15", text: "text-nogo-400", ring: "ring-nogo-500/45", label: "NO-GO" },
};

/** Mirrors the server Session type in src/lib/auth.ts (subject is `sub`). */
type User = { sub: string; email: string; name: string; role: string } | null;

export function ConsoleShell({
  initialBergs,
  initialVoyages,
  initialHealth,
  initialUser,
}: {
  initialBergs: Berg[];
  initialVoyages: Voyage[];
  initialHealth: Health;
  initialUser: User;
}) {
  const [bergs] = React.useState<Berg[]>(initialBergs);
  const [voyages] = React.useState<Voyage[]>(initialVoyages);
  const [health] = React.useState<Health>(initialHealth);

  const [selectedBergId, setSelectedBergId] = React.useState<string | null>(
    initialBergs[0]?.bergId ?? null,
  );
  const [selectedVoyageId, setSelectedVoyageId] = React.useState<string | null>(
    initialVoyages[0]?.id ?? null,
  );
  const [bergDetail, setBergDetail] = React.useState<BergDetail | null>(null);
  const [score, setScore] = React.useState<ScoreResponse | null>(null);
  const [scoring, setScoring] = React.useState(false);
  const [hour, setHour] = React.useState(0);
  const [playing, setPlaying] = React.useState(false);
  const [layers, setLayers] = React.useState<ChartLayers>(DEFAULT_LAYERS);
  const [lite, setLite] = React.useState(false);
  const [view3d, setView3d] = React.useState(true);
  const [corridorOverride, setCorridorOverride] = React.useState<LatLng[] | null>(null);
  const [query, setQuery] = React.useState("");
  const [panel, setPanel] = React.useState<"berg" | "voyage">("voyage");
  const [toast, setToast] = React.useState<string | null>(null);
  const [now, setNow] = React.useState(() => new Date());

  const [user, setUser] = React.useState<User>(initialUser);
  const [overrideOpen, setOverrideOpen] = React.useState(false);
  const [overrideReason, setOverrideReason] = React.useState("");
  const [overrideLight, setOverrideLight] = React.useState("SLOW");
  const [overrideBusy, setOverrideBusy] = React.useState(false);
  const canOverride = user?.role === "OPERATOR" || user?.role === "ADMIN";

  React.useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Timeline playback.
  React.useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setHour((h) => (h >= 72 ? (setPlaying(false), 72) : h + 1));
    }, 140);
    return () => clearInterval(id);
  }, [playing]);

  // Load the selected berg's forecast.
  React.useEffect(() => {
    if (!selectedBergId) return;
    let alive = true;
    fetch(`/api/icebergs/${selectedBergId}?members=1`)
      .then((r) => r.json())
      .then((d) => alive && setBergDetail(d))
      .catch(() => alive && setBergDetail(null));
    return () => {
      alive = false;
    };
  }, [selectedBergId]);

  // Score the selected voyage.
  const runScore = React.useCallback(
    async (voyageId: string, corridor?: LatLng[]) => {
      setScoring(true);
      try {
        const r = await fetch(`/api/voyages/${voyageId}/score`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(corridor ? { corridor } : {}),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "scoring failed");
        setScore(d);
        const first = d.score?.hazards?.[0];
        if (first) {
          setToast(
            `${first.kind === "CONE_HULL" ? "Cone meets route" : "Cone grazes buffer"} — ${first.bergId} in ${first.h} h`,
          );
        }
      } catch (e) {
        setToast(e instanceof Error ? e.message : "scoring failed");
      } finally {
        setScoring(false);
      }
    },
    [],
  );

  React.useEffect(() => {
    setCorridorOverride(null);
    if (selectedVoyageId) void runScore(selectedVoyageId);
  }, [selectedVoyageId, runScore]);

  React.useEffect(() => {
    if (selectedVoyageId && corridorOverride)
      void runScore(selectedVoyageId, corridorOverride);
  }, [corridorOverride, selectedVoyageId, runScore]);

  React.useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 7000);
    return () => clearTimeout(id);
  }, [toast]);

  const voyage = voyages.find((v) => v.id === selectedVoyageId) ?? null;
  const berg = bergs.find((b) => b.bergId === selectedBergId) ?? null;
  const light = score?.score.light ?? voyage?.verdict.light ?? "SLOW";
  const ls = LIGHT_STYLES[light] ?? LIGHT_STYLES.SLOW;

  const filtered = bergs.filter(
    (b) =>
      !query ||
      b.bergId.toLowerCase().includes(query.toLowerCase()) ||
      b.displayName.toLowerCase().includes(query.toLowerCase()),
  );

  const chartBergs: ChartBerg[] = bergs.map((b) => ({
    bergId: b.bergId,
    lat: b.lat,
    lon: b.lon,
    regime: b.regime,
    sizeClass: b.sizeClass,
    selected: b.bergId === selectedBergId,
  }));

  // Tracks for the chart: prefer the freshly scored voyage response (it holds
  // every berg's cone against this corridor), fall back to the berg panel.
  const chartTracks: ChartTrack[] = React.useMemo(() => {
    if (score?.forecasts?.length) {
      return score.forecasts.map((f) => ({
        bergId: f.bergId,
        regime: f.regime,
        centre: f.centre.map((p) => ({ lat: p.lat, lon: p.lon })),
        cone: f.polygon.map(([lat, lon]) => ({ lat, lon })),
        coneKm: f.coneWidthKm,
      }));
    }
    if (bergDetail) {
      return [
        {
          bergId: bergDetail.berg.bergId,
          regime: bergDetail.forecast.regime,
          centre: bergDetail.forecast.centre.map((p) => ({ lat: p.lat, lon: p.lon })),
          cone: bergDetail.forecast.cone.polygon.map(([lat, lon]) => ({ lat, lon })),
          members: bergDetail.forecast.members?.map((m) =>
            m.map(([lat, lon]) => ({ lat, lon })),
          ),
          coneKm: bergDetail.forecast.cone.calibratedRadiusKm,
        },
      ];
    }
    return [];
  }, [score, bergDetail]);

  const shipAt = React.useMemo(() => {
    if (!score?.score.perHour || !voyage) return undefined;
    const s = score.score.perHour[Math.min(hour, score.score.perHour.length - 1)];
    if (!s) return undefined;
    const prev = score.score.perHour[Math.max(0, Math.min(hour, score.score.perHour.length - 1) - 1)];
    const heading = prev
      ? (Math.atan2(s.lon - prev.lon, s.lat - prev.lat) * 180) / Math.PI
      : 0;
    return { lat: s.lat, lon: s.lon, headingDeg: (heading + 360) % 360 };
  }, [score, hour, voyage]);

  const issueAt = React.useMemo(() => {
    if (bergDetail) return new Date(bergDetail.forecast.issuedAt).getTime() / 1000;
    if (voyage) return new Date(voyage.departAt).getTime() / 1000;
    return Date.now() / 1000;
  }, [bergDetail, voyage]);

  const sarStatus = health.feeds.find((f) => f.code === "SENTINEL1")?.status ?? "GREEN";

  /**
   * An override never edits what the model computed. It writes an Advice row
   * and an AuditLog row, so the machine verdict and the human verdict stay
   * separately recoverable (§5.4).
   */
  async function submitOverride(e: React.FormEvent) {
    e.preventDefault();
    if (!voyage) return;
    setOverrideBusy(true);
    try {
      const r = await fetch("/api/override", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          voyageId: voyage.id,
          light: overrideLight,
          reason: overrideReason,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "override rejected");
      setOverrideOpen(false);
      setOverrideReason("");
      setToast(
        `Override recorded by ${d.loggedBy}. The model verdict is unchanged — audit trail written.`,
      );
      setTimeout(() => setToast(null), 9000);
    } catch (err) {
      setToast(`Override rejected: ${err instanceof Error ? err.message : "unknown error"}`);
      setTimeout(() => setToast(null), 9000);
    } finally {
      setOverrideBusy(false);
    }
  }

  async function signIn(email: string, password: string) {
    const r = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const d = await r.json();
    if (r.ok && d.user) setUser(d.user);
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-abyss-950/78">
      {/* ------------------------------------------------------- Top bar */}
      <header className="flex h-14 shrink-0 items-center gap-4 border-b border-frost-400/12 bg-abyss-900/80 px-4 backdrop-blur">
        <a href="/" className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-glacier-500/15 text-glacier-300 ring-1 ring-glacier-500/35">
            <Snowflake className="h-4.5 w-4.5" size={18} />
          </span>
          <span className="text-sm font-bold tracking-tight text-frost-50">ICEGUARD</span>
        </a>

        <div className="hidden items-center gap-1.5 rounded-lg border border-frost-400/12 bg-abyss-850 px-2.5 py-1 md:flex">
          <span className="font-mono text-[11px] tabular-nums text-frost-200">
            {utcClock(now)}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {health.feeds.map((f) => (
            <Tip
              key={f.code}
              text={`${f.name} — ${f.note}. Age ${relAge(f.ageH)}.`}
            >
              <span
                className={cn(
                  "relative grid h-6 w-6 place-items-center rounded-md border text-[8px] font-bold",
                  f.status === "GREEN" && "border-go-500/35 bg-go-500/12 text-go-400",
                  f.status === "AMBER" && "border-slow-500/35 bg-slow-500/12 text-slow-400",
                  f.status === "RED" && "border-nogo-500/40 bg-nogo-500/15 text-nogo-400",
                )}
              >
                {f.code.slice(0, 3)}
                {f.status === "RED" && (
                  <span className="pulse-ring absolute inset-0 rounded-md border border-nogo-400" />
                )}
              </span>
            </Tip>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Badge tone={sarStatus === "GREEN" ? "green" : sarStatus === "AMBER" ? "amber" : "red"}>
            <Radio className="h-3 w-3" />
            SAR {relAge(health.sarAgeH)}
          </Badge>
          <Badge tone="cyan">
            <Activity className="h-3 w-3" />
            {health.model.version}
          </Badge>
          <Button size="sm" variant="outline" onClick={() => setLite((v) => !v)}>
            {lite ? "Full mode" : "Lite mode"}
          </Button>

          {user ? (
            <Tip text={`${user.email} · ${user.role}`}>
              <span className="hidden items-center gap-1.5 rounded-lg border border-frost-400/15 px-2.5 py-1 text-[10px] md:flex">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    user.role === "VIEWER"
                      ? "bg-glacier-400"
                      : user.role === "OPERATOR"
                        ? "bg-slow-400"
                        : "bg-lock-400"
                  }`}
                />
                <span className="font-mono">{user.name}</span>
                <span className="font-bold uppercase tracking-wider text-frost-500">
                  {user.role}
                </span>
              </span>
            </Tip>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => signIn("operator@ncpor.in", "operator123")}
              title="Demo sign-in as OPERATOR (Cdr. R. Menon, NCPOR)"
            >
              Sign in
            </Button>
          )}
        </div>
      </header>

      {/* ---------------------------------------------------------- Body */}
      <div className="flex min-h-0 flex-1">
        {/* Left rail */}
        <aside className="flex w-64 shrink-0 flex-col border-r border-frost-400/12 bg-abyss-900/45">
          <div className="border-b border-frost-400/10 p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-frost-500" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search berg ID…"
                className="h-8 w-full rounded-lg border border-frost-400/15 bg-abyss-850 pl-8 pr-2 text-xs text-frost-100 placeholder:text-frost-500 focus:border-glacier-400/50 focus:outline-none"
              />
            </div>
          </div>

          <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-2">
            <div className="px-1.5 pb-1.5 text-[9px] font-bold uppercase tracking-widest text-frost-500">
              Tracked bergs · {bergs.length}
            </div>
            {filtered.map((b) => (
              <button
                key={b.id}
                onClick={() => {
                  setSelectedBergId(b.bergId);
                  setPanel("berg");
                }}
                className={cn(
                  "mb-1 w-full rounded-lg border px-2.5 py-2 text-left transition-colors",
                  b.bergId === selectedBergId
                    ? "border-glacier-400/45 bg-glacier-500/10"
                    : "border-frost-400/10 bg-abyss-850/50 hover:border-frost-400/25",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs font-semibold text-frost-50">{b.bergId}</span>
                  <RegimeDot regime={b.regime} />
                </div>
                <div className="mt-0.5 truncate text-[10px] text-frost-400">
                  {b.sizeClass} · {fmt(b.areaKm2, 0)} km² · {latLon(b.lat, b.lon)}
                </div>
              </button>
            ))}

            <div className="mt-4 px-1.5 pb-1.5 text-[9px] font-bold uppercase tracking-widest text-frost-500">
              Voyages
            </div>
            {voyages.map((v) => {
              const s = LIGHT_STYLES[v.verdict.light] ?? LIGHT_STYLES.SLOW;
              return (
                <button
                  key={v.id}
                  onClick={() => {
                    setSelectedVoyageId(v.id);
                    setPanel("voyage");
                  }}
                  className={cn(
                    "mb-1 w-full rounded-lg border px-2.5 py-2 text-left transition-colors",
                    v.id === selectedVoyageId
                      ? "border-glacier-400/45 bg-glacier-500/10"
                      : "border-frost-400/10 bg-abyss-850/50 hover:border-frost-400/25",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-semibold text-frost-50">{v.name}</span>
                    <span className={cn("rounded px-1.5 py-0.5 text-[9px] font-bold", s.bg, s.text)}>
                      {s.label}
                    </span>
                  </div>
                  <div className="mt-0.5 truncate text-[10px] text-frost-400">
                    {v.vessel} · {v.corridorKm} km · {v.hullClass.replace("ICE_CLASS_", "1")}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Layer toggles */}
          <div className="border-t border-frost-400/10 p-2">
            <div className="mb-1 flex items-center gap-1.5 px-1.5 text-[9px] font-bold uppercase tracking-widest text-frost-500">
              <Layers className="h-3 w-3" /> Layers
            </div>
            {!lite && (
              <>
                <Toggle checked={layers.ice} onChange={(v) => setLayers((l) => ({ ...l, ice: v }))} label="Ice concentration" />
                <Toggle checked={layers.members} onChange={(v) => setLayers((l) => ({ ...l, members: v }))} label="Ensemble members" hint="24 perturbed drifts" />
              </>
            )}
            <Toggle checked={layers.cones} onChange={(v) => setLayers((l) => ({ ...l, cones: v }))} label="Uncertainty cones" />
            <Toggle checked={layers.tracks} onChange={(v) => setLayers((l) => ({ ...l, tracks: v }))} label="Predicted tracks" />
            <Toggle checked={layers.corridor} onChange={(v) => setLayers((l) => ({ ...l, corridor: v }))} label="Corridor + ship" />
            {!lite && (
              <>
                <Toggle checked={layers.graticule} onChange={(v) => setLayers((l) => ({ ...l, graticule: v }))} label="Graticule" />
                <Toggle checked={layers.labels} onChange={(v) => setLayers((l) => ({ ...l, labels: v }))} label="Labels" />
              </>
            )}
          </div>
        </aside>

        {/* Centre: map + timeline */}
        <main className="relative flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-1.5 border-b border-frost-400/10 bg-abyss-900/60 px-3 py-1.5">
            <button
              type="button"
              onClick={() => setView3d(true)}
              disabled={lite}
              title={lite ? "Lite mode uses the low-bandwidth 2D chart" : "3D globe view"}
              className={`rounded-md px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider transition-colors ${
                view3d && !lite
                  ? "bg-glacier-500 text-abyss-950"
                  : "text-frost-400 hover:text-frost-100"
              } disabled:cursor-not-allowed disabled:opacity-40`}
            >
              3D globe
            </button>
            <button
              type="button"
              onClick={() => setView3d(false)}
              className={`rounded-md px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider transition-colors ${
                !view3d || lite
                  ? "bg-glacier-500 text-abyss-950"
                  : "text-frost-400 hover:text-frost-100"
              }`}
            >
              2D chart
            </button>
            {corridorOverride && (
              <button
                type="button"
                onClick={() => setCorridorOverride(null)}
                className="ml-auto rounded-md border border-slow-400/40 px-2 py-1 text-[10px] font-semibold text-slow-400 hover:bg-slow-500/10"
              >
                reset corridor override
              </button>
            )}
          </div>
          <div className="relative min-h-0 flex-1">
            {view3d && !lite ? (
              <GlobeMap
                bergs={bergs.map((b) => ({
                  bergId: b.bergId,
                  lat: b.lat,
                  lon: b.lon,
                  sizeClass: b.sizeClass,
                  regime: b.regime,
                }))}
                voyages={voyages.map((v) => ({
                  id: v.id,
                  code: v.code,
                  name: v.name,
                  speedKt: v.speedKt,
                  bufferNm: v.bufferNm,
                  corridor: v.corridor,
                }))}
                selectedBergId={selectedBergId}
                onSelectBerg={(id) => {
                  setSelectedBergId(id);
                  setPanel("berg");
                }}
                detail={bergDetail}
                voyage={voyage}
                score={score}
                activeCorridor={corridorOverride ?? voyage?.corridor ?? []}
                hour={hour}
                onApplyCorridor={(c) => {
                  setCorridorOverride(c);
                  setToast("Alternate corridor applied — voyage re-scored.");
                }}
              />
            ) : (
            <PolarChart
              bergs={chartBergs}
              tracks={chartTracks}
              voyage={
                voyage
                  ? {
                      corridor: voyage.corridor,
                      ship: shipAt,
                      perHour: score?.score.perHour,
                    }
                  : undefined
              }
              layers={layers}
              hour={hour}
              issueAt={issueAt}
              onSelectBerg={(id) => {
                setSelectedBergId(id);
                setPanel("berg");
              }}
            />
            )}

            {/* Verdict badge, pinned on the map */}
            <div className="pointer-events-none absolute left-3 top-3 max-w-sm">
              <div
                className={cn(
                  "pointer-events-auto rounded-2xl border p-3 backdrop-blur-md ring-1",
                  ls.bg,
                  ls.ring,
                  "border-frost-400/15 bg-abyss-950/85",
                )}
              >
                <div className="flex items-center gap-2.5">
                  <span className={cn("grid h-9 w-9 place-items-center rounded-xl", ls.bg, ls.text)}>
                    {light === "GO" ? (
                      <CheckCircle2 size={20} />
                    ) : light === "SLOW" ? (
                      <AlertTriangle size={20} />
                    ) : (
                      <ShieldAlert size={20} />
                    )}
                  </span>
                  <div>
                    <div className={cn("text-lg font-bold leading-none tracking-tight", ls.text)}>
                      {ls.label}
                    </div>
                    <div className="mt-0.5 text-[10px] text-frost-400">
                      {voyage?.name ?? "No voyage selected"}
                      {score?.score.timeToHazardH != null && (
                        <span className="ml-1 font-mono">
                          · hazard T+{score.score.timeToHazardH} h
                        </span>
                      )}
                    </div>
                  </div>
                  {scoring && (
                    <span className="ml-auto animate-pulse text-[10px] text-frost-400">scoring…</span>
                  )}
                </div>
                <p className="mt-2 text-[11px] leading-snug text-frost-200">
                  {score?.score.reason ?? voyage?.verdict.reason}
                </p>
                {score?.score.cappedByStaleData && (
                  <p className="mt-1.5 rounded-md border border-slow-500/30 bg-slow-500/10 px-2 py-1 text-[10px] text-slow-400">
                    L8 — capped at SLOW: SAR scene is {relAge(score.dataAgeH)} old.
                  </p>
                )}
                {canOverride && voyage && (
                  <button
                    type="button"
                    onClick={() => {
                      setOverrideLight(light === "GO" ? "SLOW" : "GO");
                      setOverrideOpen(true);
                    }}
                    className="mt-2 rounded-md border border-frost-400/25 px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-frost-300 transition-colors hover:border-slow-400/60 hover:text-slow-400"
                  >
                    Override verdict
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Timeline scrubber */}
          <div className="shrink-0 border-t border-frost-400/12 bg-abyss-900/70 px-4 py-2.5 backdrop-blur">
            <div className="flex items-center gap-3">
              <Button
                size="icon"
                variant="subtle"
                onClick={() => setPlaying((p) => !p)}
                aria-label={playing ? "Pause replay" : "Play replay"}
              >
                {playing ? <PauseCircle size={16} /> : <Activity size={16} />}
              </Button>
              <span className="w-14 shrink-0 font-mono text-[11px] tabular-nums text-frost-300">
                T{hour === 0 ? "±0" : `+${hour}`} h
              </span>
              <input
                type="range"
                min={0}
                max={72}
                step={1}
                value={hour}
                onChange={(e) => setHour(Number(e.target.value))}
                className="scrubber flex-1"
                aria-label="Forecast hour"
              />
              <span className="w-14 shrink-0 text-right font-mono text-[11px] tabular-nums text-frost-400">
                T+72 h
              </span>
            </div>
            <div className="mt-1 flex justify-between px-16 text-[9px] text-frost-600">
              {[-72, -48, -24, 0, 24, 48, 72].map((t) => (
                <span key={t} className="font-mono">
                  {t > 0 ? `T+${t}` : t === 0 ? "now" : `T−${-t}`}
                </span>
              ))}
            </div>
          </div>
        </main>

        {/* Right panel */}
        <aside className="flex w-[22rem] shrink-0 flex-col border-l border-frost-400/12 bg-abyss-900/45">
          <div className="flex shrink-0 gap-1 border-b border-frost-400/10 p-2">
            {(["voyage", "berg"] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPanel(p)}
                className={cn(
                  "flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
                  panel === p
                    ? "bg-glacier-500/15 text-glacier-300"
                    : "text-frost-400 hover:text-frost-200",
                )}
              >
                {p === "voyage" ? "Voyage" : "Berg"}
              </button>
            ))}
          </div>

          <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-3">
            {panel === "voyage" ? (
              <VoyagePanel voyage={voyage} score={score} hour={hour} />
            ) : (
              <BergPanel detail={bergDetail} berg={berg} />
            )}
          </div>
        </aside>
      </div>

      {/* Alert toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2">
          <div className="flex items-center gap-3 rounded-xl border border-slow-500/35 bg-abyss-850/95 px-4 py-2.5 shadow-2xl backdrop-blur">
            <AlertTriangle className="h-4 w-4 text-slow-400" />
            <span className="text-xs text-frost-100">{toast}</span>
            <button
              onClick={() => setToast(null)}
              className="rounded p-1 text-frost-400 hover:text-frost-100"
              aria-label="Acknowledge"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Permanent disclaimer — L10 and L15 */}
      <footer className="shrink-0 border-t border-frost-400/10 bg-abyss-900 px-4 py-1.5 text-center text-[10px] text-frost-500">
        Decision support only. ICEGUARD does not replace the master&apos;s or pilot&apos;s
        judgement or official ice charts, and it issues no helm commands. Overrides are logged.
      </footer>

      {/* Override dialog — the audit trail is the feature, not an afterthought */}
      {overrideOpen && (
        <div className="absolute inset-0 z-50 grid place-items-center bg-abyss-950/80 p-4 backdrop-blur-sm">
          <form
            onSubmit={submitOverride}
            className="w-full max-w-md rounded-2xl border border-frost-400/15 bg-abyss-900 p-5 shadow-2xl"
          >
            <h2 className="text-base font-semibold text-frost-50">Override the verdict</h2>
            <p className="mt-1 text-[11px] leading-snug text-frost-400">
              ICEGUARD&apos;s verdict stays{" "}
              <span className={cn("font-bold", ls.text)}>{ls.label}</span>. Your override is
              recorded against {voyage?.name} in the audit log — it never edits what the model
              computed, so the two stay separately recoverable.
            </p>

            <div className="mt-4 flex gap-1.5">
              {["GO", "SLOW", "NO_GO"].map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => setOverrideLight(l)}
                  className={cn(
                    "flex-1 rounded-lg border px-2 py-1.5 text-[11px] font-bold uppercase tracking-wider transition-colors",
                    overrideLight === l
                      ? "border-frost-300 bg-frost-100 text-abyss-950"
                      : "border-frost-400/20 text-frost-400 hover:border-frost-400/50",
                  )}
                >
                  {l === "NO_GO" ? "NO-GO" : l}
                </button>
              ))}
            </div>

            <label className="mt-4 block">
              <span className="text-[10px] font-bold uppercase tracking-wider text-frost-500">
                Reason (min 12 characters, audited)
              </span>
              <textarea
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                rows={3}
                placeholder="e.g. Visual ice observation from bridge: lead open east of E-07"
                className="mt-1 w-full rounded-lg border border-frost-400/15 bg-abyss-950 px-3 py-2 text-sm text-frost-100 focus:border-glacier-400/60 focus:outline-none"
              />
            </label>

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setOverrideOpen(false)}
                className="flex-1 rounded-lg border border-frost-400/20 px-3 py-2 text-xs font-semibold text-frost-300 hover:bg-abyss-850"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={overrideBusy || overrideReason.trim().length < 12}
                className="flex-1 rounded-lg bg-slow-400 px-3 py-2 text-xs font-bold text-abyss-950 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {overrideBusy ? "Recording…" : "Record override"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ panels */

function RegimeDot({ regime }: { regime: string }) {
  const c =
    regime === "LOCK" ? "bg-lock-400" : regime === "DRAG" ? "bg-slow-400" : "bg-glacier-400";
  return <span className={cn("h-2 w-2 shrink-0 rounded-full", c)} title={regime} />;
}

function ForceBars({ f }: { f: { wind: number; current: number; ice: number } }) {
  const rows = [
    { k: "Wind", v: f.wind, c: "bg-glacier-400", Icon: Wind },
    { k: "Current", v: f.current, c: "bg-go-400", Icon: Waves },
    { k: "Ice", v: f.ice, c: "bg-lock-400", Icon: MountainSnow },
  ];
  return (
    <div className="space-y-1.5">
      {rows.map(({ k, v, c, Icon }) => (
        <div key={k} className="flex items-center gap-2">
          <Icon size={12} className="shrink-0 text-frost-500" />
          <span className="w-14 shrink-0 text-[10px] text-frost-400">{k}</span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-abyss-700">
            <div className={cn("h-full rounded-full", c)} style={{ width: `${v * 100}%` }} />
          </div>
          <span className="w-9 shrink-0 text-right font-mono text-[10px] tabular-nums text-frost-300">
            {pct(v)}
          </span>
        </div>
      ))}
    </div>
  );
}

function VoyagePanel({
  voyage,
  score,
  hour,
}: {
  voyage: Voyage | null;
  score: ScoreResponse | null;
  hour: number;
}) {
  if (!voyage) return <Empty icon={RouteIcon} text="Select a voyage" />;
  const s = score?.score;
  const at = s?.perHour?.[Math.min(hour, (s?.perHour?.length ?? 1) - 1)];

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader
          title={voyage.name}
          subtitle={`${voyage.vessel} · ${voyage.hullClass}`}
          icon={<Anchor size={15} />}
          right={<Badge tone="slate">{voyage.corridorKm} km</Badge>}
        />
        <div className="grid grid-cols-2 gap-2 p-3">
          <Stat label="Speed" value={fmt(voyage.speedKt, 0)} unit="kt" />
          <Stat label="Hull buffer" value={fmt(voyage.bufferNm, 1)} unit="nm" />
        </div>
      </Card>

      {s && (
        <Card>
          <CardHeader
            title="Verdict detail"
            subtitle="Cone-vs-hull, never centre-line-vs-hull (L3)"
            icon={<Gauge size={15} />}
          />
          <div className="grid grid-cols-2 gap-2 p-3">
            <Stat
              label="Min clearance"
              value={fmtKm(s.minClearanceKm)}
              tone={s.minClearanceKm < 10 ? "red" : s.minClearanceKm < 30 ? "amber" : "green"}
              hint="cone edge to hull"
            />
            <Stat
              label="Max ice on route"
              value={pct(s.maxIceOnRoute)}
              tone={s.maxIceOnRoute > 0.9 ? "violet" : s.maxIceOnRoute > 0.4 ? "amber" : "cyan"}
            />
            <Stat
              label="Model confidence"
              value={pct(s.confidence)}
              tone={s.confidence < 0.5 ? "red" : "green"}
              hint="from replay skill, not softmax (L11)"
            />
            <Stat label="Cone coverage" value={pct(s.coverage)} hint="conformal, nominal 90%" />
          </div>
          <div className="border-t border-frost-400/10 p-3">
            <div className="mb-1.5 text-[9px] font-bold uppercase tracking-widest text-frost-500">
              Officer action
            </div>
            <p className="text-[11px] leading-snug text-frost-200">{s.action}</p>
          </div>
        </Card>
      )}

      {at && (
        <Card>
          <CardHeader title={`At T+${hour} h`} icon={<Activity size={15} />} />
          <div className="space-y-1.5 p-3 text-[11px]">
            <Row label="Ship position" value={latLon(at.lat, at.lon)} mono />
            <Row label="Local SIC" value={pct(at.sic)} />
            <Row label="Ice thickness" value={`${fmt(at.thicknessM, 2)} m`} />
            <Row
              label="Cone clearance"
              value={fmtKm(at.clearanceKm)}
              tone={at.clearanceKm < 0 ? "red" : at.clearanceKm < 15 ? "amber" : "green"}
            />
            {at.worstBerg && <Row label="Closest berg" value={at.worstBerg} mono />}
          </div>
        </Card>
      )}

      {s && s.hazards.length > 0 && (
        <Card>
          <CardHeader
            title={`Hazards · ${s.hazards.length}`}
            subtitle="First 24 by time"
            icon={<AlertTriangle size={15} />}
          />
          <div className="scrollbar-thin max-h-56 overflow-y-auto p-2">
            {s.hazards.map((h, i) => (
              <div
                key={`${h.bergId}-${h.h}-${i}`}
                className="mb-1 flex items-center gap-2 rounded-lg border border-frost-400/10 bg-abyss-850/50 px-2.5 py-1.5"
              >
                <span className="font-mono text-[10px] font-semibold text-frost-100">
                  T+{h.h}h
                </span>
                <span className="font-mono text-[10px] text-glacier-300">{h.bergId}</span>
                <Badge tone={h.kind === "CONE_HULL" ? "red" : "amber"}>
                  {h.kind === "CONE_HULL" ? "hull" : "graze"}
                </Badge>
                <span className="ml-auto font-mono text-[10px] tabular-nums text-frost-400">
                  {fmt(h.clearanceKm, 1)} km
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title="Thresholds in force" subtitle="Configuration, not religion (§4.5)" icon={<Ruler size={15} />} />
        <div className="space-y-1 p-3">
          {s &&
            Object.entries(s.thresholds).map(([k, v]) => (
              <Row key={k} label={k} value={String(v)} mono />
            ))}
        </div>
      </Card>
    </div>
  );
}

function BergPanel({ detail, berg }: { detail: BergDetail | null; berg: Berg | null }) {
  const [copied, setCopied] = React.useState(false);
  if (!detail || !berg) return <Empty icon={MountainSnow} text="Select a berg" />;

  const f = detail.forecast;
  const shareUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/iceberg/${berg.bergId}`
      : `/iceberg/${berg.bergId}`;

  return (
    <div className="space-y-3">
      <Card glow>
        <CardHeader
          title={detail.berg.displayName}
          subtitle={`${berg.sizeClass} · ${f.regimeMeta.label}`}
          icon={<MountainSnow size={15} />}
          right={<RegimeDot regime={f.regime} />}
        />
        <div className="grid grid-cols-2 gap-2 p-3">
          <Stat label="Position" value={latLon(berg.lat, berg.lon)} tone="cyan" />
          <Stat label="Area" value={fmt(berg.areaKm2, 0)} unit="km²" />
          <Stat label="Keel depth" value={fmt(berg.keelDepthM, 0)} unit="m" />
          <Stat label="Speed" value={fmt(berg.speedKt, 2)} unit="kt" />
        </div>
        <div className="border-t border-frost-400/10 p-3">
          <p className="text-[11px] leading-snug text-frost-300">{f.regimeMeta.blurb}</p>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Force breakdown"
          subtitle="Which force dominates — the XAI force tags"
          icon={<Wind size={15} />}
        />
        <div className="p-3">
          <ForceBars f={f.forces} />
          <p className="mt-2 rounded-md border border-frost-400/10 bg-abyss-850/60 px-2 py-1.5 text-[10px] leading-snug text-frost-400">
            {dominantSentence(berg.bergId, f.regime, f.forces)}
          </p>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Forecast positions"
          subtitle={`${f.horizonHours} h horizon · conformal ${pct(f.cone.coverage)}`}
          icon={<RouteIcon size={15} />}
        />
        <div className="grid grid-cols-3 gap-2 p-3">
          {[24, 48, 72].map((h) => {
            const p = f.centre[h];
            const c = f.cone.slices[h];
            if (!p || !c) return null;
            return (
              <div key={h} className="rounded-lg border border-frost-400/10 bg-abyss-850/50 p-2">
                <div className="text-[9px] font-bold uppercase tracking-wider text-frost-500">
                  T+{h} h
                </div>
                <div className="mt-1 font-mono text-[10px] leading-tight text-frost-200">
                  {latLon(p.lat, p.lon)}
                </div>
                <div className="mt-1 font-mono text-[10px] text-glacier-300">
                  ±{fmt(c.crossKm, 1)} km
                </div>
              </div>
            );
          })}
        </div>
        <div className="grid grid-cols-2 gap-2 px-3 pb-3">
          <Stat label="Travel in 72 h" value={fmtKm(f.distanceKm72)} />
          <Stat
            label="Cone radius"
            value={fmtKm(f.cone.calibratedRadiusKm)}
            hint={`n=${f.calibration.n} held-out cases`}
          />
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Replay error"
          subtitle="Geodesic kilometres, never degrees (L4)"
          icon={<Activity size={15} />}
        />
        <div className="p-3">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-[9px] uppercase tracking-wider text-frost-500">
                <th className="pb-1 text-left font-semibold">Class {berg.sizeClass}</th>
                <th className="pb-1 text-right font-semibold">24 h</th>
                <th className="pb-1 text-right font-semibold">48 h</th>
                <th className="pb-1 text-right font-semibold">72 h</th>
              </tr>
            </thead>
            <tbody className="font-mono tabular-nums">
              <tr className="text-frost-400">
                <td className="py-0.5">Physics only</td>
                <td className="py-0.5 text-right">{fmt(detail.skill.sizeClass.physicsMaeKm.h24, 2)}</td>
                <td className="py-0.5 text-right">{fmt(detail.skill.sizeClass.physicsMaeKm.h48, 2)}</td>
                <td className="py-0.5 text-right">{fmt(detail.skill.sizeClass.physicsMaeKm.h72, 2)}</td>
              </tr>
              <tr className="text-go-400">
                <td className="py-0.5">+ residual</td>
                <td className="py-0.5 text-right">{fmt(detail.skill.sizeClass.maeKm.h24, 2)}</td>
                <td className="py-0.5 text-right">{fmt(detail.skill.sizeClass.maeKm.h48, 2)}</td>
                <td className="py-0.5 text-right">{fmt(detail.skill.sizeClass.maeKm.h72, 2)}</td>
              </tr>
            </tbody>
          </table>
          <p className="mt-2 text-[10px] text-frost-500">
            n={detail.skill.sizeClass.n} held-out cases for this size class.
          </p>
        </div>
      </Card>

      <Card>
        <CardHeader title="Share" subtitle="Public, read-only berg page" icon={<Link2 size={15} />} />
        <div className="flex gap-2 p-3">
          <code className="min-w-0 flex-1 truncate rounded-lg border border-frost-400/12 bg-abyss-850 px-2 py-1.5 font-mono text-[10px] text-frost-300">
            {shareUrl}
          </code>
          <Button
            size="sm"
            variant="subtle"
            onClick={() => {
              void navigator.clipboard?.writeText(shareUrl);
              setCopied(true);
              setTimeout(() => setCopied(false), 1800);
            }}
          >
            {copied ? <CheckCircle2 size={13} /> : <Copy size={13} />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      </Card>

      {berg.notes && (
        <p className="rounded-lg border border-frost-400/10 bg-abyss-850/40 p-2.5 text-[10px] leading-snug text-frost-400">
          {berg.notes}
        </p>
      )}
    </div>
  );
}

function dominantSentence(
  bergId: string,
  regime: string,
  f: { wind: number; current: number; ice: number },
): string {
  const top =
    f.ice >= f.current && f.ice >= f.wind ? "pack-ice stress" : f.current >= f.wind ? "ocean current" : "wind";
  const regimeWord =
    regime === "LOCK"
      ? "is ice-locked and riding with the pack"
      : regime === "DRAG"
        ? "is in the drag zone"
        : "is in open water";
  return `Berg ${bergId} ${regimeWord}; ${top} supplies ${pct(Math.max(f.wind, f.current, f.ice))} of the forcing.`;
}

function Row({
  label,
  value,
  mono,
  tone = "slate",
}: {
  label: string;
  value: string;
  mono?: boolean;
  tone?: "slate" | "green" | "amber" | "red";
}) {
  const c =
    tone === "red"
      ? "text-nogo-400"
      : tone === "amber"
        ? "text-slow-400"
        : tone === "green"
          ? "text-go-400"
          : "text-frost-200";
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[10px] text-frost-500">{label}</span>
      <span className={cn("text-[11px]", mono && "font-mono tabular-nums", c)}>{value}</span>
    </div>
  );
}

function Empty({
  icon: Icon,
  text,
}: {
  icon: React.ComponentType<{ size?: number | string; className?: string }>;
  text: string;
}) {
  return (
    <div className="grid h-40 place-items-center text-center">
      <div>
        <Icon size={22} className="mx-auto mb-2 text-frost-600" />
        <p className="text-xs text-frost-500">{text}</p>
      </div>
    </div>
  );
}
