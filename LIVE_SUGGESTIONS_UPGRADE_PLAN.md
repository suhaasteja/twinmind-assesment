# Live Suggestions Upgrade Plan

Execution plan for the **In** set from `FUTURE_WORK.md`. Goal: lift rubric
criteria #1 (suggestion quality) and #3 (prompt engineering) without
touching architectural boundaries. Ordered low-to-high risk; every step is
independently shippable and revertible.

---

## Goal

Make the live-suggestions surface feel closer to what Daniel George
describes in the TwinMind podcast — proactive, intent-aware, and tuned to
the *kind* of meeting — using only prompt- and signal-level changes.

## Scope discipline (explicit non-goals)

- No new API routes.
- No new stores or persistence layers.
- No new runtime dependencies.
- No UI restructure — only additions inside existing components.
- No changes to audio capture, chunking, or the `/api/transcribe` path.

Invariants to preserve (see `ARCHITECTURE.md §9`):

- Batch size = 3, enforced server-side in `src/app/api/suggest/route.ts:83-93`.
- Single `refresh()` path for all triggers in `src/components/SuggestionsColumn.tsx:47`.
- Manual refresh bypasses adaptive gates; `loadingSuggestions` still guards.
- Transient flags never enter `partialize` in `src/lib/store.ts:172-177`.
- API key travels only in `x-groq-key` header.

---

## Sequencing overview

| # | Step | Files touched | Risk | Effort |
|---|---|---|---|---|
| 1 | Prompt lifts + intent reframe | `src/lib/prompts.ts` | low | ~30 min |
| 2 | Meeting-kind presets | `types.ts`, `store.ts`, `prompts.ts`, `SettingsDialog.tsx`, `SuggestionsColumn.tsx` | low | ~1 h |
| 3 | B2 / B4 interrupt triggers | `signals.ts`, `signals.test.ts`, `SuggestionsColumn.tsx`, `SuggestionsColumn.test.tsx` | medium | ~1–2 h |
| 4 | Rolling meeting summary (B5) | `types.ts`, `store.ts`, `prompts.ts`, `SuggestionsColumn.tsx` | medium | ~2–3 h |

Each step compiles, tests-pass, and demo-runs before moving on.

---

## Step 1 — Prompt lifts + intent reframe

**Why:** cheapest, highest per-hour lift on rubric #1/#3. Rewords the
system prompt so the model is optimizing for "what does the user need to
*know or say* right now" instead of "what's interesting about the
transcript".

**Files:** `src/lib/prompts.ts` only.

**Changes:**
- Reframe `DEFAULT_SUGGESTIONS_PROMPT` opening line to: *"You are a live
  meeting copilot. Predict what the user needs to know or say **right
  now** — jump in like Jarvis would."*
- Add a rule: *"If a number, name, date, or public fact was just stated,
  silently verify it and surface a `fact_check` card."*
- Add a rule: *"Infer whether the user is the speaker or the listener in
  this moment. If listener, prefer `answer`/`clarify`. If speaker, prefer
  `fact_check`/`talking_point`."*
- Tighten the preview-self-sufficiency rule (already present; promote to a
  bold line at the top).
- Keep output schema unchanged (server parser in
  `src/app/api/suggest/route.ts:83-93` must still pass).

