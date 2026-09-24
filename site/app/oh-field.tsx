"use client";

import { useEffect, useRef } from "react";
import { attachHeroLight } from "@hraness/design-kit/browser";

// A stable culture of typed records. Shared light reveals nearby organisms;
// all artwork is present before hydration and never competes with the copy.
const KINDS = [
  ["inquiry", "question → scope", "a"],
  ["evidence", "locator → support", "a"],
  ["view", "records → brief", "a"],
  ["verify", "ops → ok", "a"],
  ["entity", "source → identity", "b"],
  ["edition", "capture → bytes", "b"],
  ["digest", "bytes → sha256", "b"],
  ["projection", "log → derived", "b"],
  ["statement", "claim → stance", "c"],
  ["op", "idempotent → log", "c"],
  ["space", "records → graph", "c"],
  ["head", "generation → sha", "c"],
] as const;

export function OhField() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = ref.current?.parentElement;
    return host ? attachHeroLight(host) : undefined;
  }, []);
  return <div className="oh-field" ref={ref} aria-hidden="true" inert>
    {KINDS.map(([kind, signature, tone], index) => <div
      className={`oh-organism oo-${tone}`} data-organism={index}
      data-hraness-hero-item="" key={kind}
    >
      <span className="oh-tag"><b>{kind}</b><i>{signature}</i></span>
    </div>)}
  </div>;
}
