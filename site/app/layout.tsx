import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://oh.computer"),
  title: "Oh: open-source tools for agentic research",
  description:
    "A local-first ontology kernel, SQLite store, SDK, CLI, and agent skill that takes research from question to inspectable artifact.",
  alternates: { canonical: "/" },
  icons: {
    icon: [{ type: "image/svg+xml", url: "/favicon.svg" }],
  },
  openGraph: {
    title: "Oh: open-source tools for agentic research",
    description:
      "Take research from question to inspectable artifact with local records, claims, citations, and verifiable operation history.",
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
    title: "Oh: open-source tools for agentic research",
    description:
      "Take research from question to inspectable artifact with local records, claims, citations, and verifiable operation history.",
    images: ["/og.png"],
  },
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
