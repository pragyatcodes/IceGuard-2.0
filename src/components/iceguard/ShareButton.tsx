"use client";

import * as React from "react";
import { Check, Share2 } from "lucide-react";

/**
 * Copies the public berg URL. Kept tiny: the page it lives on is
 * server-rendered and must be readable with JavaScript disabled.
 */
export function ShareButton({ label }: { label: string }) {
  const [copied, setCopied] = React.useState(false);

  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(window.location.href);
        } catch {
          // Clipboard can be unavailable in a sandboxed frame; fall back to
          // selecting the address rather than failing silently.
          window.prompt("Copy this link", window.location.href);
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }}
      aria-label={`Copy share link for berg ${label}`}
      className="inline-flex items-center gap-1.5 rounded-lg border border-frost-400/25 px-3 py-1.5 text-xs font-medium text-frost-100 transition-colors hover:border-glacier-400/60 hover:bg-glacier-500/10"
    >
      {copied ? <Check size={13} className="text-go-400" /> : <Share2 size={13} />}
      {copied ? "Copied" : "Share"}
    </button>
  );
}
