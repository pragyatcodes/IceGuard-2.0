"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ Button */

type Variant = "primary" | "ghost" | "outline" | "danger" | "subtle";
type Size = "sm" | "md" | "lg" | "icon";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-glacier-500 text-abyss-950 font-semibold hover:bg-glacier-400 shadow-[0_8px_30px_-10px] shadow-glacier-500/60",
  ghost: "text-frost-200 hover:text-frost-50 hover:bg-frost-400/10",
  outline:
    "border border-frost-400/25 text-frost-100 hover:border-glacier-400/60 hover:bg-glacier-500/10",
  danger: "bg-nogo-500 text-white font-semibold hover:bg-nogo-400",
  subtle: "bg-abyss-800 text-frost-200 hover:bg-abyss-700 border border-frost-400/10",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 px-3 text-xs rounded-lg gap-1.5",
  md: "h-10 px-4 text-sm rounded-xl gap-2",
  lg: "h-12 px-6 text-base rounded-xl gap-2",
  icon: "h-9 w-9 rounded-lg justify-center",
};

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
}) {
  return (
    <button
      className={cn(
        "inline-flex items-center whitespace-nowrap font-medium transition-all duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-glacier-400/70",
        "disabled:pointer-events-none disabled:opacity-45 active:scale-[0.98]",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    />
  );
}

/* -------------------------------------------------------------------- Card */

export function Card({
  className,
  glow,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { glow?: boolean }) {
  return (
    <div
      className={cn(
        "glass rounded-2xl",
        glow && "glow-glacier",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({
  title,
  subtitle,
  icon,
  right,
  className,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  right?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-3 border-b border-frost-400/10 px-4 py-3",
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-2.5">
        {icon && <span className="mt-0.5 text-glacier-400">{icon}</span>}
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold tracking-tight text-frost-50">
            {title}
          </h3>
          {subtitle && (
            <p className="mt-0.5 text-[11px] leading-snug text-frost-400">
              {subtitle}
            </p>
          )}
        </div>
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------- Badge */

type Tone = "cyan" | "amber" | "red" | "violet" | "green" | "slate";

const TONES: Record<Tone, string> = {
  cyan: "bg-glacier-500/12 text-glacier-300 border-glacier-500/30",
  amber: "bg-slow-500/12 text-slow-400 border-slow-500/30",
  red: "bg-nogo-500/12 text-nogo-400 border-nogo-500/30",
  violet: "bg-lock-500/14 text-lock-400 border-lock-500/32",
  green: "bg-go-500/12 text-go-400 border-go-500/30",
  slate: "bg-frost-400/8 text-frost-300 border-frost-400/18",
};

export function Badge({
  tone = "slate",
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
        TONES[tone],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}

/* -------------------------------------------------------------------- Stat */

export function Stat({
  label,
  value,
  unit,
  hint,
  tone = "slate",
  className,
}: {
  label: string;
  value: React.ReactNode;
  unit?: string;
  hint?: string;
  tone?: Tone;
  className?: string;
}) {
  return (
    <div className={cn("rounded-xl border border-frost-400/10 bg-abyss-900/50 p-3", className)}>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-frost-400">
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className={cn("font-mono text-xl font-semibold tabular-nums", TONES[tone].split(" ")[1])}>
          {value}
        </span>
        {unit && <span className="text-[11px] text-frost-400">{unit}</span>}
      </div>
      {hint && <div className="mt-0.5 text-[10px] leading-snug text-frost-500">{hint}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ Toggle */

export function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="group flex w-full items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-frost-400/6"
    >
      <span className="min-w-0">
        <span className="block truncate text-xs font-medium text-frost-100">{label}</span>
        {hint && <span className="block truncate text-[10px] text-frost-500">{hint}</span>}
      </span>
      <span
        className={cn(
          "relative h-5 w-9 shrink-0 rounded-full border transition-colors",
          checked
            ? "border-glacier-400/60 bg-glacier-500/70"
            : "border-frost-400/20 bg-abyss-700",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-3.5 w-3.5 rounded-full bg-frost-50 transition-all",
            checked ? "left-[18px]" : "left-0.5",
          )}
        />
      </span>
    </button>
  );
}

/* ----------------------------------------------------------------- Tooltip */

export function Tip({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <span className="group/tip relative inline-flex">
      {children}
      <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 w-max max-w-[240px] -translate-x-1/2 rounded-lg border border-frost-400/20 bg-abyss-850 px-2.5 py-1.5 text-[11px] leading-snug text-frost-200 opacity-0 shadow-xl transition-opacity group-hover/tip:opacity-100">
        {text}
      </span>
    </span>
  );
}
