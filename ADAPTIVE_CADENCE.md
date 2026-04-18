# Adaptive Cadence — scenarios for when fixed 30s / 5-min breaks down

The current design (see `DESIGN.md`) records audio in fixed 30-second chunks and refreshes suggestions on a fixed 30-second timer against a fixed 5-minute transcript window. This is a good default but it's deliberately naive. This document catalogs the real-world scenarios where the fixed cadence underperforms, the signals we can use to detect each one, and proposed adaptive responses that don't break the existing architecture.

**Non-goals.** We are not rewriting the audio pipeline or introducing a backend. Every proposal here should be implementable as an additive client-side change (plus optional prompt tweaks) while keeping: stateless API routes, in-memory session store, Groq-only models, and the three-column UX.

---

## 1. Design constraints we must preserve

Any adaptive scheme has to respect these, or it's out of scope for this repo:

- **Client owns state.** Suggestions are a pure function of `(recent chunks, previous titles, prompt)`. No server-side session.
- **`MediaRecorder` stop/restart per chunk.** Changing `chunkMs` is fine; abandoning the self-contained-blob model is not (Whisper can't decode mid-stream `timeslice` fragments reliably).
- **Whisper is not streaming.** Minimum perceivable latency per chunk = `chunkMs + ~2-4s` round-trip. This is a floor, not a knob.
- **Single refresh code path.** Manual reload and auto-refresh must call the same `refresh()` — no drift between paths.
- **User-editable settings must keep working.** Any adaptive logic reads current settings each tick, same as today.
- **Chat streaming is independent.** Nothing in this doc should affect `/api/chat`.

---

## 2. Signals available (and cheap to compute)

These are the inputs any adaptive policy can draw on. All derive from existing state:

| Signal | Source | Cost |
|---|---|---|
| **Word count delta** since last refresh | sum `.text.split(/\s+/).length` over new chunks | O(n) on new chunks, trivial |
| **Silence ratio** | fraction of recent chunks whose blob was `< 2 KB` (already dropped server-side) or whose text is empty | trivial |
| **Ends with `?`** or interrogative opener (`what/why/how/when/who/which/do/does/did/is/are/can/could/should`) | regex on last chunk text | trivial |
| **Numbers / named entities just mentioned** | regex for digits/units/currency; optional: a tiny NER pass in the suggest prompt itself | trivial (regex) |
| **Topic-shift heuristic** | Jaccard similarity of bag-of-words between last 30s and prior 2 min; low = shift | O(n), still cheap |
| **Transcript diff since last prompt** | same Jaccard, comparing current window to the window we sent last time | trivial |
| **Time since user last clicked a suggestion** | already in `useSession.chat` timestamps | trivial |
| **In-flight transcribe count** | a counter in the store, incremented on upload / decremented on resolve | trivial |
| **Chunk lag** | `Date.now() - chunks[chunks.length-1].endedAt` — how long since the last transcript line landed | trivial |

None of these require new models or network calls.

---

## 3. Scenarios

Each entry below: **what it is → why the fixed cadence fails → signal to detect → proposed response → what could break.**

### Group A — speaker-density scenarios

#### A1. Silence / long pauses

- **What.** Nobody talking for 30–120s (thinking, screenshare setup, bathroom break).
- **Failure.** `refresh()` fires at 30s, the window is the same as last time, we pay a Groq call to produce near-duplicate suggestions (or empty ones), and the UI flickers with a fresh batch that adds nothing.
- **Signal.** `wordCountDelta < 5` **and** `silenceRatio > 0.8` over the last two chunks.
- **Proposed response.** Skip the refresh this tick (reset countdown as normal). After **3 consecutive skips**, show a subtle "waiting for more conversation…" status in the suggestions header and pause the countdown entirely until the next non-silent chunk lands.
- **Risks / mitigations.**
  - *User expects a batch every 30s.* Skipping is invisible unless we show the status — the status copy solves it.
  - *Real but quiet conversation (whispering, bad mic gain).* Silence ratio uses blob size as a proxy; that already has false positives. Mitigate by also checking word count — if Whisper returned words, we're not silent.

#### A2. Single rapid speaker (monologue)

- **What.** One person talking densely for several minutes.
- **Failure.** 30s chunks + 5-min window + 30s refresh is fine here, but *fresh* suggestions get crowded out by *repeated* ones because the previous-titles dedup is only 2 batches deep. Dense content produces more reusable material per minute than our cadence surfaces.
- **Signal.** `wordCountDelta > 120` (≈ 1.3× average talking rate) for two consecutive ticks.
- **Proposed response.** Shorten the refresh interval to `max(15s, autoRefreshSeconds/2)` while the condition holds. Widen `previousTitles` from 2 batches to 4 during this mode so we don't repeat ourselves at the faster pace.
- **Risks.**
  - *Cost.* Doubles Groq calls for dense stretches. Bounded by a ceiling (see §5).
  - *UI churn.* More batches piling up. Mitigate by keeping the existing fade-by-depth style; maybe collapse batches older than N.

#### A3. Crosstalk / multiple speakers

- **What.** Two or more people talking at once.
- **Failure.** Whisper output quality degrades — transcript becomes a mess. Suggestions based on garbage input are garbage.
- **Signal.** Hard to detect without diarization. Proxy: sudden drop in transcript coherence — a spike in very short words / filler tokens / repeated phrases. Crude but cheap.
- **Proposed response.** If the proxy fires, **don't change the cadence**, but pass a hint into the suggest prompt: "Recent audio may contain crosstalk; weight earlier clean context more heavily." This is a prompt tweak, not a pipeline change.
- **Risks.**
  - *Proxy has false positives on any chaotic segment.* Gate it on 2 consecutive positive detections.
  - *Prompt drift.* Make the hint additive (appended to the user message), not a system-prompt change, so the base prompt stays stable.

#### A4. Bursty conversation

- **What.** 20s silence, 10s sharp exchange, 20s silence. The 30s chunk boundary slices the exchange in half.
- **Failure.** Transcript lands split across two chunks, losing the question/answer pairing in the 5-min view's most-recent slot.
- **Signal.** `chunkSeconds` is too coarse for the content. Can detect post-hoc: if two consecutive chunks together contain an interrogative cluster, the boundary was bad.
- **Proposed response.** Reduce default `chunkSeconds` to **10–15s**. The self-contained-blob model still works (opus is small, Whisper is fast). First-line latency drops from ~32s to ~12s as a bonus. All downstream code is chunk-count-agnostic.
- **Risks.**
  - *More Groq calls.* 2–3× more transcribe requests. Still cheap; well under Groq rate limits at typical usage.
  - *Slightly lower Whisper accuracy per chunk* (less acoustic context). Worth measuring; `large-v3` handles 10s fine in practice.
  - *Battery / CPU on mobile.* More `MediaRecorder` cycles. Marginal.

---

### Group B — content-shape scenarios

#### B1. Question just asked

- **What.** The last chunk contains `?` — the user probably wants an `answer` card **now**, not in up to 30 more seconds.
- **Failure.** Up to 30s of wait for the most time-critical suggestion type.
- **Signal.** Regex match for `?` or interrogative opener at the end of the latest chunk.
- **Proposed response.** Fire an **immediate extra refresh** (bypassing the countdown) the moment such a chunk is added, subject to the cooldown (see §5). Reset countdown to full so we don't double-fire at the next natural boundary.
- **Risks.**
  - *Rhetorical questions fire unnecessarily.* Acceptable noise — the suggestion prompt already filters type based on whether the question is "answerable."
  - *Cost.* Bounded by cooldown.
  - *Race with in-flight refresh.* The existing `loadingSuggestions` guard handles this.

#### B2. Decision / commitment moments

- **What.** Phrases like "let's go with", "decided to", "we'll ship", "action item."
- **Failure.** Same as B1 — timing-critical context, fixed cadence adds lag.
- **Signal.** Small phrase regex over the latest chunk.
- **Proposed response.** Same as B1: trigger early refresh, subject to cooldown.
- **Risks.** Same as B1.

#### B3. Topic transitions

- **What.** Conversation pivots to a new topic. The 5-min window now mixes old and new.
- **Failure.** Suggestions drift — one card addresses the new topic, another still references the old. Feels stale.
- **Signal.** Low Jaccard similarity between the last 30s of transcript and the 2–5 min before it.
- **Proposed response.** On detection, **shrink the window** for this refresh only, from 5 min to 90s. Do not permanently change the setting. Optionally mark the old content for a future rolling summary.
- **Risks.**
  - *False positives on natural tangents.* Require 2 consecutive low-similarity ticks before shrinking.
  - *Loss of "still-relevant" context.* Partially — this is the tradeoff. A rolling summary (B5) is the complete fix.

#### B4. Numbers / names spoken

- **What.** "We grew 34% last quarter", "the paper by Hinton 2012."
- **Failure.** `fact_check` is most valuable right after the claim — 30s later the conversation has moved on.
- **Signal.** Regex for digits + unit, currency, year, or capitalized name-like tokens in the latest chunk.
- **Proposed response.** Prompt tweak — append "Claims with numbers/names are present in the latest transcript line; a `fact_check` suggestion is strongly preferred unless higher-priority signals are present." Don't force an early refresh (B1/B2 already cover urgency).
- **Risks.** Minor — fact-check cards are generally welcome; the prompt already lists fact-check as one of the five types.

#### B5. Long meeting (> 30 min)

- **What.** The 5-min window no longer captures decisions made earlier.
- **Failure.** Suggestions lose long-term context.
- **Signal.** `sessionStartedAt` delta > 25 min.
- **Proposed response.** Activate the **rolling summary** hook that already exists in `/api/suggest` (`meetingSummary` field). Generate a ~200-token summary every ~5 batches from the transcript that has fallen out of the 5-min window. Feed both the fresh window *and* the summary to each refresh.
- **Risks.**
  - *Extra Groq call per summary cycle.* One per ~5 minutes. Cheap.
  - *Summary drift.* Re-generate from scratch every few cycles to avoid compounding summaries of summaries.
  - *Prompt size.* 200 tokens is negligible against 128k context.

---

### Group C — session-lifecycle scenarios

#### C1. Meeting just started (first ~30s)

- **What.** No transcript yet.
- **Failure.** None, really — already handled by the `<20 chars` guard returning `{suggestions: []}`.
- **Signal.** Existing guard.
- **Proposed response.** Keep as is. Optionally show "first suggestions in ~30s" as a placeholder instead of "waiting."
- **Risks.** None.

#### C2. Meeting wrap-up

- **What.** Participants saying "thanks / bye / see you", action items already committed.
- **Failure.** Suggestions keep generating fresh cards about a dying conversation.
- **Signal.** Farewell phrase regex + declining word-count trend over 3 ticks.
- **Proposed response.** Suppress auto-refresh (manual still works). Replace the countdown with "meeting wrapping up — click reload to override."
- **Risks.**
  - *False positive.* Any "thanks for explaining that" mid-meeting. Require the phrase plus low word-count trend to fire.

#### C3. User is the listener vs. the speaker

- **What.** When the user is being asked a question, an `answer` card matters most. When they're listening to someone present, `fact_check` and `clarify` matter more.
- **Failure.** Current prompt doesn't know who "the user" is vs. "someone else."
- **Signal.** Hard without diarization. Cheap approximation: the Settings dialog gets a toggle: "I am mostly: [speaker | listener]." That single bit can weight the prompt.
- **Proposed response.** Add the setting; pass its value into the suggest prompt as "user role hint." No pipeline change.
- **Risks.**
  - *User forgets to toggle.* Default to a balanced mix (what we have today).

---

### Group D — system-state scenarios

#### D1. Whisper latency spike

- **What.** A chunk takes 10–20s to transcribe instead of ~2s.
- **Failure.** The 30s refresh tick fires without the most recent chunk in the window.
- **Signal.** `inflightTranscribes > 0` at tick time, and the newest chunk's `endedAt` is > 10s older than `Date.now()`.
- **Proposed response.** Defer `refresh()` by up to 5s waiting on in-flight transcriptions. After 5s, fire anyway. One-line change in `refresh()`.
- **Risks.**
  - *Cascading delay.* Capped at 5s. If Whisper is fully broken, D2 takes over.

#### D2. Whisper error / rate limit

- **What.** `/api/transcribe` returns a non-2xx; chunk is lost.
- **Failure.** Current behavior — red banner, chunk dropped, recording continues. Correct but "silent" to downstream.
- **Signal.** Error response from transcribe.
- **Proposed response.** Keep the banner. Additionally: if N>=3 errors in a row, pause auto-refresh (no point asking for suggestions on an empty window) and surface "transcription unavailable — check API key / rate limit."
- **Risks.** None — strictly additive.

#### D3. Network flakiness — bursty uploads

- **What.** Several chunks upload at once after reconnect; suggestions could fire simultaneously with a storm of fresh data.
- **Failure.** A single burst of new chunks shouldn't trigger multiple back-to-back refreshes.
- **Signal.** `chunks.length` jumps by >=3 within a 2s window.
- **Proposed response.** Debounce refresh — if we detect the burst, wait until it settles (no new chunks for 1s) and then fire once. The existing `loadingSuggestions` guard already prevents overlap; this just coalesces triggers.
- **Risks.** None material.

#### D4. User edits chunk duration / context window mid-meeting

- **What.** User halves `chunkSeconds` from 30 to 15 while recording.
- **Failure.** Currently the new chunk size only takes effect at the *next* recorder cycle — the current recorder runs to its original timeout. Acceptable; worth naming.
- **Signal.** Settings change event.
- **Proposed response.** No change needed. Document the behavior. For context windows, the change already takes effect at the next refresh — correct.
- **Risks.** None.

---

### Group E — cost / UX scenarios

#### E1. Prompt dedup (near-identical refreshes)

- **What.** During a lull, the 5-min window is >90% the same as last call. We pay for near-identical suggestions.
- **Signal.** Jaccard(current window text, last sent window text) > 0.9.
- **Proposed response.** Skip the refresh (keep showing previous batch as the "current"). Reset countdown. This is strictly a cost win with no UX regression.
- **Risks.**
  - *User expects activity.* If we skip >3 ticks, show a "no new context" indicator.

#### E2. Notification fatigue

- **What.** Too-frequent batches feel noisy; too-rare feel dead.
- **Signal.** Derived from combined density metrics (A2, A1).
- **Proposed response.** The adaptive cadence proposed across A1, A2, D1, E1 is the fatigue fix — it slows down when content is thin, speeds up when content is dense.
- **Risks.** Covered in the individual scenarios.

---

## 4. Proposed minimal policy (ties it all together)

A single state machine on top of the existing countdown. Three states, one tick-level policy, no new infra.

```
    (no new content)              (dense content + cooldown ok)
       ┌──────────┐                        ┌──────────┐
       ▼          │                        │          ▼
   [ IDLE ] ── wordCountDelta>0 ──▶ [ LISTENING ] ── density>threshold ──▶ [ HOT ]
      ▲                                     │                                │
      └───── 3 consecutive silent ticks ────┘                                │
                                              ◀── density dips for 2 ticks ──┘

IDLE:      countdown paused. Next non-silent chunk → LISTENING.
LISTENING: countdown at settings.autoRefreshSeconds (30s default). Normal behavior.
HOT:       countdown at max(15s, autoRefreshSeconds/2). Wider previousTitles (4 batches).

Across all states — "interrupt triggers":
  - B1 (?) / B2 (decision) → fire refresh immediately, reset countdown,
    subject to a global MIN_REFRESH_INTERVAL = 10s cooldown.
  - Pre-refresh gate: if Jaccard(window, lastSentWindow) > 0.9 → skip (E1).
  - Pre-refresh gate: if inflightTranscribes > 0 and lastChunk is stale → defer up to 5s (D1).
  - Post-refresh: if errors >= 3 → pause auto-refresh, show banner (D2).
```

**Why this shape.**

- It's one `useEffect` extension, not a new system. The existing `refresh()` function stays unchanged; only its *trigger* becomes smarter.
- Every state transition is gated on a cooldown so we can't spiral into a refresh storm.
- Failure modes are additive: if any detector is wrong, we fall back to today's exact behavior.
- All tunables (density threshold, cooldown, Jaccard cutoff) live in Settings so they're user-adjustable.

---

## 5. Global guardrails

Regardless of which scenarios we implement, these must hold:

- **`MIN_REFRESH_INTERVAL = 10s`** between any two `/api/suggest` calls. Interrupt triggers respect this.
- **`MAX_REFRESHES_PER_MINUTE = 6`** hard ceiling per session. Exceeding → fall back to 30s cadence and log once.
- **`loadingSuggestions` guard stays authoritative.** No adaptive trigger can bypass it.
- **Settings remain the source of truth for user-visible defaults** (`autoRefreshSeconds`, `suggestionsContextMinutes`). Adaptive logic modulates *around* those values; it never overwrites them.
- **Manual reload always works, immediately, ignoring all adaptive gates** (respecting only `loadingSuggestions`). The user's explicit intent wins.
- **Mock mode behaves identically to real recording** for testing — every adaptive path must exercise with mock transcripts.

---

## 6. Implementation order (if we build this)

Staged so each step is shippable on its own:

1. **Signals library** (`src/lib/signals.ts`) — pure functions over `chunks`: `wordCountDelta`, `silenceRatio`, `endsWithQuestion`, `jaccard`, `hasNumbers`. Fully unit-testable. No behavior change yet.
2. **E1 (dedup skip)** — cheapest win, pure cost reduction, zero UX risk.
3. **D1 (defer on in-flight transcribe)** — tightens the existing loop.
4. **B1 + B2 (urgency triggers)** with cooldown. Biggest *user-perceived* quality jump.
5. **A1 (silence skip)** + A2 (hot mode) — the state machine goes live.
6. **B5 (rolling summary)** — activates the existing `meetingSummary` hook.
7. **C2 / C3 + prompt tweaks for B3 / B4** — polish layer.

Everything before step 5 is independent and can ship in any order. Step 5 is the only one that introduces state beyond "current settings + chunks."

---

## 7. Explicit non-proposals

Things we deliberately are **not** doing in this doc:

- **Diarization / speaker ID.** Out of scope for a browser-only Whisper setup.
- **Server-side session state.** Would violate the stateless-routes design.
- **Streaming STT.** Whisper on Groq doesn't offer it; any "streaming" would be a lie.
- **Replacing the 30s chunk model with `timeslice`.** Tried and rejected in the original design; fragments aren't independently decodable.
- **Training / fine-tuning anything.** This is a prompt + orchestration project.