**Verification:**
- `npm run test:run` — existing tests must pass unchanged (prompt text
  isn't tested directly).
- Manual mock run (scenario: `infra`) — observe card type mix should shift
  toward `fact_check` when numeric claims appear.

---

## Step 2 — Meeting-kind presets

**Why:** assignment rubric criterion #3 explicitly mentions "different
types of meetings". One dropdown gives us kind-aware prompting with no
architectural change.

**Data-shape delta:**
```ts
// src/lib/types.ts
type MeetingKind =
  | "general" | "lecture" | "one_on_one"
  | "pitch"   | "standup" | "interview";

interface Settings {
  // ...existing fields
  meetingKind: MeetingKind;
}
```
Default = `"general"` in `DEFAULT_SETTINGS` (`src/lib/store.ts:17-36`).

**Prompt dispatch (in `src/lib/prompts.ts`):**
```ts
export function buildSuggestionsPrompt(
  base: string,
  kind: MeetingKind
): string {
  const hint = KIND_HINTS[kind]; // one short paragraph per kind
  return hint ? `${base}\n\nMEETING KIND HINT:\n${hint}` : base;
}
```
`KIND_HINTS` is a plain object with 5 ~80-word strings. Examples:
- `lecture` — "User is a student. Prefer `clarify`, `question`, and
  `answer` cards. Use textbook-grade precision. Questions should be what
  they'd ask the professor."
- `pitch` — "User is pitching. Prefer `fact_check` on claims, and
  `talking_point` for strong follow-ups. Keep tone crisp, investor-ready."
- (etc.)

**Wiring:**
- `src/components/SettingsDialog.tsx` — add a `<select>` under the existing
  suggestions-prompt section.
- `src/components/SuggestionsColumn.tsx:130-142` — replace `prompt:
  settings.suggestionsPrompt` with
  `prompt: buildSuggestionsPrompt(settings.suggestionsPrompt, settings.meetingKind)`.

**Tests:**
- New unit test in `src/lib/signals.test.ts` (or new `prompts.test.ts`):
  `buildSuggestionsPrompt(base, "general")` returns `base` unchanged;
  non-general kinds append a non-empty hint.

**Verification:**
- Pick kind=lecture, run mock scenario "infra" — card mix should tilt
  toward questions/clarifications.

---

## Step 3 — B2 / B4 interrupt triggers

**Why:** the existing interrupt path
(`src/components/SuggestionsColumn.tsx:192-202`) only fires on questions.
Decision phrases and named/numeric claims are exactly the moments where
Jarvis should "jump in" per the podcast. Reuses the cooldown and dedup
gates, so cost is bounded.

**New pure helpers in `src/lib/signals.ts`:**
```ts
export function containsDecisionPhrase(text: string): boolean;
// regex union: /\b(let'?s go with|we'?ll ship|let'?s do|decision is|
//               we decided|going with|final call|we'?re going to)\b/i

export function containsNamedClaim(text: string): boolean;
// heuristic: a capitalized multi-word proper noun OR a number with
// magnitude (%, k, m, b, $, year) in the last sentence.
```

**Wire into the existing interrupt `useEffect`:**
```ts
// SuggestionsColumn.tsx:192-202
if (latest.id === lastInterruptChunkIdRef.current) return;
lastInterruptChunkIdRef.current = latest.id;
const hit =
  endsWithQuestion(latest.text) ||
  containsDecisionPhrase(latest.text) ||
  containsNamedClaim(latest.text);
if (!hit) return;
void refresh("interrupt");
```

**Tests:** `src/lib/signals.test.ts`
- `containsDecisionPhrase` positive/negative cases.
- `containsNamedClaim` positive (number with unit, `Nvidia` etc.) /
  negative (lowercase prose, plain digits).
- `SuggestionsColumn.test.tsx` — existing refresh-path test gets extended
  with a decision-phrase chunk → expect one interrupt refresh.

**Risks & mitigations:**
- False positives → bounded by existing cooldown gate
  (`SuggestionsColumn.tsx:117-121`) and E1 jaccard dedup (`:107-115`).
- Overly noisy named-entity regex → start conservative (number-with-unit
  only), expand later if under-triggering.

**Verification:**
- Mock scenario with a deliberate claim ("we're going with Postgres") and
  a numeric claim ("revenue doubled to $12M") — both should trigger an
  early refresh without the 30 s wait.

---

## Step 4 — Rolling meeting summary (B5)

**Why:** the already-wired `meetingSummary` param in
`src/app/api/suggest/route.ts:13,39` exists for this. Lets the 5-minute
live window stay tight (freshness) while preserving decisions from 30
minutes ago (continuity). Directly echoes the podcast's "memory layer"
framing, scoped to a single session.

**Data-shape delta:**
```ts
// src/lib/store.ts — useSession
interface SessionState {
  // ...existing
  meetingSummary: string;         // persisted with chunks/batches/chat
  lastSummarizedChunkCount: number; // transient
  setMeetingSummary: (s: string) => void;
  setLastSummarizedChunkCount: (n: number) => void;
}
```
Add `meetingSummary` to `partialize` (it's history-bearing). Leave
`lastSummarizedChunkCount` out (transient).

**Regen strategy (inside `SuggestionsColumn.tsx`, NOT a new route):**
- Trigger: inside the existing 1 s countdown interval, check
  `chunks.length - lastSummarizedChunkCount >= SUMMARIZE_EVERY_CHUNKS`
  (default 6 chunks ≈ 3 min at 30 s/chunk).
- Gate: skip if `loadingSuggestions` or a summary regen is already in
  flight (local ref `summarizingRef`).
- Action: POST to `/api/chat` (re-using the existing streaming endpoint)
  with a fixed summarization prompt + the full transcript so far +
  previous summary; collect the stream into a string; call
  `setMeetingSummary`; update `lastSummarizedChunkCount`.
- This adds **no** new route — `/api/chat` already accepts an arbitrary
  system prompt.

**Prompt (new constant in `src/lib/prompts.ts`):**
```
DEFAULT_SUMMARY_PROMPT = `You maintain a rolling summary of a live
meeting. Given the prior summary and all transcript chunks so far,
produce an updated summary ≤ 200 words. Preserve: decisions made, open
questions, named entities, numbers, and commitments. Drop small talk.
Output plain prose, no markdown, no preamble.`
```

**Send into suggest call:**
```ts
// SuggestionsColumn.tsx:130-142 — inside the POST body
body: JSON.stringify({
  transcript: win.text,
  previousTitles,
  prompt: buildSuggestionsPrompt(settings.suggestionsPrompt, settings.meetingKind),
  model: settings.llmModel,
  meetingSummary: useSession.getState().meetingSummary || undefined,
}),
```

**Tests:**
- No new pure-helper tests (behavior lives inside the component).
- Extend `SuggestionsColumn.test.tsx`: mock a session with >6 chunks,
  assert `/api/chat` is invoked with the summary prompt, and the next
  `/api/suggest` body contains `meetingSummary`.

**Risks & mitigations:**
- Extra LLM calls → capped: only regenerates every ~3 min AND only while
  recording/mock-active AND single-flight guarded.
- Summary drift → each regen sees the **previous summary** as input, so
  it's a refinement, not an unbounded accumulation.
- Latency impact on suggest call → `meetingSummary` is ≤ 200 words; adds
  negligible tokens.

**Verification:**
- Mock scenario `infra` at speed 5× — after ~36 s of mock time (≈ 6
  chunks), observe in devtools:
  - A `/api/chat` call with system prompt containing "rolling summary".
  - Subsequent `/api/suggest` request body contains a `meetingSummary`
    string.
- Suggestion quality late in the session should cite decisions from
  earlier even though they've fallen out of the 5-min window.

---

## Acceptance criteria (entire plan)

- [ ] `npm run test:run` green.
- [ ] Mock scenarios run end-to-end without regressions.
- [ ] `SettingsDialog` shows the new meeting-kind dropdown.
- [ ] Card-type distribution varies meaningfully across presets on the
      same scenario.
- [ ] Decision-phrase and numeric-claim chunks trigger interrupt refreshes
      (observable by timing — batch appears < 30 s after the chunk).
- [ ] After ~3 min of mock runtime, `meetingSummary` is non-empty in the
      session store and is included in the suggest request body.
- [ ] No new files under `src/app/api/`. No new top-level deps in
      `package.json`.

## Rollback

Each step is a single commit; revert per step in reverse order without
breaking earlier steps. Prompts and presets are the safest to keep even
if later steps are reverted.
