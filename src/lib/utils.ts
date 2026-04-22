import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true });
}

export function formatClock(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true });
}

// Unambiguous 24hr timestamp (YYYY-MM-DD HH:MM:SS) used in prompts we send to
// the LLM. Human-facing UI keeps the shorter `formatClock`; prompts need date
// + seconds + 24hr so the model can order lines correctly across noon/
// midnight boundaries and reason about recency without AM/PM ambiguity.
export function formatIso(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// Conservative per-request transcript cap. The default model
// (openai/gpt-oss-120b) has a 131k-token context window on Groq; at ~4 chars
// per English token this cap leaves comfortable headroom for the system
// prompt, prior summary, history, and completion. At ~12-18k transcript
// tokens per recorded hour of speech this allows ~5-6 hour sessions before
// truncation kicks in — well beyond typical meeting length. Tuned as a
// constant; promote to a Setting if marathon sessions become a use case.
export const MAX_TRANSCRIPT_CHARS = 350_000; // ≈ 87k tokens (chars/4 proxy)

/**
 * Trim a transcript to the most recent `maxChars` characters, snapped to the
 * next newline so we never cut mid-chunk. Returns the input unchanged if it
 * already fits. Prepends a marker so the downstream model knows earlier
 * content existed and was dropped — combined with the rolling summary fed
 * into the same prompt, this preserves long-range context without blowing
 * the model's context window.
 */
export function trimTranscriptForPrompt(
  text: string,
  maxChars: number = MAX_TRANSCRIPT_CHARS
): string {
  if (text.length <= maxChars) return text;
  const kept = text.slice(-maxChars);
  const firstNewline = kept.indexOf("\n");
  const clean = firstNewline >= 0 ? kept.slice(firstNewline + 1) : kept;
  const droppedChars = text.length - clean.length;
  const droppedK = Math.round(droppedChars / 1000);
  return (
    `[...${droppedK}k chars of earlier transcript truncated — refer to the prior summary for earlier context...]\n` +
    clean
  );
}
