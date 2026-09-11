# ICEGUARD

**Antarctic sea-ice & iceberg trajectory Decision Support System.**
Smart India Hackathon 2026 · Problem ID **SIH26059** · Ministry of Earth Sciences (MoES) · NCPOR / INCOIS

> **Decision support only.** ICEGUARD is not an autopilot. It issues no helm command and does not
> replace the master's or pilot's judgement, or official ice charts. It will not answer beyond
> 72 hours — longer berg paths are usually fantasy.

---

## Why it exists

Shipping through the Southern Ocean is a guessing game. Official ice charts land on a bridge
**2–5 days late** at 5–10 km resolution, while a berg drifts 1–40 km in that window. A 20 km
position error at 72 h is the difference between "clear water" and "hull breach."

ICEGUARD is a software-only DSS: no hardware, no IoT, no on-site deployment.

---

## The three claims, and the evidence for each

| Claim | Measured here | Target |
|---|---|---|
| Geodesic MAE at 72 h | **5.58 km** (all classes) · **4.75 km** giant | < 25 km |
| True position inside the 90% cone | **91.7%** (n = 84) | ≈ 90% |
| SAR detection F1 | **0.83** | > 0.80 |

All errors are **geodesic kilometres** — never degrees. One degree at 70°S is ≈ 38 km of
east-west error; quoting degrees flatters the model at exactly the latitudes that matter (L4).

Reproduce with:

```bash
npm run db:seed      # regenerates prisma/dev.db from the live pipeline
npm run fit:residual # re-fits the residual weights from the replay set
npx tsx --tsconfig tsconfig.json scripts/skill.ts
```

---

## Architecture: physics first, AI second

```
   forcing fields ──► force balance (RK4) ──► physics trajectory
   (wind, current,          │                       │
    SIC, thickness)         │                       ▼
                            │              residual corrector (L2)
                            │              3 learned scalars × basis
                            │              clamped to ±0.02 m/s
                            ▼                       │
                     conformal cone ◄───────────────┘
                     (90%, n=84, never shrinks
                      below 1.96·ensemble σ)
                            │
                            ▼
                     route scorer ──► GO / SLOW / NO-GO
```

**The AI never sets the trajectory.** It corrects the residual the physics leaves behind, in
**velocity** units, applied outside the force balance, and is capped so it cannot dominate. If the
residual is removed entirely, the system still produces defensible numbers — it just gets ~22%
worse. That asymmetry is deliberate (L2, §3.4): *"AI predicts the residual, not the trajectory."*

### Three regimes (L6)

| Regime | Condition | Behaviour |
|---|---|---|
| `OPEN` | SIC < 0.15 | Free drift: Coriolis + wind + current |
| `DRAG` | 0.15 ≤ SIC < 0.90 | Pack-ice stress opposes motion |
| `LOCK` | SIC ≥ 0.90 **and** thickness ≥ 0.8 m | Velocity snaps to ice velocity; AI is bypassed |

`LOCK` is not cosmetic. `integrateTrajectory` overwrites the berg's own u/v, speed, heading and
force breakdown with the **ice velocity** on the locked sample, and the residual corrector is
skipped when the next step is locked — because in locked pack the physics *is* correct and a
learned correction can only hurt (L5).

### Uncertainty is a cone, not a line (L3)

A thin track invites an operator to treat a guess as truth. One miss destroys trust. Every piece
of advice here is a cone, and the verdict is computed from the **cone boundary**, never the centre
line. The cross-track semi-axis is

```
max( conformal radius , 1.96 × ensemble σ , 1.5 km )
```

so the conformal floor can widen the cone but nothing can collapse it to a point (L11). With no
calibration data the quantile is `+Infinity` — the system refuses to say GO rather than guessing.

---

## Decision logic

Evaluated in order, first match wins, in `src/lib/scoring/route-scorer.ts`:

1. model confidence < floor → **NO-GO**
2. cone crosses the hull envelope → **NO-GO**
3. SIC ≥ blocking SIC **and** thickness ≥ blocking thickness → **NO-GO**
4. cone grazes the buffer → **SLOW**
5. SIC ≥ moderate SIC → **SLOW**
6. otherwise → **GO**

**L8 post-pass:** if the SAR scene is older than `maxDataAgeH`, a GO is capped to SLOW. A NO-GO is
never *upgraded* on stale data. Every verdict carries a human-readable reason, the dominant force,
and a time-to-hazard in hours.

Thresholds are **configurable per hull class** and stored in the database, not hardcoded:

| Hull | Blocking SIC | Blocking thickness | Standoff |
|---|---|---|---|
| 1A | 0.97 | 1.5 m | 2 km |
| 1C | 0.93 | 1.0 m | 3 km |
| non-ice | 0.60 | 0.3 m | 6 km |

---

## Running it

```bash
npm install            # postinstall runs prisma generate
npm run db:seed        # creates prisma/dev.db
npm run dev            # http://localhost:3000
```

