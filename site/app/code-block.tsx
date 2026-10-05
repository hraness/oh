import { MarketingProofFrame, SyntaxCode } from "@hraness/design-kit/react/server";

export function CodeBlock({ code, language = "typescript" }: { code: string; language?: string }) {
  return <pre tabIndex={0}><SyntaxCode code={code} language={language} styles="classes" /></pre>;
}

export function Terminal({ code }: { code: string }) {
  return <MarketingProofFrame chrome="terminal"><CodeBlock code={code} language="shell" /></MarketingProofFrame>;
}

/** Only commands get shell syntax. Captured output remains literal text. */
export function Transcript({ label, text }: { label: string; text: string }) {
  const lines = text.split("\n");
  const parts: { command: boolean; text: string }[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.startsWith("$ ")) {
      let command = line.slice(2);
      while (lines[index].endsWith("\\") && index + 1 < lines.length) {
        index += 1;
        command += `\n${lines[index]}`;
      }
      parts.push({ command: true, text: command + (index < lines.length - 1 ? "\n" : "") });
    } else {
      parts.push({ command: false, text: line + (index < lines.length - 1 ? "\n" : "") });
    }
  }
  return (
    <pre aria-label={label} className="oh-terminal" tabIndex={0}>
      {parts.map((part, index) => part.command
        ? <span key={index}>$ <SyntaxCode code={part.text} language="shell" styles="classes" /></span>
        : <span key={index}>{part.text}</span>)}
    </pre>
  );
}
