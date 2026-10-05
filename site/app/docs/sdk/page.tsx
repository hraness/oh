import { DocsPage, docsMetadata } from "../docs-page";

export const metadata = docsMetadata("/docs/sdk");

export default function SdkDocs() {
  return <DocsPage path="/docs/sdk" />;
}
