import { describe, it, expect } from "vitest";
import { buildWindow, jaccard } from "./signals";
import { TranscriptChunk } from "./types";

describe("jaccard", () => {
  it("returns 1 for identical strings", () => {
    expect(jaccard("hello world", "hello world")).toBe(1);
  });

  it("is case- and punctuation-insensitive", () => {
    expect(jaccard("Hello, world!", "hello world")).toBe(1);
  });

  it("returns 0 for fully disjoint strings", () => {
    expect(jaccard("alpha beta", "gamma delta")).toBe(0);
  });

  it("treats two empty strings as identical", () => {
    expect(jaccard("", "")).toBe(1);
  });

  it("returns 0 when one side is empty", () => {
    expect(jaccard("hello", "")).toBe(0);
  });

  it("scores a ~90% overlap window above the dedup threshold (0.9)", () => {
    // Realistic case: same 5-min window with one new sentence appended.
    // 50-word base + 3 new words ≈ 0.943 — comfortably above the 0.9 threshold.
    const base = Array.from({ length: 50 }, (_, i) => `word${i}`).join(" ");
    const withNewSentence = base + " brand new sentence";
    expect(jaccard(base, withNewSentence)).toBeGreaterThanOrEqual(0.9);
  });

  it("scores a meaningful change below the dedup threshold", () => {
    const base = "alpha beta gamma delta";
    const changed = "alpha beta epsilon zeta eta theta iota";
    expect(jaccard(base, changed)).toBeLessThan(0.9);
  });
});

describe("buildWindow", () => {
  const now = 1_700_000_000_000; // fixed anchor

  const chunk = (offsetMin: number, text: string): TranscriptChunk => ({
    id: `c${offsetMin}`,
    startedAt: now - offsetMin * 60_000,
    endedAt: now - offsetMin * 60_000 + 30_000,
    text,
  });

  it("filters by endedAt against the wall-clock cutoff", () => {
    const chunks = [
      chunk(10, "old content"),
      chunk(3, "recent content"),
      chunk(1, "very recent"),
    ];
    const w = buildWindow(chunks, 5, now);
    expect(w.text).not.toContain("old content");
    expect(w.text).toContain("recent content");
    expect(w.text).toContain("very recent");
  });

  it("formats each surviving chunk as [YYYY-MM-DD HH:MM:SS] text and tags the last one", () => {
    const chunks = [chunk(1, "hello there")];
    const w = buildWindow(chunks, 5, now);
    // Single chunk is also the MOST RECENT; shape check on ISO-ish stamp.
    expect(w.text).toMatch(
      /^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\] hello there\s+← MOST RECENT$/
    );
  });

  it("only tags the final chunk as MOST RECENT", () => {
    const chunks = [chunk(3, "older line"), chunk(1, "newer line")];
    const w = buildWindow(chunks, 5, now);
    const lines = w.text.split("\n");
    expect(lines[0]).not.toMatch(/MOST RECENT/);
    expect(lines[1]).toMatch(/MOST RECENT/);
  });

  it("returns lastChunkEndedAt = max(endedAt) across surviving chunks", () => {
    const chunks = [chunk(4, "a"), chunk(2, "b"), chunk(1, "c")];
    const w = buildWindow(chunks, 5, now);
    // c is most recent: endedAt = now - 60_000 + 30_000
    expect(w.lastChunkEndedAt).toBe(now - 60_000 + 30_000);
  });

  it("returns lastChunkEndedAt = 0 when window is empty", () => {
    const w = buildWindow([], 5, now);
    expect(w.lastChunkEndedAt).toBe(0);
    expect(w.text).toBe("");
  });
});
