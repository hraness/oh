import { DocsPage, docsMetadata } from "./docs-page";

export const metadata = docsMetadata("/docs");

export default function Docs() {
  return <DocsPage path="/docs" />;
}
