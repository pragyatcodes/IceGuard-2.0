"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { LiquidButton } from "@/components/ui/liquid-glass-button";
import { cn } from "@/lib/utils";

/**
 * Navigation helper around LiquidButton.
 * LiquidButton's asChild/Slot path cannot work (it renders 4 internal
 * children), so we navigate via router.push on a real button instead.
 */
export function LiquidLink({
  href,
  buttonClassName,
  children,
}: {
  href: string;
  buttonClassName?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const go = () => {
    if (href.startsWith("#")) {
      document
        .getElementById(href.slice(1))
        ?.scrollIntoView({ behavior: "smooth" });
    } else {
      router.push(href);
    }
  };
  return (
    <LiquidButton size="sm" className={buttonClassName} onClick={go}>
      <span className="flex items-center gap-2">{children}</span>
    </LiquidButton>
  );
}
