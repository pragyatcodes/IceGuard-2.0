import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft, MountainSnow, Route as RouteIcon, Share2 } from "lucide-react";
import { prisma } from "@/lib/db";
import { generateForecast } from "@/lib/pipeline/forecast";
import { REGIME_META } from "@/lib/physics/regimes";
import { replaySummary } from "@/lib/pipeline/replay";
import { fmt, latLon, pct } from "@/lib/utils";
import { Badge } from "@/components/ui/primitives";
import { ShareButton } from "@/components/iceguard/ShareButton";
import { MiniTrack } from "@/components/iceguard/MiniTrack";

export const dynamic = "force-dynamic";

async function load(id: string) {
  return prisma.iceberg.findFirst({
    where: { OR: [{ id }, { bergId: id }] },
    include: { positions: { orderBy: { observedAt: "asc" } } },
  });
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const berg = await load(id);
  if (!berg) return { title: "Berg not found" };

  const title = `${berg.bergId} — ${berg.displayName}`;
  const description = `${berg.sizeClass} Antarctic berg, ${berg.regime.toLowerCase()} regime at ${latLon(
    berg.lat,
    berg.lon,
  )}. ${fmt(berg.areaKm2, 0)} km², keel ${fmt(berg.keelDepthM, 0)} m. 72-hour ICEGUARD forecast with a conformal 90% uncertainty cone.`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "article",
      siteName: "ICEGUARD",
    },
    twitter: { card: "summary", title, description },
    alternates: { canonical: `/iceberg/${berg.bergId}` },
  };
}

