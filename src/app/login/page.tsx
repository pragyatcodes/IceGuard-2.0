"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { MountainSnow, Lock, ShieldCheck, Eye } from "lucide-react";
import { ShinyButton } from "@/components/ui/shiny-button";

const DEMO = [
  { email: "viewer@iceguard.in", password: "viewer123", role: "VIEWER", blurb: "Maps, replay, public layers" },
  { email: "operator@ncpor.in", password: "operator123", role: "OPERATOR", blurb: "+ GO/SLOW/NO-GO, overrides" },
  { email: "admin@moes.gov.in", password: "admin123", role: "ADMIN", blurb: "+ thresholds, model freeze" },
];

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = React.useState(DEMO[1].email);
  const [password, setPassword] = React.useState(DEMO[1].password);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "login failed");
      router.push("/console");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "login failed");
      setBusy(false);
    }
  }

  return (
    <div className="relative grid min-h-screen place-items-center px-5">
      <div className="relative w-full max-w-md">
        <div className="mb-6 flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-glacier-500/15 text-glacier-300 ring-1 ring-glacier-500/35">
            <MountainSnow size={18} />
          </span>
          <div>
            <div className="text-sm font-bold text-frost-50">ICEGUARD</div>
            <div className="text-[10px] text-frost-500">SIH26059 · MoES</div>
          </div>
        </div>

        <form onSubmit={submit} className="glass rounded-2xl p-6">
          <h1 className="text-lg font-semibold tracking-tight text-frost-50">Sign in</h1>
          <p className="mt-1 text-[11px] leading-snug text-frost-400">
            Roles follow §5.4. Every override is written to the audit log with a reason.
          </p>

          <label className="mt-5 block">
            <span className="text-[10px] font-bold uppercase tracking-wider text-frost-500">
              Email
            </span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              className="mt-1 h-10 w-full rounded-lg border border-frost-400/15 bg-abyss-850 px-3 text-sm text-frost-100 focus:border-glacier-400/60 focus:outline-none"
            />
          </label>

          <label className="mt-3 block">
            <span className="text-[10px] font-bold uppercase tracking-wider text-frost-500">
              Password
            </span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className="mt-1 h-10 w-full rounded-lg border border-frost-400/15 bg-abyss-850 px-3 text-sm text-frost-100 focus:border-glacier-400/60 focus:outline-none"
            />
          </label>

          {error && (
            <p className="mt-3 rounded-lg border border-nogo-500/30 bg-nogo-500/10 px-3 py-2 text-[11px] text-nogo-400">
              {error}
            </p>
          )}

          <ShinyButton type="submit" className="mt-5 w-full" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </ShinyButton>

          <div className="mt-5 border-t border-frost-400/10 pt-4">
            <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-frost-500">
              Demo accounts — click to fill
            </div>
            <div className="space-y-1.5">
              {DEMO.map((d) => (
                <button
                  key={d.email}
                  type="button"
                  onClick={() => {
                    setEmail(d.email);
                    setPassword(d.password);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg border border-frost-400/10 bg-abyss-850/50 px-2.5 py-2 text-left transition-colors hover:border-glacier-400/40"
                >
                  {d.role === "ADMIN" ? (
                    <ShieldCheck size={13} className="shrink-0 text-lock-400" />
                  ) : d.role === "OPERATOR" ? (
                    <Lock size={13} className="shrink-0 text-slow-400" />
                  ) : (
                    <Eye size={13} className="shrink-0 text-glacier-400" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-[11px] text-frost-200">
                      {d.email}
                    </span>
                    <span className="block truncate text-[10px] text-frost-500">{d.blurb}</span>
                  </span>
                  <span className="shrink-0 text-[9px] font-bold uppercase tracking-wider text-frost-500">
                    {d.role}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
