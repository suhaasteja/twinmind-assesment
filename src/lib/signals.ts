import { TranscriptChunk } from "./types";
import { formatIso } from "./utils";

// Pure, React-free helpers used by the cost-guard gates in SuggestionsColumn
// (E1 dedup skip, D1 inflight defer). Kept here so they are trivially
// unit-testable and so behavior changes live in one place.

const WORD_RE = /[a-z0-9']+/g;

function tokens(text: string): Set<string> {
  const out = new Set<string>();
  const lower = text.toLowerCase();
  const matches = lower.match(WORD_RE);
  if (!matches) return out;
  for (const m of matches) out.add(m);
  return out;
}

/**
 * Jaccard similarity of the word-bags of `a` and `b`. 1 = identical bag,
 * 0 = fully disjoint. Two empty strings are considered identical.
 */
export function jaccard(a: string, b: string): number {
  const A = tokens(a);
  const B = tokens(b);
  if (A.size === 0 && B.size === 0) return 1;
  if (A.size === 0 || B.size === 0) return 0;
  let intersect = 0;
  A.forEach((t) => {
    if (B.has(t)) intersect++;
  });
  const union = A.size + B.size - intersect;
  return union === 0 ? 1 : intersect / union;
}

export interface TranscriptWindow {
  text: string;
  lastChunkEndedAt: number;
}

/**
 * Build the "recent N minutes" transcript view that /api/suggest consumes.
 * Pulled out of SuggestionsColumn so tests can exercise the filter and so
 * the D1 defer gate has a single place to read `lastChunkEndedAt` from.
 */
export function buildWindow(
  chunks: TranscriptChunk[],
  minutes: number,
  now: number = Date.now()
): TranscriptWindow {
  const cutoff = now - minutes * 60_000;
  const recent = chunks.filter((c) => c.endedAt >= cutoff);
  // Tag the final (most-recent) line so the suggestions model has a dead-
  // simple pointer to "the current topic is here" without having to compute
  // recency itself. ISO-style timestamps (YYYY-MM-DD HH:MM:SS, 24hr) are
  // used so the model can order lines across noon/midnight and reason about
  // time deltas without AM/PM ambiguity.
  const lastIndex = recent.length - 1;
  const text = recent
    .map((c, i) => {
      const marker = i === lastIndex ? "  ← MOST RECENT" : "";
      return `[${formatIso(c.startedAt)}] ${c.text}${marker}`;
    })
    .join("\n");
  const lastChunkEndedAt = recent.reduce(
    (acc, c) => (c.endedAt > acc ? c.endedAt : acc),
    0
  );
  return { text, lastChunkEndedAt };
}
