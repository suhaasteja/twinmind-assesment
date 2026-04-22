import { describe, it, expect } from "vitest";
import {
  MAX_TRANSCRIPT_CHARS,
  formatIso,
  trimTranscriptForPrompt,
} from "./utils";

describe("trimTranscriptForPrompt", () => {
  it("returns the input unchanged when under the cap", () => {
    const text = "short transcript\nline two";
    expect(trimTranscriptForPrompt(text)).toBe(text);
  });

  it("truncates when the input exceeds the cap and prepends a marker", () => {
    const line = "x".repeat(100) + "\n";
    const text = line.repeat(500); // 50,500 chars
    const trimmed = trimTranscriptForPrompt(text, 5_000);
    expect(trimmed.length).toBeLessThan(text.length);
    expect(trimmed).toMatch(/^\[\.\.\.\d+k chars of earlier transcript truncated/);
  });

  it("snaps the cut to the next newline so we never slice mid-chunk", () => {
    // 20 lines of known length; cap between line boundaries.
    const lines = Array.from({ length: 20 }, (_, i) => `line${i}`);
    const text = lines.join("\n"); // no trailing newline
    const cap = 30; // well below total length; forces a cut mid-line
    const trimmed = trimTranscriptForPrompt(text, cap);

    // Strip the marker line and verify every remaining line is a complete
    // `lineN` token (no half-lines like "ne17").
    const afterMarker = trimmed.split("\n").slice(1);
    for (const line of afterMarker) {
      expect(line).toMatch(/^line\d+$/);
    }
  });

  it("uses MAX_TRANSCRIPT_CHARS as the default cap", () => {
    const under = "a".repeat(MAX_TRANSCRIPT_CHARS);
    expect(trimTranscriptForPrompt(under)).toBe(under);

    const over = "a".repeat(MAX_TRANSCRIPT_CHARS + 10);
    const trimmed = trimTranscriptForPrompt(over);
    expect(trimmed).not.toBe(over);
    expect(trimmed.startsWith("[...")).toBe(true);
  });

  it("handles the edge case where the tail contains no newline", () => {
    // Single massive line with no internal newlines: the slice has no
    // newline to snap to, so we keep the whole tail as-is after the marker.
    const text = "a".repeat(10_000);
    const trimmed = trimTranscriptForPrompt(text, 1_000);
    const parts = trimmed.split("\n");
    expect(parts[0]).toMatch(/^\[\.\.\./); // marker
    expect(parts[1]).toHaveLength(1_000); // full tail kept
  });
});

describe("formatIso", () => {
  it("produces YYYY-MM-DD HH:MM:SS (24hr), zero-padded", () => {
    // 2024-01-05 03:07:09 local time — construct via Date so the test is
    // timezone-stable (Date string constructors interpret in local tz).
    const d = new Date(2024, 0, 5, 3, 7, 9);
    expect(formatIso(d.getTime())).toBe("2024-01-05 03:07:09");
  });
});
