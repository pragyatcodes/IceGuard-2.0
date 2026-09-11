"use client";

import * as React from "react";
import {
  DEFAULT_LAYERS,
  DEFAULT_VIEW,
  drawChart,
  project,
  viewKey,
  type ChartBerg,
  type ChartLayers,
  type ChartTrack,
  type ChartVoyage,
  type ViewState,
} from "@/lib/chart/polar";
import { seaIceConcentration } from "@/lib/fields/forcing";

/**
 * The ops chart (§5.1, centre map). Canvas + our own polar-stereographic
 * projection, no tile service — see lib/chart/polar.ts for why.
 */
export function PolarChart({
  bergs,
  tracks,
  voyage,
  layers = DEFAULT_LAYERS,
  view: viewProp,
  hour = 0,
  issueAt,
  onSelectBerg,
  className,
}: {
  bergs: ChartBerg[];
  tracks: ChartTrack[];
  voyage?: ChartVoyage;
  layers?: ChartLayers;
  view?: ViewState;
  hour?: number;
  issueAt: number; // epoch seconds, so the raster matches the forecast
  onSelectBerg?: (bergId: string) => void;
  className?: string;
}) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const [size, setSize] = React.useState({ w: 800, h: 600 });
  const [view, setView] = React.useState<ViewState>(viewProp ?? DEFAULT_VIEW);
  const iceCache = React.useRef<{ key: string; canvas: HTMLCanvasElement } | null>(null);
  const drag = React.useRef<{ x: number; y: number; dx: number; dy: number } | null>(null);

  React.useEffect(() => {
    if (viewProp) setView(viewProp);
  }, [viewProp]);

  // Keep the backing store matched to the element and the device pixel ratio.
  React.useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ w: Math.max(200, r.width), h: Math.max(200, r.height) });
    });
    ro.observe(el);
    const r = el.getBoundingClientRect();
    setSize({ w: Math.max(200, r.width), h: Math.max(200, r.height) });
    return () => ro.disconnect();
  }, []);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = size.w * dpr;
    canvas.height = size.h * dpr;
    canvas.style.width = `${size.w}px`;
    canvas.style.height = `${size.h}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    iceCache.current = drawChart(
      ctx,
      { width: size.w, height: size.h, view, layers, bergs, tracks, voyage, hour },
      (lat, lon) => seaIceConcentration(lat, lon, issueAt),
      iceCache.current,
    );
  }, [size, view, layers, bergs, tracks, voyage, hour, issueAt]);

  // Drop the cached raster whenever the projection changes.
  React.useEffect(() => {
    iceCache.current = null;
  }, [viewKey(view, size.w, size.h)]);

  const hitTest = React.useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      let best: { id: string; d: number } | null = null;
      for (const b of bergs) {
        const p = project(b, size.w, size.h, view);
        const d = Math.hypot(p.x - x, p.y - y);
        if (d < 18 && (!best || d < best.d)) best = { id: b.bergId, d };
      }
      if (best) onSelectBerg?.(best.id);
    },
    [bergs, size, view, onSelectBerg],
  );

  return (
    <div ref={wrapRef} className={className ?? "relative h-full w-full"}>
      <canvas
        ref={canvasRef}
        className={onSelectBerg ? "cursor-crosshair" : "cursor-default"}
        onClick={hitTest}
        onMouseDown={(e) => {
          drag.current = {
            x: e.clientX,
            y: e.clientY,
            dx: view.dx ?? 0,
            dy: view.dy ?? 0,
          };
        }}
        onMouseMove={(e) => {
          if (!drag.current) return;
          // Drag = pan on x/y; rotation stays on the ⟲ ⟳ buttons.
          const lim = Math.min(size.w, size.h) * 0.9;
          const ndx = Math.max(-lim, Math.min(lim, drag.current.dx + (e.clientX - drag.current.x)));
          const ndy = Math.max(-lim, Math.min(lim, drag.current.dy + (e.clientY - drag.current.y)));
          setView((v) => ({ ...v, dx: ndx, dy: ndy }));
        }}
        onMouseUp={() => (drag.current = null)}
        onMouseLeave={() => (drag.current = null)}
        onWheel={(e) => {
          e.preventDefault();
          setView((v) => ({
            ...v,
            edgeLat: Math.max(-85, Math.min(-30, v.edgeLat + Math.sign(e.deltaY) * 1.5)),
          }));
        }}
      />

      {/* Zoom / rotate controls */}
      <div className="absolute right-3 top-3 flex flex-col gap-1">
        <ChartBtn
          label="Zoom in"
          onClick={() =>
            setView((v) => ({ ...v, edgeLat: Math.max(-85, v.edgeLat - 4) }))
          }
        >
          +
        </ChartBtn>
        <ChartBtn
          label="Zoom out"
          onClick={() =>
            setView((v) => ({ ...v, edgeLat: Math.min(-30, v.edgeLat + 4) }))
          }
        >
          −
        </ChartBtn>
        <ChartBtn
          label="Rotate west"
          onClick={() =>
            setView((v) => ({ ...v, centreLon: ((v.centreLon - 15 + 540) % 360) - 180 }))
          }
        >
          ⟲
        </ChartBtn>
        <ChartBtn
          label="Rotate east"
          onClick={() =>
            setView((v) => ({ ...v, centreLon: ((v.centreLon + 15 + 540) % 360) - 180 }))
          }
        >
          ⟳
        </ChartBtn>
        <ChartBtn label="Reset view" onClick={() => setView(DEFAULT_VIEW)}>
          ⌂
        </ChartBtn>
      </div>

      {/* Legend */}
      <div className="pointer-events-none absolute bottom-3 left-3 rounded-xl border border-frost-400/15 bg-abyss-950/85 px-3 py-2 backdrop-blur">
        <div className="mb-1.5 text-[9px] font-bold uppercase tracking-widest text-frost-400">
          Sea-ice concentration
        </div>
        <div
          className="h-2 w-44 rounded-full"
          style={{
            background:
              "linear-gradient(90deg,#040a16 0%,#0a2a46 15%,#104a74 40%,#267ca8 70%,#6ebee0 90%,#def2fc 100%)",
          }}
        />
        <div className="mt-0.5 flex w-44 justify-between font-mono text-[8px] text-frost-400">
          <span>0</span>
          <span>15</span>
          <span>50</span>
          <span>90</span>
          <span>100%</span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          <LegendDot color="#38d3f5" label="Open" />
          <LegendDot color="#fbbf4a" label="Drag" />
          <LegendDot color="#b79bff" label="Lock" />
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-frost-400/10 pt-1.5">
          <LegendSwatch kind="track" label="Forecast track" />
          <LegendSwatch kind="cone" label="Uncertainty cone" />
          <LegendSwatch kind="corridor" label="Corridor" />
          <LegendSwatch kind="station" label="Station" />
          <LegendSwatch kind="ship" label="Ship" />
        </div>
      </div>
    </div>
  );
}

function ChartBtn({
  children,
  onClick,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="h-7 w-7 rounded-md border border-frost-400/20 bg-abyss-900/85 text-sm text-frost-200 backdrop-blur transition-colors hover:border-glacier-400/60 hover:text-glacier-300"
    >
      {children}
    </button>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{ background: color }}
      />
      <span className="text-[9px] font-medium text-frost-400">{label}</span>
    </span>
  );
}

function LegendSwatch({
  kind,
  label,
}: {
  kind: "track" | "cone" | "corridor" | "station" | "ship";
  label: string;
}) {
  return (
    <span className="flex items-center gap-1">
      <svg width="14" height="10" viewBox="0 0 14 10" aria-hidden="true">
        {kind === "track" && (
          <line x1="0" y1="5" x2="14" y2="5" stroke="#38d3f5" strokeWidth="2" strokeDasharray="4 3" />
        )}
        {kind === "cone" && (
          <path d="M1 8 L7 1 L13 8 Z" fill="rgba(56,211,245,0.25)" stroke="#38d3f5" strokeWidth="1" strokeDasharray="3 2" />
        )}
        {kind === "corridor" && (
          <line x1="0" y1="5" x2="14" y2="5" stroke="#f2f8ff" strokeWidth="2" strokeDasharray="5 3" />
        )}
        {kind === "station" && <rect x="4" y="2" width="6" height="6" fill="#f2f8ff" stroke="#030711" />}
        {kind === "ship" && <path d="M7 0 L11 9 L7 7 L3 9 Z" fill="#f2f8ff" stroke="#030711" />}
      </svg>
      <span className="text-[9px] font-medium text-frost-400">{label}</span>
    </span>
  );
}
