import type { Metadata, Viewport } from "next";
import { HranessSiteFooter } from "@hraness/site-footer/react";
import { ohSupportProfile } from "../../src/support-profile";
import { FoilController } from "./foil-controller";
import { homeDescription as description, homeTitle as title } from "./metadata-copy";
import "./globals.css";

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
      alt: title,
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
    images: ["/opengraph-image"],
  },
};

export const viewport: Viewport = {
  themeColor: [
    { color: "#f8f7f4", media: "(prefers-color-scheme: light)" },
    { color: "#12100f", media: "(prefers-color-scheme: dark)" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html data-hraness-theme="paper" lang="en">
      <body>
        {children}
        <div className="network-footer">
          <HranessSiteFooter placement="flow" mailingList={{ kind: "none" }} support={ohSupportProfile} />
        </div>
        <FoilController />
      </body>
    </html>
  );
}
