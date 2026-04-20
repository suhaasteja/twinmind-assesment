import { TranscriptChunk } from "./types";
import { formatClock } from "./utils";

// Pure, React-free helpers used by the adaptive-cadence gates in
// SuggestionsColumn. Kept here so they are trivially unit-testable and so
// behavior changes to the cadence logic live in one place.

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

const INTERROGATIVE_OPENERS = new Set([
  "what",
  "why",
  "how",
  "when",
  "where",
  "who",
  "which",
  "whose",
  "do",
  "does",
  "did",
  "is",
  "are",
  "was",
  "were",
  "am",
  "can",
  "could",
  "should",
  "would",
  "will",
  "shall",
  "may",
  "might",
]);

/**
 * Heuristic "does the latest transcript line look like a question?" check.
 * Returns true if the text ends with `?` OR the last sentence starts with a
 * common interrogative opener. Intentionally cheap/regex-based — false
 * positives are acceptable because the cooldown gate bounds their cost.
 */
export function endsWithQuestion(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (trimmed.endsWith("?")) return true;

  // Take the last sentence-ish fragment.
  const parts = trimmed.split(/[.!?]\s+/);
  const last = parts[parts.length - 1]?.trim() ?? "";
  if (!last) return false;

  const firstWord = last.split(/\s+/)[0]?.toLowerCase().replace(/[^a-z']/g, "");
  if (!firstWord) return false;
  return INTERROGATIVE_OPENERS.has(firstWord);
}

// ---- B2 / B4 interrupt helpers --------------------------------------------
//
// Expand the question-interrupt path to also fire on two other "jump-in now"
// moments the founder calls out in the podcast:
//   B2 — a decision phrase like "let's go with X" / "we'll ship Y"
//   B4 — a named-entity or numeric claim that is worth silently fact-checking
//
// These stay regex-heuristic on purpose: false positives are bounded by the
// existing cooldown gate in SuggestionsColumn.refresh().

// Match common decision / commitment phrases. Word-boundaried so we don't
// trigger inside larger words.
const DECISION_PHRASE_RE =
  /\b(let'?s (?:go with|do|pick|use|ship|build|move on to)|we'?ll (?:go with|do|ship|use|build|pick|move forward with)|we'?re going (?:to|with)|we decided|decision is|final call|going with|we'?ll commit|we'?re committing)\b/i;

export function containsDecisionPhrase(text: string): boolean {
  if (!text) return false;
  return DECISION_PHRASE_RE.test(text);
}

// Numbers with a unit / magnitude. Matches: "$12M", "12%", "2.5x", "2024",
// "500k users", "$1.2b". Intentionally narrow to reduce false positives from
// plain digits (e.g. ordinals, slide numbers).
const NUMERIC_CLAIM_RE =
  /(\$\s?\d[\d,.]*\s?[kmb]?|\b\d[\d,.]*\s?%|\b\d[\d,.]*\s?(?:x|k|m|b|bn|mn|million|billion|thousand|users|customers|employees|hours|minutes|seconds|years?|months?|days?)\b|\b(?:19|20)\d{2}\b)/i;

// A capitalized multi-word proper noun (e.g. "New York", "Meta Platforms",
// "OpenAI GPT"). Single capitalized words are excluded because they fire on
// sentence-starts. Requires 2+ adjacent Capitalized tokens OR a known
// all-caps acronym-ish single token.
const PROPER_NOUN_RE = /\b[A-Z][a-zA-Z0-9]+\s+[A-Z][a-zA-Z0-9]+\b/;
const ACRONYM_RE = /\b[A-Z]{3,}\b/;

/**
 * True when the text contains something worth silently fact-checking: a
 * number-with-unit, a multi-word proper noun, or an acronym. Deliberately
 * conservative — we'd rather under-fire than spam refreshes.
 */
export function containsNamedClaim(text: string): boolean {
  if (!text) return false;
  return (
    NUMERIC_CLAIM_RE.test(text) ||
    PROPER_NOUN_RE.test(text) ||
    ACRONYM_RE.test(text)
  );
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
  const text = recent
    .map((c) => `[${formatClock(c.startedAt)}] ${c.text}`)
    .join("\n");
  const lastChunkEndedAt = recent.reduce(
    (acc, c) => (c.endedAt > acc ? c.endedAt : acc),
    0
  );
  return { text, lastChunkEndedAt };
}
