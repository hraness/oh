"use client";

import { BarListChart } from "@hraness/design-kit/react";

/** Oh and Wordcell use the same released chart and a fixed percentage scale. */
export function BenchmarkChart({ label, rows }: Readonly<{
  label: string;
  rows: readonly Readonly<{ id: string; label: string; value: number; detail?: string }>[];
}>) {
  return <BarListChart aria-label={label} data={rows} domain={[0, 100]}
    formatValue={(value) => `${value.toFixed(2)}%`} />;
}
