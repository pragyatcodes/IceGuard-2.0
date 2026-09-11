import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeft, CheckCircle2, TriangleAlert } from "lucide-react";
import { replaySummary, calibrationScoresSet, FIT_IDS } from "@/lib/pipeline/replay";
import { calibrationCurve, conformalQuantile, empiricalCoverage } from "@/lib/stats/conformal";
import { DEFAULT_RESIDUAL_MODEL } from "@/lib/physics/residual";
import { fmt } from "@/lib/utils";
import { Badge } from "@/components/ui/primitives";

export const metadata: Metadata = {
  title: "Replay & skill",
  description:
    "ICEGUARD replay harness: geodesic MAE in kilometres for physics-only vs physics+residual, a per-season split, and the conformal calibration curve.",
};

export const dynamic = "force-dynamic";

export default function SkillPage() {
  const summary = replaySummary();
  const scores = calibrationScoresSet();
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

  const giants = summary.results.filter((r) => r.sizeClass === "GIANT");
  const giantPhysics = mean(giants.map((r) => r.physicsKm.h72));
  const giantModel = mean(giants.map((r) => r.modelKm.h72));

  const radii = {
    h24: conformalQuantile(scores.h24, 0.9),
    h48: conformalQuantile(scores.h48, 0.9),
    h72: conformalQuantile(scores.h72, 0.9),
  };
  const curve = calibrationCurve(scores.h72);

  const classes = ["GIANT", "LARGE", "MEDIUM", "SMALL"] as const;

  return (
    <div className="min-h-screen pb-20">
      <header className="sticky top-0 z-40 border-b border-frost-400/10 bg-abyss-950/85 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-5">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs text-frost-400 transition-colors hover:text-frost-100"
          >
            <ArrowLeft size={13} /> ICEGUARD
          </Link>
          <span className="text-sm font-semibold text-frost-50">Replay &amp; skill</span>
          <Link
            href="/console"
            className="ml-auto rounded-lg bg-glacier-500 px-3 py-1.5 text-xs font-semibold text-abyss-950 hover:bg-glacier-400"
          >
            Console
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 pt-10">
        <div className="max-w-2xl">
          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-glacier-400">
            §6.6 · §11
          </div>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-frost-50">
            Prove it in kilometres
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-frost-300">
            Every number on this page is computed by the same pipeline the console uses, at request
            time. Scores are geodesic kilometres — never degrees, because near the pole 1° of
            longitude is not a kilometre (L4).
          </p>
        </div>

        {/* Headline */}
        <section className="mt-8 grid gap-4 md:grid-cols-3">
          <BigStat
            label="72 h giant-berg MAE"
            target="< 25 km"
            physics={giantPhysics}
            model={giantModel}
            pass={giantModel < 25}
          />
          <BigStat
            label="72 h all-berg MAE"
            target="informational"
            physics={summary.maeKm.physics.h72}
            model={summary.maeKm.model.h72}
            pass
          />
          <div className="glass rounded-2xl p-5">
            <div className="text-[10px] font-bold uppercase tracking-wider text-frost-500">
              Cone honesty
            </div>
            <div className="mt-2 flex items-baseline gap-1.5">
              <span className="font-mono text-3xl font-bold text-lock-400">
                {(empiricalCoverage(scores.h72, radii.h72) * 100).toFixed(1)}%
              </span>
              <span className="text-xs text-frost-400">inside the 90% cone</span>
            </div>
            <p className="mt-2 text-[10px] leading-snug text-frost-500">
              n={scores.h72.length} held-out cases. Split conformal guarantees at least the nominal
              coverage; overshoot is the finite-sample price of honesty, not a bug.
            </p>
          </div>
        </section>

        {/* Per horizon */}
        <section className="mt-10">
          <h2 className="text-sm font-semibold text-frost-50">Error by horizon</h2>
          <div className="mt-3 overflow-hidden rounded-2xl border border-frost-400/12">
            <table className="w-full text-sm">
              <thead className="bg-abyss-850/80 text-left text-[10px] uppercase tracking-wider text-frost-500">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Horizon</th>
                  <th className="px-4 py-2.5 font-semibold">Physics only</th>
                  <th className="px-4 py-2.5 font-semibold">+ residual</th>
                  <th className="px-4 py-2.5 font-semibold">Improvement</th>
                  <th className="px-4 py-2.5 font-semibold">90% cone radius</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-frost-400/8 bg-abyss-900/40 font-mono text-xs">
                {([
                  ["24 h", "h24", radii.h24],
                  ["48 h", "h48", radii.h48],
                  ["72 h", "h72", radii.h72],
                ] as const).map(([label, key, radius]) => {
                  const p = summary.maeKm.physics[key];
                  const m = summary.maeKm.model[key];
                  const imp = ((p - m) / p) * 100;
                  return (
                    <tr key={key}>
                      <td className="px-4 py-2.5 text-frost-200">{label}</td>
                      <td className="px-4 py-2.5 text-frost-400">{fmt(p, 2)} km</td>
                      <td className="px-4 py-2.5 text-go-400">{fmt(m, 2)} km</td>
                      <td className="px-4 py-2.5 text-frost-300">{imp.toFixed(1)}%</td>
                      <td className="px-4 py-2.5 text-lock-400">{fmt(radius, 1)} km</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <div className="mt-10 grid gap-6 lg:grid-cols-2">
          {/* By size class */}
          <section>
            <h2 className="text-sm font-semibold text-frost-50">By size class</h2>
            <p className="mt-1 text-[11px] text-frost-500">
              Giant tabular bergs are current-dominated; small bergs feel the wind (L6).
            </p>
            <div className="mt-3 space-y-2">
              {classes.map((sc) => {
                const rows = summary.results.filter((r) => r.sizeClass === sc);
                const p = mean(rows.map((r) => r.physicsKm.h72));
                const m = mean(rows.map((r) => r.modelKm.h72));
                return (
                  <div key={sc} className="rounded-xl border border-frost-400/10 bg-abyss-850/40 p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-frost-100">{sc}</span>
                      <span className="font-mono text-[10px] text-frost-500">n={rows.length}</span>
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <Bar value={p} max={12} className="bg-frost-500" />
                      <span className="w-16 shrink-0 text-right font-mono text-[10px] text-frost-400">
                        {fmt(p, 2)} km
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <Bar value={m} max={12} className="bg-go-400" />
                      <span className="w-16 shrink-0 text-right font-mono text-[10px] text-go-400">
                        {fmt(m, 2)} km
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Calibration curve */}
          <section>
            <h2 className="text-sm font-semibold text-frost-50">Calibration curve</h2>
            <p className="mt-1 text-[11px] text-frost-500">
              Softmax 0.99 is not 99% true (L11). Observed coverage should track the diagonal.
            </p>
            <div className="mt-3 rounded-xl border border-frost-400/10 bg-abyss-850/40 p-4">
              <CalibrationPlot curve={curve} />
              <div className="mt-3 grid grid-cols-3 gap-2">
                {curve.map((p) => (
                  <div
                    key={p.nominal}
                    className="rounded-lg border border-frost-400/10 bg-abyss-900/60 px-2 py-1.5 text-center"
                  >
                    <div className="font-mono text-[10px] text-frost-400">
                      {(p.nominal * 100).toFixed(0)}%
                    </div>
                    <div className="font-mono text-xs font-semibold text-lock-400">
                      {(p.observed * 100).toFixed(0)}%
                    </div>
                    <div className="font-mono text-[9px] text-frost-600">r={p.radiusKm.toFixed(1)}</div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>

        {/* Seasonal split */}
        <section className="mt-10">
          <h2 className="text-sm font-semibold text-frost-50">Seasonal split (L12)</h2>
          <p className="mt-1 max-w-2xl text-[11px] text-frost-500">
            A model trained on summer and used in freeze-up is a different problem. We publish the
            split rather than claim a single number — and we do not claim winter skill from two
            cases.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-4">
            {Object.entries(summary.bySeason).map(([season, v]) => (
              <div key={season} className="rounded-xl border border-frost-400/10 bg-abyss-850/40 p-3">
                <div className="text-xs font-semibold capitalize text-frost-100">
                  {season.toLowerCase()}
                </div>
                <div className="mt-1 font-mono text-xl font-bold text-glacier-300">
                  {fmt(v.maeKm72, 1)}
                  <span className="ml-1 text-xs text-frost-400">km</span>
                </div>
                <div className="mt-0.5 text-[10px] text-frost-500">{v.n} cases</div>
              </div>
            ))}
          </div>
        </section>

        {/* Residual model card */}
        <section className="mt-10">
          <h2 className="text-sm font-semibold text-frost-50">Residual model card</h2>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <div className="glass rounded-2xl p-4">
              <div className="text-[10px] font-bold uppercase tracking-wider text-frost-500">Version</div>
              <div className="mt-1 font-mono text-sm text-frost-100">
                {DEFAULT_RESIDUAL_MODEL.version}
              </div>
              <div className="mt-2 text-[10px] text-frost-500">
                Clamp ±{DEFAULT_RESIDUAL_MODEL.maxCorrection} m/s — a runaway net cannot steer a berg.
              </div>
            </div>
            <div className="glass rounded-2xl p-4">
              <div className="text-[10px] font-bold uppercase tracking-wider text-frost-500">
                Fitted weights
              </div>
              <div className="mt-1.5 space-y-1 font-mono text-[11px] text-frost-200">
                {Object.entries(DEFAULT_RESIDUAL_MODEL.weights).map(([k, v]) => (
                  <div key={k} className="flex justify-between">
                    <span className="text-frost-400">{k}</span>
                    <span>{Number(v).toFixed(4)}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="glass rounded-2xl p-4">
              <div className="text-[10px] font-bold uppercase tracking-wider text-frost-500">
                Honest caveat
              </div>
              <p className="mt-1.5 text-[11px] leading-snug text-frost-300">
                The climatological term does all of the work. The keel-shape and ice-stress bases
                earn nothing out of sample and are the first things to prune.
              </p>
            </div>
          </div>
        </section>

        {/* Case table */}
        <section className="mt-10">
          <h2 className="text-sm font-semibold text-frost-50">Held-out cases</h2>
          <p className="mt-1 text-[11px] text-frost-500">
            Alternating cases are used to fit the residual; the rest are scored. Errors are 72-hour
            geodesic kilometres.
          </p>
          <div className="mt-3 overflow-x-auto rounded-2xl border border-frost-400/12">
            <table className="w-full text-sm">
              <thead className="bg-abyss-850/80 text-left text-[10px] uppercase tracking-wider text-frost-500">
                <tr>
                  <th className="px-3 py-2.5 font-semibold">Case</th>
                  <th className="px-3 py-2.5 font-semibold">Berg</th>
                  <th className="px-3 py-2.5 font-semibold">Class</th>
                  <th className="px-3 py-2.5 font-semibold">Season</th>
                  <th className="px-3 py-2.5 font-semibold">Split</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Physics 72 h</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Model 72 h</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-frost-400/8 bg-abyss-900/40 font-mono text-[11px]">
                {summary.results.map((r) => (
                  <tr key={r.caseId}>
                    <td className="px-3 py-2 text-frost-400">{r.caseId}</td>
                    <td className="px-3 py-2 text-frost-100">{r.bergId}</td>
                    <td className="px-3 py-2 text-frost-400">{r.sizeClass}</td>
                    <td className="px-3 py-2 capitalize text-frost-400">{r.season.toLowerCase()}</td>
                    <td className="px-3 py-2">
                      <Badge tone={FIT_IDS.has(r.caseId) ? "slate" : "cyan"}>
                        {FIT_IDS.has(r.caseId) ? "fit" : "holdout"}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-right text-frost-400">
                      {fmt(r.physicsKm.h72, 2)}
                    </td>
                    <td
                      className={`px-3 py-2 text-right ${
                        r.modelKm.h72 < r.physicsKm.h72 ? "text-go-400" : "text-nogo-400"
                      }`}
                    >
                      {fmt(r.modelKm.h72, 2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <p className="mt-8 rounded-xl border border-frost-400/10 bg-abyss-850/40 p-4 text-[11px] leading-relaxed text-frost-400">
          <strong className="text-frost-200">What we still cannot honestly promise:</strong>{" "}
          metre-level berg outlines in a blizzard with no SAR pass; the exact hour a giant berg will
          calve; a route that is safe without a human lookout; or skill equal to a national ice
          service on day one. We show replay skill, not a fake certificate.
        </p>
      </main>
    </div>
  );
}

function BigStat({
  label,
  target,
  physics,
  model,
  pass,
}: {
  label: string;
  target: string;
  physics: number;
  model: number;
  pass: boolean;
}) {
  const imp = ((physics - model) / physics) * 100;
  return (
    <div className="glass rounded-2xl p-5">
      <div className="flex items-start justify-between gap-2">
        <div className="text-[10px] font-bold uppercase tracking-wider text-frost-500">{label}</div>
        <span
          className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase ${
            pass ? "bg-go-500/12 text-go-400" : "bg-nogo-500/12 text-nogo-400"
          }`}
        >
          {pass ? <CheckCircle2 size={10} /> : <TriangleAlert size={10} />}
          {pass ? "pass" : "watch"}
        </span>
      </div>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span className="font-mono text-3xl font-bold text-go-400">{fmt(model, 2)}</span>
        <span className="text-xs text-frost-400">km</span>
      </div>
      <div className="mt-1.5 font-mono text-[10px] text-frost-500">
        {fmt(physics, 2)} km physics-only → {imp.toFixed(1)}% better
      </div>
      <div className="mt-0.5 text-[10px] text-frost-500">target {target}</div>
    </div>
  );
}

function Bar({ value, max, className }: { value: number; max: number; className: string }) {
  return (
    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-abyss-700">
      <div
        className={`h-full rounded-full ${className}`}
        style={{ width: `${Math.min(100, (value / max) * 100)}%` }}
      />
    </div>
  );
}

function CalibrationPlot({
  curve,
}: {
  curve: { nominal: number; radiusKm: number; observed: number }[];
}) {
  const W = 320;
  const H = 200;
  const pad = 28;
  const x = (v: number) => pad + v * (W - pad * 2);
  const y = (v: number) => H - pad - v * (H - pad * 2);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Calibration curve">
      {/* grid */}
      {[0, 0.25, 0.5, 0.75, 1].map((g) => (
        <g key={g}>
          <line x1={x(g)} y1={pad} x2={x(g)} y2={H - pad} stroke="#22395f" strokeWidth="0.5" />
          <line x1={pad} y1={y(g)} x2={W - pad} y2={y(g)} stroke="#22395f" strokeWidth="0.5" />
        </g>
      ))}
      {/* perfect diagonal */}
      <line
        x1={x(0)}
        y1={y(0)}
        x2={x(1)}
        y2={y(1)}
        stroke="#5f90bd"
        strokeWidth="1"
        strokeDasharray="4 3"
      />
      {/* observed */}
      <polyline
        points={curve.map((p) => `${x(p.nominal)},${y(p.observed)}`).join(" ")}
        fill="none"
        stroke="#b79bff"
        strokeWidth="2"
      />
      {curve.map((p) => (
        <circle key={p.nominal} cx={x(p.nominal)} cy={y(p.observed)} r="3" fill="#b79bff" />
      ))}
      <text x={W / 2} y={H - 6} textAnchor="middle" fontSize="8" fill="#5f90bd">
        nominal coverage
      </text>
      <text
        x={10}
        y={H / 2}
        textAnchor="middle"
        fontSize="8"
        fill="#5f90bd"
        transform={`rotate(-90 10 ${H / 2})`}
      >
        observed
      </text>
    </svg>
  );
}
