import type { Metadata, Viewport } from "next";
import { HranessSiteFooter } from "@hraness/site-footer/react";
import { DesignPaletteProvider, ThemeColorSync } from "@hraness/design-kit/react";
import { ohDefaultAppearance, ohInitialTheme } from "../appearance";
import { ohSupportProfile } from "../../src/support-profile";
import { FoilController } from "./foil-controller";
import { homeDescription as description, homeImageAlt } from "./metadata-copy";
import "./globals.css";

const title = "Oh: Agent memory that shows its work.";

export const metadata: Metadata = {
  metadataBase: new URL("https://oh.computer"),
  title,
  description,
  alternates: { canonical: "/" },
  icons: {
    icon: [{ type: "image/svg+xml", url: "/favicon.svg" }],
  },
  openGraph: {
    title,
    description,
    images: [{
      alt: homeImageAlt,
      height: 630,
      url: "/opengraph-image",
      width: 1200,
    }],
    siteName: "Oh",
    type: "website",
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: [{ alt: homeImageAlt, url: "/opengraph-image" }],
  },
};

export const viewport: Viewport = {
  themeColor: [
    { color: "#fbf1c7", media: "(prefers-color-scheme: light)" },
    { color: "#282828", media: "(prefers-color-scheme: dark)" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html className={ohInitialTheme.className} data-palette={ohDefaultAppearance.palette} data-hraness-theme="paper" lang="en" suppressHydrationWarning>
      <head>
        {/* Apply a saved preference before paint. This is a same-origin, build-owned script. */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="/theme-bootstrap.js" />
      </head>
      <body>
        <DesignPaletteProvider defaultPreference={ohDefaultAppearance}>
        <ThemeColorSync />
        {children}
        <div className="network-footer">
          <HranessSiteFooter placement="flow" mailingList={{ kind: "none" }} support={ohSupportProfile} />
        </div>
        <FoilController />
        </DesignPaletteProvider>
      </body>
    </html>
  );
}
