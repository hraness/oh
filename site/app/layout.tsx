import type { Metadata, Viewport } from "next";
import { HranessSiteFooter } from "@hraness/site-footer/react";
import { ohSupportProfile } from "../../src/support-profile";
import { FoilController } from "./foil-controller";
import "./globals.css";

const title = "Oh: memory your agents can trace";
const description =
  "An open-source memory framework for agents: source-backed records, local retrieval, graph proofs, and a verifiable change history. TypeScript SDK, CLI, and SQLite storage.";

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
      alt: "Open-source memory for agents",
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
