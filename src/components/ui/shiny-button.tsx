"use client";

import type React from "react";

/**
 * "Shiny CTA" button, integrated from the 21st.dev recipe.
 *
 * The component stays markup-only; every style lives in globals.css under the
 * `.shiny-cta` section (ported verbatim from the recipe, themed to the
 * glacier palette, Google-Fonts import dropped so the app stays
 * network-free). Works on <button> here and on <a> in server components by
 * applying the same `shiny-cta` class.
 */
interface ShinyButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
  size?: "sm" | "md" | "lg";
}

export function ShinyButton({ children, className = "", size = "md", ...rest }: ShinyButtonProps) {
  return (
    <button className={`shiny-cta shiny-${size} ${className}`} {...rest}>
      <span>{children}</span>
    </button>
  );
}