export default async function BergPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const berg = await load(id);
  if (!berg) notFound();

  const issueAt = berg.lastObserved;
  const fc = generateForecast(
    {
      id: berg.id,
      bergId: berg.bergId,
      displayName: berg.displayName,
      sizeClass: berg.sizeClass as never,
      lat: berg.lat,
      lon: berg.lon,
      u: berg.speedKt * 0.514444 * Math.sin((berg.headingDeg * Math.PI) / 180),
      v: berg.speedKt * 0.514444 * Math.cos((berg.headingDeg * Math.PI) / 180),
      areaKm2: berg.areaKm2,
      keelDepthM: berg.keelDepthM,
    },
    issueAt,
    72,
  );

  const summary = replaySummary();
  const rows = summary.results.filter((r) => r.sizeClass === berg.sizeClass);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const regimeMeta = REGIME_META[fc.regime];

  const dominant =
    fc.forces.ice >= fc.forces.current && fc.forces.ice >= fc.forces.wind
      ? "pack-ice stress"
      : fc.forces.current >= fc.forces.wind
        ? "ocean current"
        : "wind";

  return (
    <div className="min-h-screen pb-20">
      <header className="sticky top-0 z-40 border-b border-frost-400/10 bg-abyss-950/85 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-4 px-5">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs text-frost-400 transition-colors hover:text-frost-100"
          >
            <ArrowLeft size={13} /> ICEGUARD
          </Link>
          <span className="font-mono text-sm font-semibold text-frost-50">{berg.bergId}</span>
          <div className="ml-auto flex items-center gap-2">
            <Link
              href="/console"
              className="rounded-lg bg-glacier-500 px-3 py-1.5 text-xs font-semibold text-abyss-950 hover:bg-glacier-400"
            >
              Open in console
            </Link>
            <ShareButton label={berg.bergId} />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-5 pt-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <MountainSnow size={18} className="text-glacier-300" />
              <h1 className="text-2xl font-bold tracking-tight text-frost-50">
                {berg.displayName}
              </h1>
            </div>
            <p className="mt-1.5 text-sm text-frost-400">
              {latLon(berg.lat, berg.lon)} · last observed{" "}
              {issueAt.toISOString().slice(0, 16).replace("T", " ")} UTC · {berg.source}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge tone={fc.regime === "LOCK" ? "violet" : fc.regime === "DRAG" ? "amber" : "cyan"}>
              {regimeMeta.label}
            </Badge>
            <Badge tone="slate">{berg.sizeClass}</Badge>
            {berg.grounded && <Badge tone="red">grounding possible</Badge>}
            {berg.splitOf && <Badge tone="amber">child of {berg.splitOf}</Badge>}
          </div>
        </div>

        <p className="mt-4 max-w-3xl text-sm leading-relaxed text-frost-300">{regimeMeta.blurb}</p>

        {/* Track chart — server-rendered SVG so the page works with no JS */}
        <section className="mt-8">
          <div className="glass overflow-hidden rounded-2xl">
            <div className="flex items-center justify-between border-b border-frost-400/10 px-4 py-2.5">
              <div className="flex items-center gap-2 text-sm font-semibold text-frost-50">
                <RouteIcon size={15} className="text-glacier-400" />
                72-hour forecast with 90% cone
              </div>
              <span className="font-mono text-[10px] text-frost-500">
                cone ±{fmt(fc.cone.calibratedRadiusKm, 1)} km · n={fc.calibration.n}
              </span>
            </div>
            <MiniTrack
              history={berg.positions.map((p) => ({ lat: p.lat, lon: p.lon }))}
              centre={fc.centre.map((p) => ({ lat: p.lat, lon: p.lon }))}
              cone={fc.cone.polygon}
              start={{ lat: berg.lat, lon: berg.lon }}
            />
            <div className="flex flex-wrap gap-4 border-t border-frost-400/10 px-4 py-2 text-[10px] text-frost-500">
              <span className="flex items-center gap-1.5">
                <span className="h-0.5 w-5 bg-frost-500" /> observed
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-0.5 w-5 bg-glacier-400" /> predicted centre
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-5 rounded-sm bg-lock-400/25 ring-1 ring-lock-400/50" /> 90%
                cone
              </span>
            </div>
          </div>
          <p className="mt-2 text-[11px] leading-snug text-frost-500">
            The cone is the advice, not the centre line. A thin track invites operators to treat a
            guess as truth — one miss destroys trust (L3).
          </p>
        </section>

        {/* Numbers */}
        <section className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Num label="Area" value={fmt(berg.areaKm2, 0)} unit="km²" />
          <Num label="Length × width" value={`${fmt(berg.lengthKm, 0)} × ${fmt(berg.widthKm, 0)}`} unit="km" />
          <Num label="Keel depth" value={fmt(berg.keelDepthM, 0)} unit="m" />
          <Num label="Estimated mass" value={fmt(berg.massGt, 1)} unit="Gt" />
          <Num label="Current speed" value={fmt(berg.speedKt, 2)} unit="kt" />
          <Num label="Local SIC" value={pct(berg.sicAtBerg)} />
          <Num label="Travel in 72 h" value={fmt(fc.distanceKm72, 1)} unit="km" />
          <Num label="Cone radius @72 h" value={fmt(fc.cone.calibratedRadiusKm, 1)} unit="km" />
        </section>

        {/* Force tags */}
        <section className="mt-8 grid gap-4 lg:grid-cols-2">
          <div className="glass rounded-2xl p-5">
            <h2 className="text-sm font-semibold text-frost-50">What is driving it</h2>
            <div className="mt-3 space-y-2">
              {[
                { k: "Wind", v: fc.forces.wind, c: "bg-glacier-400" },
                { k: "Ocean current", v: fc.forces.current, c: "bg-go-400" },
                { k: "Pack-ice stress", v: fc.forces.ice, c: "bg-lock-400" },
              ].map(({ k, v, c }) => (
                <div key={k} className="flex items-center gap-2">
                  <span className="w-28 shrink-0 text-[11px] text-frost-400">{k}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-abyss-700">
                    <div className={`h-full rounded-full ${c}`} style={{ width: `${v * 100}%` }} />
                  </div>
                  <span className="w-10 shrink-0 text-right font-mono text-[11px] text-frost-200">
                    {pct(v)}
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-3 rounded-lg border border-frost-400/10 bg-abyss-850/60 p-2.5 text-[11px] leading-snug text-frost-300">
              Berg {berg.bergId} {fc.regime === "LOCK" ? "is ice-locked and riding with the pack" : fc.regime === "DRAG" ? "is being pushed through the drag zone" : "is in open water"};{" "}
              {dominant} supplies{" "}
              {pct(Math.max(fc.forces.wind, fc.forces.current, fc.forces.ice))} of the forcing.
            </p>
          </div>

          <div className="glass rounded-2xl p-5">
            <h2 className="text-sm font-semibold text-frost-50">
              How wrong we have been before
            </h2>
            <p className="mt-1 text-[11px] text-frost-500">
              Geodesic kilometres on held-out cases for the {berg.sizeClass} class (n={rows.length}).
            </p>
            <table className="mt-3 w-full text-[11px]">
              <thead>
                <tr className="text-[9px] uppercase tracking-wider text-frost-500">
                  <th className="pb-1 text-left font-semibold">Model</th>
                  <th className="pb-1 text-right font-semibold">24 h</th>
                  <th className="pb-1 text-right font-semibold">48 h</th>
                  <th className="pb-1 text-right font-semibold">72 h</th>
                </tr>
              </thead>
              <tbody className="font-mono tabular-nums">
                <tr className="text-frost-400">
                  <td className="py-0.5">Physics only</td>
                  <td className="py-0.5 text-right">{fmt(mean(rows.map((r) => r.physicsKm.h24)), 2)}</td>
                  <td className="py-0.5 text-right">{fmt(mean(rows.map((r) => r.physicsKm.h48)), 2)}</td>
                  <td className="py-0.5 text-right">{fmt(mean(rows.map((r) => r.physicsKm.h72)), 2)}</td>
                </tr>
                <tr className="text-go-400">
                  <td className="py-0.5">+ residual</td>
                  <td className="py-0.5 text-right">{fmt(mean(rows.map((r) => r.modelKm.h24)), 2)}</td>
                  <td className="py-0.5 text-right">{fmt(mean(rows.map((r) => r.modelKm.h48)), 2)}</td>
                  <td className="py-0.5 text-right">{fmt(mean(rows.map((r) => r.modelKm.h72)), 2)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        {berg.notes && (
          <p className="mt-6 rounded-xl border border-frost-400/10 bg-abyss-850/40 p-4 text-[11px] leading-relaxed text-frost-400">
            {berg.notes}
          </p>
        )}

        <p className="mt-6 flex items-start gap-2 rounded-xl border border-frost-400/10 bg-abyss-850/40 p-4 text-[10px] leading-relaxed text-frost-500">
          <Share2 size={12} className="mt-0.5 shrink-0" />
          Decision support only. This page is a read-only snapshot of an ICEGUARD forecast and is
          not a substitute for official ice charts or the master&apos;s judgement. Beyond 72 hours
          the model does not speak: longer berg paths are often fantasy (L18).
        </p>
      </main>
    </div>
  );
}

function Num({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="rounded-xl border border-frost-400/10 bg-abyss-850/40 p-3">
      <div className="text-[10px] font-bold uppercase tracking-wider text-frost-500">{label}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="font-mono text-lg font-semibold text-frost-100">{value}</span>
        {unit && <span className="text-[10px] text-frost-500">{unit}</span>}
      </div>
    </div>
  );
}
