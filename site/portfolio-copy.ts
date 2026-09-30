import snapshot from "./portfolio-messaging.generated.json";
import { product as designKitProduct, type PortfolioProductId } from "@hraness/design-kit/portfolio";

// Authored copy lives in hraness/jungle. This checked snapshot keeps builds offline.
export const marketing = snapshot.messaging;
export const portfolio = snapshot;

export function marketingHeading(key: string): string {
  const headings: Readonly<Record<string, string>> = marketing.headings;
  const value = headings[key];
  if (value === undefined) throw new Error(`Missing canonical marketing heading: ${key}`);
  return value;
}

// The design kit owns artwork; the portfolio snapshot owns names, roles, and URLs.
export function product(id: PortfolioProductId) {
  const artwork = designKitProduct(id);
  const entry = snapshot.projects.find(project => project.id === id || project.messaging.names.command === id);
  if (entry === undefined) throw new Error(`Missing canonical portfolio product: ${id}`);
  return { ...artwork, name: entry.name, oneLiner: entry.description, canonicalUrl: entry.canonicalUrl, messaging: { ...artwork.messaging, names: { ...artwork.messaging.names, name: entry.name }, short: entry.description, tagline: entry.messaging.tagline } };
}
