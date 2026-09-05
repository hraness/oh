import type { Metadata, Viewport } from "next";
import "./globals.css";

const title = "Oh: a research graph your agents can inspect";
const description =
  "Oh gives your agents a local path from a question to a cited artifact: sources, claims, citations, and a verifiable history of every change, in one SQLite file on your machine.";

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
      alt: "open-source tools for agentic research",
      height: 630,
      url: "/og.png",
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
    images: ["/og.png"],
  },
};

export const viewport: Viewport = {
  themeColor: [
    { color: "#fbfaf6", media: "(prefers-color-scheme: light)" },
    { color: "#121614", media: "(prefers-color-scheme: dark)" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
