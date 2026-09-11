import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SmokeBackground } from "@/components/iceguard/SmokeBackground";

const SITE = "ICEGUARD";
const TITLE = "ICEGUARD — Antarctic sea-ice & iceberg navigation decision support";
const DESC =
  "AI-enabled Antarctic sea-ice, iceberg trajectory and navigation decision support system. Physics-first drift, conformal 90% uncertainty cones, and an auditable GO / SLOW / NO-GO for every corridor. SIH26059 · Ministry of Earth Sciences.";

export const metadata: Metadata = {
  title: { default: TITLE, template: `%s · ${SITE}` },
  description: DESC,
  applicationName: SITE,
  keywords: [
    "ICEGUARD",
    "SIH26059",
    "MoES",
    "NCPOR",
    "INCOIS",
    "Antarctic",
    "sea ice",
    "iceberg trajectory",
    "navigation",
    "decision support",
    "conformal prediction",
    "Sentinel-1",
    "SAR",
  ],
  authors: [{ name: "Team ICEGUARD" }],
  openGraph: {
    type: "website",
    siteName: SITE,
    title: TITLE,
    description: DESC,
  },
  twitter: { card: "summary_large_image", title: TITLE, description: DESC },
};

export const viewport: Viewport = {
  themeColor: "#030711",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        {/* Site-wide oceanic backdrop; the veil is graded so type stays
            readable where the shader runs bright. */}
        <div aria-hidden="true" className="fixed inset-0 -z-10">
          <SmokeBackground />
          <div className="absolute inset-0 bg-gradient-to-b from-abyss-950/85 via-abyss-950/75 to-abyss-950/92" />
        </div>
        {children}
      </body>
    </html>
  );
}