| Route | What it is |
|---|---|
| `/` | Public landing page |
| `/console` | The ops console — chart, corridors, verdicts, scrubber |
| `/skill` | Measured accuracy, calibration curve, held-out replay |
| `/iceberg/[id]` | Shareable per-berg page (server-rendered SVG, works with JS off) |
| `/login` | Sign-in with the three demo roles |
| `/api/*` | Health, icebergs, voyages, score, skill, bundle, override, auth |

Demo accounts: `viewer@iceguard.in/viewer123` (VIEWER),
`operator@ncpor.in/operator123` (OPERATOR), `admin@moes.gov.in/admin123` (ADMIN).
Only OPERATOR/ADMIN can override, and every override needs a ≥12-character reason that lands in
the audit log.

### Verification

```bash
npm run verify    # vitest (85 tests) && tsc --noEmit && next build
```

### Deploying — get a public, shareable URL

Everything animated (the WebGL globe, the shader backdrop, the shiny CTAs) is bundled
client-side with **no external assets, keys or CDNs**, so any real deployment keeps the full
UI/UX for anyone who opens the link. The `build` script now generates the Prisma client,
pushes the schema and seeds the database, so a container host works turn-key.

**Path 1 — Render.com (recommended, zero code changes).**
1. Push this folder to a GitHub repo.
2. Render → *New → Web Service* → connect the repo.
3. Build command `npm ci && npm run build`, start command `npm run start`.
4. Env vars: `AUTH_SECRET` (any long random string). SQLite + seed are baked at build;
   runtime writes persist until the next deploy. Free tier sleeps after idle.
5. Deploy → `https://iceguard.onrender.com`. Share that link.

**Path 2 — Vercel + Neon (persistent writes, free tiers).**
1. Create a free Neon Postgres and copy its `DATABASE_URL`.
2. In `prisma/schema.prisma` set `provider = "postgresql"` (the swap is documented in-file).
3. Set `DATABASE_URL` and `AUTH_SECRET` in the Vercel project env; the build pushes + seeds
   against Neon automatically. Import the repo → deploy → `https://iceguard.vercel.app`.

**Path 3 — instant demo from your laptop (no cloud account).**
`npm run build && npm run start`, then expose it:
`npx localtunnel --port 3000` (or ngrok). You get a temporary public URL for as long as the
machine runs — ideal for a live judging session.

`NEXT_PUBLIC_APP_URL` and `AUTH_SECRET` are the only env vars; `.env.example` lists them.
There are no external API keys and no tile-server dependency, so the deployed site makes no
third-party network calls.

---

## Ops bundle

`GET /api/bundle` returns tracks, cones and an ice raster. Measured: **46 KB** standard,
**23 KB** lite — well inside the 5–20 MB allowance a station link can absorb (§6.6). The chart is a
self-contained canvas polar-stereographic renderer, so there is no tile server, no API key and no
external network call anywhere in the UI.

---

## Honest limitations

1. **The forcing fields are synthetic.** There is no live SAR ingest in this sandbox. The
   `seaIceConcentration` / `iceThicknessM` / `wind` / `current` functions in
   `src/lib/fields/forcing.ts` are calibrated to plausible Southern-Ocean climatology so the
   pipeline is exercised end-to-end. Every consumer reads them through `forcingAt`, so swapping in
   real feeds touches one function.
2. **The skill numbers are self-reported.** They come from a replay of 14 synthetic cases expanded
   across 6 start dates (n = 84). They validate the *pipeline*, not a production model.
3. **A berg cone never triggers NO-GO on the seeded data.** Both seeded corridors genuinely stay
   clear — E-07 drifts east away from the Maitri approach. The console exposes corridor, speed,
   buffer, hull and threshold overrides (`POST /api/voyages/[id]/score`) so an operator can
   reproduce a NO-GO live; routing through E-07's T+43 h position does exactly that.

---

## Deviation from the original analysis

§6.2 of the design specifies **FastAPI (Python) + React + MapLibre + PostGIS**. This build is a
**Next.js 15 monolith** with Route Handlers, **Prisma + SQLite**, and a custom canvas chart.

The reasons: the build environment has no Docker and no Postgres server, and no tile-server key was
available. None of these are load-bearing for the science — the domain logic in
`src/lib/{geo,physics,stats,fields,scoring,pipeline}` is **pure TypeScript with no Next.js or
Prisma imports**, so a Python port is mechanical. `prisma/schema.prisma` documents the Postgres
swap in-file.

---

## The loopholes this design closes

| | |
|---|---|
| **L2** | AI as a black box instead of a residual correction |
| **L3** | Point forecasts shown without a conformal cone |
| **L4** | Error reported in degrees instead of geodesic km |
| **L5** | Learned corrections applied inside locked pack |
| **L6** | Treating all regimes as one drift model |
| **L7** | Optical-only detection presented as SAR-grade |
| **L8** | Stale SAR scenes driving a GO |
| **L11** | Cone collapsing to a point under low ensemble spread |
| **L18** | Berg paths quoted beyond 72 h |
