"use client";

import { Globe } from "lucide-react";

/**
 * Small chip rendered on suggestion cards whose `needsWebSearch` flag is
 * true. Purely presentational — clicking the parent card still fires the
 * normal `onSuggestionClick`; the chip is just an affordance.
 *
 * Kept as its own file so the whole web-search feature can be removed by
 * deleting it + src/lib/websearch.ts + src/app/api/websearch without
 * touching any shared UI primitives.
 */
export function WebSearchChip() {
  return (
    <span
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium tracking-wide"
      style={{
        background: "rgba(56,189,248,0.10)",
        color: "#7dd3fc",
        border: "1px solid rgba(56,189,248,0.28)",
      }}
      title="This card needs live data — clicking runs a web search before answering."
    >
      <Globe size={10} />
      click to web-search
    </span>
  );
}
