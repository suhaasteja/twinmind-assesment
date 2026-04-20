import { describe, it, expect } from "vitest";
import {
  buildSuggestionsPrompt,
  DEFAULT_SUGGESTIONS_PROMPT,
  MEETING_KIND_LABELS,
} from "./prompts";
import { MeetingKind } from "./types";

describe("buildSuggestionsPrompt", () => {
  it("returns the base unchanged for kind='general'", () => {
    expect(
      buildSuggestionsPrompt(DEFAULT_SUGGESTIONS_PROMPT, "general")
    ).toBe(DEFAULT_SUGGESTIONS_PROMPT);
  });

  it("appends a non-empty kind hint for every non-general kind", () => {
    const nonGeneral: MeetingKind[] = [
      "lecture",
      "one_on_one",
      "pitch",
      "standup",
      "interview",
    ];
    for (const kind of nonGeneral) {
      const out = buildSuggestionsPrompt("BASE", kind);
      expect(out.startsWith("BASE\n\n")).toBe(true);
      // Hint must actually mention the kind or the phrase "MEETING KIND".
      expect(out.length).toBeGreaterThan("BASE\n\n".length + 20);
      expect(out).toContain("MEETING KIND");
    }
  });

  it("preserves the user's edited base prompt verbatim", () => {
    const edited = "My custom prompt with rules.";
    const out = buildSuggestionsPrompt(edited, "pitch");
    expect(out.startsWith(edited)).toBe(true);
  });

  it("has a label for every MeetingKind", () => {
    const kinds: MeetingKind[] = [
      "general",
      "lecture",
      "one_on_one",
      "pitch",
      "standup",
      "interview",
    ];
    for (const k of kinds) {
      expect(MEETING_KIND_LABELS[k]).toBeTruthy();
    }
  });
});
