"use client";

import { usePathname } from "next/navigation";
import { SmokeBackground } from "@/components/iceguard/SmokeBackground";

/**
 * Site-wide oceanic backdrop. Skipped on the ops console: that screen already
 * animates the 3D globe, and running a second fullscreen WebGL layer behind
 * it doubles GPU cost on modest laptops (the reported "lag"). The console
 * keeps its own calm dark tint instead.
 */
export function SiteBackdrop() {
  const pathname = usePathname();
  if (pathname?.startsWith("/console")) return null;

  return (
    <div aria-hidden="true" className="fixed inset-0 -z-10">
      <SmokeBackground />
      <div className="absolute inset-0 bg-gradient-to-b from-abyss-950/85 via-abyss-950/75 to-abyss-950/92" />
    </div>
  );
}
