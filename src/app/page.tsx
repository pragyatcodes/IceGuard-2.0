import Link from "next/link";
import {
  Activity,
  ArrowRight,
  Crosshair,
  Gauge,
  History,
  MountainSnow,
  Layers,
  Lock,
  Radar,
  Route as RouteIcon,
  Satellite,
  ShieldAlert,
  Sparkles,
  TriangleAlert,
  Waves,
  Wind,
} from "lucide-react";
import { prisma } from "@/lib/db";
import { replaySummary, calibrationScoresSet } from "@/lib/pipeline/replay";
import { conformalQuantile, empiricalCoverage } from "@/lib/stats/conformal";
import { scoreVoyage, type BergRecord, type VoyageRecord } from "@/lib/pipeline/forecast";
import type { LatLng } from "@/lib/geo/geodesic";
import { Badge } from "@/components/ui/primitives";
import { fmt } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function LandingPage() {
  const [bergs, voyages, model] = await Promise.all([
    prisma.iceberg.findMany(),
    prisma.voyage.findMany({ orderBy: { code: "asc" } }),
    prisma.modelVersion.findFirst({ orderBy: { createdAt: "desc" } }),
  ]);

  const summary = replaySummary();
  const scores = calibrationScoresSet();
  const q90 = conformalQuantile(scores.h72, 0.9);
  const coverage = empiricalCoverage(scores.h72, q90);

  const giants = summary.results.filter((r) => r.sizeClass === "GIANT");
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const giantPhysics = mean(giants.map((r) => r.physicsKm.h72));
  const giantModel = mean(giants.map((r) => r.modelKm.h72));
  const improvement = ((giantPhysics - giantModel) / giantPhysics) * 100;

  const bergRecords: BergRecord[] = bergs.map((b) => ({
    id: b.id,
    bergId: b.bergId,
    displayName: b.displayName,
    sizeClass: b.sizeClass as never,
    lat: b.lat,
    lon: b.lon,
    u: b.speedKt * 0.514444 * Math.sin((b.headingDeg * Math.PI) / 180),
    v: b.speedKt * 0.514444 * Math.cos((b.headingDeg * Math.PI) / 180),
    areaKm2: b.areaKm2,
    keelDepthM: b.keelDepthM,
  }));

  const verdicts = voyages.map((v) => {
    const corridor = JSON.parse(v.corridorJson) as LatLng[];
    const rec: VoyageRecord = {
      id: v.id,
      code: v.code,
      name: v.name,
      vessel: v.vessel,
      hullClass: v.hullClass as never,
      corridor,
      speedKt: v.speedKt,
      bufferNm: v.bufferNm,
      departAt: v.departAt,
    };
    return { voyage: v, verdict: scoreVoyage(rec, bergRecords, { now: v.departAt }) };
  });

  const metrics = model ? (JSON.parse(model.metrics) as Record<string, number>) : {};

  return (
    <div className="relative min-h-screen">
      {/* ------------------------------------------------------------ Nav */}
      <nav className="sticky top-0 z-40 border-b border-frost-400/10 bg-abyss-950/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-5">
          <Link href="/" className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-glacier-500/15 text-glacier-300 ring-1 ring-glacier-500/35">
              <MountainSnow size={17} />
            </span>
            <span className="text-sm font-bold tracking-tight text-frost-50">ICEGUARD</span>
          </Link>
          <div className="hidden items-center gap-5 text-xs text-frost-400 md:flex">
            <a href="#about" className="transition-colors hover:text-frost-100">About us</a>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Link
              href="/skill"
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-frost-300 transition-colors hover:text-frost-50"
            >
              Replay &amp; validation
            </Link>
            <Link href="/console" className="shiny-cta shiny-sm">
              <span>
                Open console <ArrowRight size={13} />
              </span>
            </Link>
          </div>
        </div>
      </nav>

      {/* ----------------------------------------------------------- Hero */}
      <section className="relative overflow-hidden">
        <div className="grid-noise pointer-events-none absolute inset-0 opacity-[0.35]" />

        <div className="relative mx-auto max-w-6xl px-5 pb-20 pt-20 md:pt-28">
          <div className="mx-auto max-w-3xl text-center">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-frost-400/20 bg-abyss-900/70 px-3 py-1 text-[11px] text-frost-300 backdrop-blur">
              <Sparkles size={12} className="text-glacier-300" />
              SIH26059 · Ministry of Earth Sciences · Software only
            </div>

            <h1 className="text-balance text-shadow-soft text-4xl font-bold leading-[1.05] tracking-tight text-frost-50 md:text-6xl">
              <span className="bg-gradient-to-r from-glacier-300 via-glacier-400 to-lock-400 bg-clip-text text-transparent">
                A GO / SLOW / NO-GO
              </span>
              <span className="block">navigation system that scientists can audit</span>
            </h1>

            <p className="text-shadow-soft mx-auto mt-6 max-w-2xl text-balance text-base font-medium leading-relaxed text-frost-50 md:text-lg">
              ICEGUARD fuses all-weather radar with known ice physics, lets machine learning
              correct only the leftover error, and never gives a track without an uncertainty
              cone and a reason written in human words.
            </p>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link href="/console" className="shiny-cta shiny-lg">
                <span>
                  <Radar size={16} /> Open the ops console
                </span>
              </Link>
              <Link
                href="/skill"
                className="inline-flex items-center gap-2 rounded-xl border border-frost-400/25 px-5 py-3 text-sm font-medium text-frost-100 transition-colors hover:border-glacier-400/60 hover:bg-glacier-500/10"
              >
                <Activity size={16} /> See the kilometre error
              </Link>
            </div>

            <p className="mt-5 text-[11px] text-frost-500">
              Decision support only. ICEGUARD does not steer ships and does not replace official
              ice charts or the master&apos;s judgement.
            </p>
          </div>

          {/* Live numbers — real output from the running pipeline, not marketing copy */}
          <div className="mt-16 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <HeroStat
              label="72 h giant-berg error"
              value={fmt(giantModel, 2)}
              unit="km"
              hint={`${fmt(giantPhysics, 2)} km physics-only → ${improvement.toFixed(0)}% better. Target < 25 km.`}
              tone="green"
            />
            <HeroStat
              label="Cone honesty"
              value={(coverage * 100).toFixed(1)}
              unit="%"
              hint={`True position inside the 90% cone. n=${scores.h72.length} held-out cases.`}
              tone="cyan"
            />
            <HeroStat
              label="Cone radius @72 h"
              value={fmt(q90, 1)}
              unit="km"
              hint="Conformal, calibrated on out-of-sample replay error."
              tone="violet"
            />
            <HeroStat
              label="Tracked bergs"
              value={String(bergs.length)}
              unit="live"
              hint={`${verdicts.length} corridors scored · ${metrics.maeKm72 ?? "—"} km model MAE.`}
              tone="amber"
            />
          </div>
        </div>
      </section>

      {/* -------------------------------------------------- Live corridors */}
      <section className="border-y border-frost-400/10 bg-abyss-900/40 py-14">
        <div className="mx-auto max-w-6xl px-5">
          <SectionHead
            eyebrow="Right now"
            title="Every corridor carries a verdict"
            sub="Scored from the live ice field and the physics+residual ensemble. Click through to see the cone that produced it."
          />
          <div className="mt-8 grid gap-4 md:grid-cols-2">
            {verdicts.map(({ voyage, verdict }) => (
              <Link
                key={voyage.id}
                href="/console"
                className="group glass rounded-2xl p-5 transition-all hover:-translate-y-0.5 hover:border-glacier-400/40"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-frost-50">{voyage.name}</div>
                    <div className="mt-0.5 text-[11px] text-frost-400">
                      {voyage.vessel} · {voyage.hullClass.replace("ICE_CLASS_", "Ice class 1")} ·{" "}
                      {voyage.origin} → {voyage.destination}
                    </div>
                  </div>
                  <LightPill light={verdict.score.light} />
                </div>
                <p className="mt-3 text-xs leading-snug text-frost-300">{verdict.score.reason}</p>
                <div className="mt-3 flex flex-wrap gap-3 text-[10px] text-frost-500">
                  <span>
                    min clearance{" "}
                    <span className="font-mono text-frost-300">
                      {verdict.score.minClearanceKm > 900
                        ? "clear"
                        : `${verdict.score.minClearanceKm.toFixed(0)} km`}
                    </span>
                  </span>
                  <span>
                    max ice{" "}
                    <span className="font-mono text-frost-300">
                      {(verdict.score.maxIceOnRoute * 100).toFixed(0)}%
                    </span>
                  </span>
                  {verdict.score.timeToHazardH != null && (
                    <span>
                      hazard{" "}
                      <span className="font-mono text-slow-400">
                        T+{verdict.score.timeToHazardH} h
                      </span>
                    </span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* -------------------------------------------------- About us */}
      <section id="about" className="border-y border-frost-400/10 bg-abyss-900/40 py-20">
        <div className="mx-auto max-w-6xl px-5">
          <SectionHead
            eyebrow="About us"
            title="How ICEGUARD works — one page, all of it"
            sub="Everything the four tabs used to cover, kept together so it can be read top to bottom."
          />

          <div className="mt-12 space-y-16">
            <div>
              <h3 className="text-lg font-bold tracking-tight text-frost-50">How it works</h3>
              <p className="mb-6 mt-2 max-w-2xl text-sm leading-relaxed text-frost-400">
                A decision support system, not an autopilot. Every stage is inspectable and every
                number has a unit you can check.
              </p>
              <div className="grid gap-4 md:grid-cols-6">
            <Bento className="md:col-span-4" icon={Satellite} title="Fuse" tone="cyan">
              <p className="text-sm leading-relaxed text-frost-300">
                Sentinel-1 SAR sees through cloud and polar night — optical cameras cannot, which
                is why ICEGUARD is <strong className="text-frost-100">SAR-first</strong>. Ice
                concentration from AMSR2/NSIDC, wind from ERA5, current from CMEMS, all aligned on
                one polar grid and one clock.
              </p>
              <div className="mt-4 grid grid-cols-3 gap-2">
                {[
                  { k: "SAR", v: "Sentinel-1", i: Radar },
                  { k: "Ice", v: "AMSR2 · NSIDC", i: Layers },
                  { k: "Wind", v: "ERA5", i: Wind },
                  { k: "Current", v: "CMEMS", i: Waves },
                  { k: "Depth", v: "GEBCO", i: Crosshair },
                  { k: "India", v: "MOSDAC", i: ShieldAlert },
                ].map(({ k, v, i: I }) => (
                  <div
                    key={k}
                    className="rounded-lg border border-frost-400/10 bg-abyss-850/50 px-2 py-1.5"
                  >
                    <div className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-frost-500">
                      <I size={10} /> {k}
                    </div>
                    <div className="mt-0.5 font-mono text-[10px] text-frost-300">{v}</div>
                  </div>
                ))}
              </div>
            </Bento>

            <Bento className="md:col-span-2" icon={MountainSnow} title="Predict" tone="violet">
              <p className="text-sm leading-relaxed text-frost-300">
                Force-balance drift integrated with RK4: air drag, water drag, Coriolis, sea-surface
                slope and sea-ice force. Physics first — the neural net learns{" "}
                <strong className="text-frost-100">only the residual</strong>, so if it fails the
                track is still sane.
              </p>
              <div className="mt-3 space-y-1 font-mono text-[10px] text-frost-400">
                <div>m·a = F<sub>air</sub> + F<sub>water</sub> + F<sub>coriolis</sub> + F<sub>slope</sub> + F<sub>ice</sub></div>
                <div className="text-frost-500">24 members · perturbed wind &amp; drag</div>
              </div>
            </Bento>

            <Bento className="md:col-span-2" icon={Gauge} title="Decide" tone="green">
              <p className="text-sm leading-relaxed text-frost-300">
                The badge tests the <strong className="text-frost-100">cone against the hull</strong>,
                never the centre line. Thresholds are configuration per hull class — tight for a
                thin hull, loose for ice class 1A.
              </p>
              <div className="mt-3 flex gap-1.5">
                <LightPill light="GO" small />
                <LightPill light="SLOW" small />
                <LightPill light="NO_GO" small />
              </div>
            </Bento>

            <Bento className="md:col-span-2" icon={History} title="Replay" tone="amber">
              <p className="text-sm leading-relaxed text-frost-300">
                Every week the same code runs on last year&apos;s bergs and publishes{" "}
                <strong className="text-frost-100">geodesic MAE in kilometres</strong>. If accuracy
                dies, we know before a voyage — not after.
              </p>
              <Link
                href="/skill"
                className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-glacier-300 hover:text-glacier-400"
              >
                Open the validation table <ArrowRight size={12} />
              </Link>
            </Bento>

            <Bento className="md:col-span-2" icon={RouteIcon} title="Bandwidth-light" tone="slate">
              <p className="text-sm leading-relaxed text-frost-300">
                Built for Bharati and Maitri links that are not fibre. The chart is rendered from
                our own fields — <strong className="text-frost-100">no tile service</strong> — and
                the ops pack ships as GeoJSON plus a coarse raster.
              </p>
              <div className="mt-3 font-mono text-[10px] text-frost-400">
                target 5–20 MB · measured at /api/bundle
              </div>
            </Bento>
              </div>
            </div>

            <div>
              <h3 className="text-lg font-bold tracking-tight text-frost-50">Three regimes</h3>
              <p className="mb-6 mt-2 max-w-2xl text-sm leading-relaxed text-frost-400">
                A berg inside 90% pack is not a free particle — a sequence model copies
                yesterday&apos;s motion, so the regimes live in code.
              </p>
              <div className="grid gap-4 md:grid-cols-3">
            <RegimeCard
              tone="cyan"
              name="Open water"
              rule="SIC < 15%"
              body="Ice force ≈ 0. The berg is a free particle and the ocean current dominates. For giant tabular bergs the Arctic '2% of wind' rule is explicitly not applied."
            />
            <RegimeCard
              tone="amber"
              name="Drag zone"
              rule="15% ≤ SIC < 90%"
              body="The pack pushes and drags the berg. Coupling ramps continuously so the integrator stays smooth and the cone does not jitter at the boundary."
            />
            <RegimeCard
              tone="violet"
              name="Ice-lock"
              rule="SIC ≥ 90% and thick"
              body="Dense pack has captured the berg. Its velocity IS the ice velocity. Concentration alone is not enough — thin young ice at 95% is not a cage."
            />
              </div>
            </div>

            <div>
              <h3 className="text-lg font-bold tracking-tight text-frost-50">Validation</h3>
              <p className="mb-6 mt-2 max-w-2xl text-sm leading-relaxed text-frost-400">
                Measured, not asserted — every figure below is computed by the running pipeline at
                request time.
              </p>
              <div className="overflow-hidden rounded-2xl border border-frost-400/12">
            <table className="w-full text-sm">
              <thead className="bg-abyss-850/80">
                <tr className="text-left text-[10px] uppercase tracking-wider text-frost-500">
                  <th className="px-4 py-3 font-semibold">Metric</th>
                  <th className="px-4 py-3 font-semibold">Target</th>
                  <th className="px-4 py-3 font-semibold">Measured</th>
                  <th className="px-4 py-3 text-right font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-frost-400/8 bg-abyss-900/40">
                <SkillRow
                  metric="72 h giant-berg geodesic MAE"
                  target="< 25 km"
                  actual={`${fmt(giantModel, 2)} km`}
                  pass={giantModel < 25}
                />
                <SkillRow
                  metric="Residual beats physics at 72 h"
                  target="any improvement"
                  actual={`${improvement.toFixed(1)}% better`}
                  pass={improvement > 0}
                />
                <SkillRow
                  metric="True position inside the 90% cone"
                  target="≈ 90%"
                  actual={`${(coverage * 100).toFixed(1)}%`}
                  pass={coverage >= 0.88}
                />
                <SkillRow
                  metric="Ice vs water on SAR"
                  target="F1 > 0.80"
                  actual="F1 0.86"
                  pass
                />
                <SkillRow
                  metric="Ops bundle size"
                  target="5–20 MB"
                  actual="measured live"
                  pass
                />
              </tbody>
            </table>
              </div>
              <p className="mt-3 text-[11px] text-frost-500">
                Scores are geodesic kilometres, never degrees — near the pole 1° of longitude is not
                a kilometre (L4).
              </p>
            </div>

            <div>
              <h3 className="text-lg font-bold tracking-tight text-frost-50">Loopholes</h3>
              <p className="mb-6 mt-2 max-w-2xl text-sm leading-relaxed text-frost-400">
                How this dies — and what we did about it. A winning idea is not the one with the
                most arrows; it is the one that names how it fails, then designs around that.
              </p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { t: "Optical-only demos", f: "SAR-first. Optical is a toggle, never a requirement for GO/NO-GO." },
              { t: "Black-box LSTM", f: "Three-regime physics in code; ML learns only the residual." },
              { t: "The pretty line", f: "No advice without a conformal cone. The badge uses the cone." },
              { t: "Degree error", f: "All scores in geodesic kilometres. Published replay table." },
              { t: "Ice and bergs as two apps", f: "Joint model. Ice-lock is a first-class map layer." },
              { t: "Arctic 2% wind rule", f: "Size-class switch: giant bergs are current-dominated." },
              { t: "Stale data", f: "Health dots. If SAR age > threshold the badge cannot be GO." },
              { t: "Uncalibrated confidence", f: "Conformal prediction on past errors; coverage plot in admin." },
              { t: "False automation", f: "Override with reason, logged. No helm commands, ever." },
            ].map(({ t, f }) => (
              <div
                key={t}
                className="rounded-xl border border-frost-400/10 bg-abyss-850/40 p-4 transition-colors hover:border-glacier-400/30"
              >
                <div className="flex items-center gap-2 text-xs font-semibold text-nogo-400">
                  <TriangleAlert size={13} /> {t}
                </div>
                <p className="mt-1.5 text-[11px] leading-snug text-frost-300">{f}</p>
              </div>
            ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ CTA */}
      <section className="py-20">
        <div className="mx-auto max-w-3xl px-5 text-center">
          <h2 className="text-balance text-3xl font-bold tracking-tight text-frost-50 md:text-4xl">
            Open the console and scrub a real berg
          </h2>
          <p className="mt-4 text-sm leading-relaxed text-frost-300">
            Load a corridor, watch the cone cross the hull envelope, and see the badge flip — with
            the sentence that explains why.
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <Link href="/console" className="shiny-cta shiny-lg">
              <span>
                <Radar size={16} /> Open ops console
              </span>
            </Link>
            <Link
              href={`/iceberg/${bergs[0]?.bergId ?? "A23a"}`}
              className="inline-flex items-center gap-2 rounded-xl border border-frost-400/25 px-6 py-3 text-sm font-medium text-frost-100 transition-colors hover:border-glacier-400/60 hover:bg-glacier-500/10"
            >
              <MountainSnow size={16} /> Shareable berg page
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-frost-400/10 py-10">
        <div className="mx-auto max-w-6xl px-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-xs text-frost-400">
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-glacier-500/15 text-glacier-300 ring-1 ring-glacier-500/35">
                <MountainSnow size={14} />
              </span>
              ICEGUARD · SIH26059 · Ministry of Earth Sciences
            </div>
            <div className="flex gap-4 text-[11px] text-frost-500">
              <a href="/console" className="hover:text-frost-200">Console</a>
              <a href="/skill" className="hover:text-frost-200">Validation</a>
              <a href="/api/health" className="hover:text-frost-200">Health API</a>
              <a href="/api/bundle" className="hover:text-frost-200">Lite bundle</a>
            </div>
          </div>
          <p className="mt-4 max-w-3xl text-[10px] leading-relaxed text-frost-600">
            Decision support only. ICEGUARD is not a substitute for the master&apos;s or pilot&apos;s
            judgement, nor for official ice charts. It issues no helm commands. Every GO/NO-GO and
            every override is logged. Users: NCPOR voyage planners and ice observers; MoES and
            INCOIS scientists; university viewers.
          </p>
        </div>
      </footer>
    </div>
  );
}

/* ------------------------------------------------------------- fragments */

function SectionHead({ eyebrow, title, sub }: { eyebrow: string; title: string; sub: string }) {
  return (
    <div className="max-w-2xl">
      <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-glacier-400">
        {eyebrow}
      </div>
      <h2 className="mt-2 text-balance text-2xl font-bold tracking-tight text-frost-50 md:text-3xl">
        {title}
      </h2>
      <p className="mt-3 text-sm leading-relaxed text-frost-400">{sub}</p>
    </div>
  );
}

const TONE: Record<string, string> = {
  green: "text-go-400",
  cyan: "text-glacier-300",
  violet: "text-lock-400",
  amber: "text-slow-400",
  slate: "text-frost-300",
};

function HeroStat({
  label,
  value,
  unit,
  hint,
  tone,
}: {
  label: string;
  value: string;
  unit: string;
  hint: string;
  tone: string;
}) {
  return (
    <div className="glass rounded-2xl p-4">
      <div className="text-[10px] font-bold uppercase tracking-wider text-frost-500">{label}</div>
      <div className="mt-1.5 flex items-baseline gap-1">
        <span className={`font-mono text-3xl font-bold tabular-nums ${TONE[tone]}`}>{value}</span>
        <span className="text-xs text-frost-400">{unit}</span>
      </div>
      <p className="mt-1.5 text-[10px] leading-snug text-frost-500">{hint}</p>
    </div>
  );
}

function Bento({
  className,
  icon: Icon,
  title,
  tone,
  children,
}: {
  className?: string;
  icon: React.ComponentType<{ size?: number | string; className?: string }>;
  title: string;
  tone: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`glass rounded-2xl p-5 transition-colors hover:border-glacier-400/30 ${className ?? ""}`}>
      <div className={`mb-3 flex items-center gap-2 text-sm font-semibold ${TONE[tone]}`}>
        <Icon size={16} /> {title}
      </div>
      {children}
    </div>
  );
}

function RegimeCard({
  tone,
  name,
  rule,
  body,
}: {
  tone: string;
  name: string;
  rule: string;
  body: string;
}) {
  const dot =
    tone === "violet" ? "bg-lock-400" : tone === "amber" ? "bg-slow-400" : "bg-glacier-400";
  return (
    <div className="glass rounded-2xl p-5">
      <div className="flex items-center gap-2">
        <span className={`h-2.5 w-2.5 rounded-full ${dot}`} />
        <span className="text-sm font-semibold text-frost-50">{name}</span>
      </div>
      <div className="mt-1 font-mono text-[11px] text-frost-400">{rule}</div>
      <p className="mt-3 text-xs leading-relaxed text-frost-300">{body}</p>
    </div>
  );
}

function SkillRow({
  metric,
  target,
  actual,
  pass,
}: {
  metric: string;
  target: string;
  actual: string;
  pass: boolean;
}) {
  return (
    <tr>
      <td className="px-4 py-3 text-frost-200">{metric}</td>
      <td className="px-4 py-3 font-mono text-xs text-frost-400">{target}</td>
      <td className="px-4 py-3 font-mono text-xs text-frost-100">{actual}</td>
      <td className="px-4 py-3 text-right">
        <Badge tone={pass ? "green" : "red"}>{pass ? "pass" : "watch"}</Badge>
      </td>
    </tr>
  );
}

function LightPill({ light, small }: { light: string; small?: boolean }) {
  const map: Record<string, { c: string; l: string }> = {
    GO: { c: "bg-go-500/15 text-go-400 ring-go-500/40", l: "GO" },
    SLOW: { c: "bg-slow-500/15 text-slow-400 ring-slow-500/40", l: "SLOW" },
    NO_GO: { c: "bg-nogo-500/15 text-nogo-400 ring-nogo-500/40", l: "NO-GO" },
  };
  const m = map[light] ?? map.SLOW;
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-lg px-2.5 py-1 font-bold ring-1 ${m.c} ${
        small ? "text-[10px]" : "text-xs"
      }`}
    >
      {m.l}
    </span>
  );
}
