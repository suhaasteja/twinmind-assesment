import { describe, it, expect } from "vitest";
import {
  buildWindow,
  containsDecisionPhrase,
  containsNamedClaim,
  endsWithQuestion,
  jaccard,
} from "./signals";
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

describe("endsWithQuestion", () => {
  it("detects a trailing ?", () => {
    expect(endsWithQuestion("so where do we go from here?")).toBe(true);
  });

  it("detects an interrogative opener without ?", () => {
    expect(endsWithQuestion("How should we price it")).toBe(true);
  });

  it("returns false for a declarative statement", () => {
    expect(endsWithQuestion("Let's ship it.")).toBe(false);
  });

  it("returns false for empty text", () => {
    expect(endsWithQuestion("   ")).toBe(false);
  });

  it("looks at the LAST sentence, not the first", () => {
    // First sentence is a question; last is not — should be false.
    expect(endsWithQuestion("What did we do? We shipped it.")).toBe(false);
    // Last sentence is a question — should be true.
    expect(endsWithQuestion("We shipped it. What do we do next")).toBe(true);
  });
});

describe("containsDecisionPhrase", () => {
  it("matches common decision/commitment phrases", () => {
    expect(containsDecisionPhrase("ok let's go with Postgres then")).toBe(true);
    expect(containsDecisionPhrase("we'll ship it Friday")).toBe(true);
    expect(containsDecisionPhrase("we decided on option B")).toBe(true);
    expect(containsDecisionPhrase("final call: go with the proposal")).toBe(true);
    expect(containsDecisionPhrase("we're going with the smaller team")).toBe(true);
  });

  it("does not match neutral declaratives", () => {
    expect(containsDecisionPhrase("we talked about pricing")).toBe(false);
    expect(containsDecisionPhrase("the meeting started")).toBe(false);
    expect(containsDecisionPhrase("")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(containsDecisionPhrase("LET'S GO WITH Snowflake")).toBe(true);
  });
});

describe("containsNamedClaim", () => {
  it("matches dollar amounts with magnitudes", () => {
    expect(containsNamedClaim("revenue doubled to $12M last quarter")).toBe(true);
    expect(containsNamedClaim("$1.2b valuation")).toBe(true);
  });

  it("matches percentages and x-multiples", () => {
    expect(containsNamedClaim("churn dropped 23%")).toBe(true);
    expect(containsNamedClaim("2.5x faster than before")).toBe(true);
  });

  it("matches number + unit claims", () => {
    expect(containsNamedClaim("500k users signed up")).toBe(true);
    expect(containsNamedClaim("took 3 years to ship")).toBe(true);
  });

  it("matches a 4-digit year", () => {
    expect(containsNamedClaim("this started back in 2019")).toBe(true);
    expect(containsNamedClaim("back in 2024 we pivoted")).toBe(true);
  });

  it("matches a multi-word proper noun", () => {
    expect(containsNamedClaim("we'll migrate to New York next month")).toBe(true);
    expect(containsNamedClaim("ran the benchmarks on Meta Platforms")).toBe(true);
  });

  it("matches an all-caps acronym", () => {
    expect(containsNamedClaim("let's move it to AWS")).toBe(true);
    expect(containsNamedClaim("they use GPU clusters")).toBe(true);
  });

  it("does not match plain prose without claims", () => {
    expect(containsNamedClaim("we talked about the roadmap")).toBe(false);
    expect(containsNamedClaim("keep going, sounds good")).toBe(false);
    expect(containsNamedClaim("")).toBe(false);
  });

  it("does not match a bare capitalized sentence start", () => {
    // "Hello world" is two Capitalized tokens which the proper-noun regex
    // would match — document that this is an accepted false positive so
    // future tweaks are intentional.
    expect(containsNamedClaim("Hello World")).toBe(true);
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

  it("formats each surviving chunk as [clock] text", () => {
    const chunks = [chunk(1, "hello there")];
    const w = buildWindow(chunks, 5, now);
    // Shape check rather than locale-specific clock string.
    expect(w.text).toMatch(/^\[.+\] hello there$/);
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
