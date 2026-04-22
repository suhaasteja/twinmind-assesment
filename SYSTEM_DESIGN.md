# System Design — TwinMind Live Suggestions

> Companion to `ARCHITECTURE.md`. Where that file is a **map**, this file is
> a set of **subsystem contracts**: for each major flow, the inputs, outputs,
> invariants, failure modes, and the exact code locations that enforce them.
> Written for AI coding agents: terse, cited, scannable.

- Architecture overview → `ARCHITECTURE.md`
- Prose rationale → `DESIGN.md`
- Proposed adaptive cadence scenarios → `ADAPTIVE_CADENCE.md`

---

## Table of contents

1. [Audio capture & transcription](#1-audio-capture--transcription)
2. [Live suggestions loop](#2-live-suggestions-loop)
3. [Chat streaming (free-form & detailed answer)](#3-chat-streaming)
4. [State management (Zustand)](#4-state-management)
5. [Settings & persistence](#5-settings--persistence)
6. [Adaptive cadence gates (implemented)](#6-adaptive-cadence-gates-implemented)
7. [Mock playback mode](#7-mock-playback-mode)
8. [Export](#8-export)
9. [Error handling matrix](#9-error-handling-matrix)
10. [Testing surface](#10-testing-surface)
11. [Latency budget](#11-latency-budget)
12. [Security notes](#12-security-notes)

---

## 1. Audio capture & transcription

### Contract
- Input: user click on mic button in `TranscriptColumn`.
- Output: a stream of `TranscriptChunk` records written to
  `useSession.chunks` in wall-clock-timestamp order.

### Components
| Piece | File | Responsibility |
|---|---|---|
| UI button + upload loop | `src/components/TranscriptColumn.tsx` | Start/stop, error banner, pending counter |
| Chunker | `src/lib/audio.ts` (`startChunkRecorder`) | Cycle `MediaRecorder` every `chunkMs`, emit self-contained blobs |
| Server proxy | `src/app/api/transcribe/route.ts` | Forward multipart to Groq, drop tiny blobs |
| Groq wrapper | `src/lib/groq.ts` (`groqTranscribe`) | `POST /audio/transcriptions` |

### Flow
```
Mic permission → MediaRecorder #1 start
  ↓ chunkMs elapsed
MediaRecorder #1 stop  → ondataavailable + onstop → Blob(parts, webm/opus)
  ↓ (immediately, in parallel)
  ├─ MediaRecorder #2 start
  └─ onChunk(blob, startedAt, endedAt)
        → POST /api/transcribe (FormData)
        → groqTranscribe → { text }
        → if text.trim() → addChunk({ id, startedAt, endedAt, text })
```

### Invariants
- Each blob is a **valid, standalone** webm/opus container. Achieved by
  stop/restart (`audio.ts:31-57`), not `timeslice`.
- Chunks may upload out of order. UI render order follows `startedAt`.
- `pending` counter in `TranscriptColumn.tsx:27` is UI-local;
  `inflightTranscribes` in `useSession` is the authoritative count used
  by the D1 gate below.
- Blobs `< 2 KB` are dropped with `{ text: "" }` in
  `src/app/api/transcribe/route.ts:22-24` (silence cheap-out).

### Failure modes
| Failure | Handler | User-visible effect |
|---|---|---|
| Mic permission denied | `startMic` catch (`TranscriptColumn.tsx:99-101`) | Red banner, recording stays off |
| No API key | `transcribeBlob` early return (`:42-45`) | Banner, no network call |
| Groq 4xx/5xx | Route returns upstream status (`transcribe/route.ts:27-32`) | Red banner in transcript column |
| Silent chunk | Server returns `{text:""}` | No-op; no `addChunk` |
| N consecutive errors | `recordTranscribeResult(false)` increments streak | D2 circuit breaker pauses suggestions (see §6) |

### Tunables
- `settings.chunkSeconds` — default 30. Lowering improves first-line latency
  but increases Groq calls.
- `settings.sttModel` — default `whisper-large-v3`.

---

## 2. Live suggestions loop

### Contract
- Input: current `useSession.chunks` + `useSession.batches` + `settings`.
- Output: new `SuggestionBatch` prepended to `useSession.batches`, or a
  no-op (gate skipped) with optional UI notice.

### Triggers (all call the same `refresh()` in `SuggestionsColumn.tsx:47`)
| Trigger | Source | Bypasses gates? |
|---|---|---|
| `auto` | 1 s countdown interval | No |
| `manual` | Reload button | Bypasses D1, D2, E1, cooldown (not `loadingSuggestions`) |
| `interrupt` | New chunk matches `endsWithQuestion`, `containsDecisionPhrase`, or `containsNamedClaim` | No (cooldown still caps cost) |

### Gate order (inside `refresh`)
```
1. loadingSuggestions guard          :48        (hard; even manual respects)
2. apiKey check                       :49-52
3. D2 circuit breaker                 :60-72    (manual bypasses)
4. D1 in-flight defer ≤ inflightDeferMs ms :78-92 (manual bypasses)
5. Build window (last N min)          :94-99    via signals.buildWindow
6. Window < 20 chars → return         :100-105  (manual shows message)
7. E1 jaccard dedup > threshold       :107-115  (manual bypasses)
8. Cooldown minRefreshIntervalMs      :117-121  (manual bypasses)
9. setLoading(true); POST /api/suggest :123-150
10. addBatch on success               :151-157
```

### Server behavior (`src/app/api/suggest/route.ts`)
- Validates key.
- If transcript < 20 chars → `{ suggestions: [] }` (short-circuit, no Groq).
- Builds user message combining:
  - optional `meetingSummary` (rolling summary, regenerated client-side every ~6 chunks — see §6),
  - recent transcript,
  - previous batch titles to avoid repetition,
  - a "return exactly 3" instruction.
- Parser is permissive on `needsWebSearch`: accepts boolean truthy values; force-ons the flag for every `fact_check` and `clarify` card so the UI can offer a web-search chip regardless of what the model emits.
- Calls Groq chat completion with `response_format: json_object`,
  `temperature: 0.4`, `max_tokens: 700`.
- Parses JSON. Filters entries missing `title`/`preview`/`type`. Coerces
  unknown types to `talking_point`. Slices to 3. Truncates strings.
- Returns `{ suggestions: Suggestion[] }` (length 0 or 3).

### Invariants
- UI never renders a batch of size != 3. Enforced server-side; client also
  skips `addBatch` when `suggestions.length === 0`
  (`SuggestionsColumn.tsx:151-157`).
- Exactly one `/api/suggest` is in flight at a time.
- Prompt + context shape is pure: no server-side cross-request state.

### Tunables (all in `useSettings`)
- `autoRefreshSeconds` (default 30)
- `suggestionsContextMinutes` (default 5)
- `suggestionsPrompt` (default in `src/lib/prompts.ts:4-30`)
- Adaptive knobs — see §6.

---

## 3. Chat streaming

Handles two logical flows through **one** endpoint and **one** client
function:

| Flow | System prompt | Context window | Entry |
|---|---|---|---|
| Free-form chat | `settings.chatPrompt` | `settings.detailedContextMinutes` (0 = full) | typed input → `send(v)` |
| Suggestion click | `settings.detailedAnswerPrompt` | same | `sendFromSuggestion(s)` imperative handle |
| Suggestion click (flagged) | `detailedAnswerPrompt` + `WEB SEARCH RESULTS:` block from Tavily | same | same handle; runs a Tavily fetch before the Groq call |

### Client (`src/components/ChatColumn.tsx`)
- `send()` (`:45-127`):
  1. Push user `ChatMessage` to store.
  2. Push empty assistant `ChatMessage` with a known `id`.
  3. POST `/api/chat` with `{ systemPrompt, transcript, history, userMessage, model }`.
  4. Read `response.body` as a stream; `TextDecoder` each chunk;
     `appendToChatMessage(id, delta)` for every non-empty delta.
  5. `setStreaming(false)` in `finally`.

### Server (`src/app/api/chat/route.ts`)
- Groq called with `stream: true`.
- Parses upstream SSE line-by-line (`:56-89`), extracting
  `json.choices[0].delta.content` and enqueuing **plain text** into an
  outgoing `ReadableStream`.
- Terminates on upstream `data: [DONE]`.
- Response content type: `text/plain; charset=utf-8`,
  `Cache-Control: no-cache, no-transform`.

### Why plain text vs. forwarding SSE?
Client side is just a `ReadableStream` + `TextDecoder` — no SSE parser, no
`EventSource`. Server already has to tail the stream to detect errors, so
unwrapping is effectively free.

### Invariants
- One streaming chat at a time — `useSession.chatStreaming` guards input
  disablement (`ChatColumn.tsx:219-228`).
- Assistant bubble identity is stable (`assistantId`) for the entire stream;
  every delta mutates the same `ChatMessage`.
- History passed to the model EXCLUDES the empty assistant placeholder
  (`:89-91` only maps prior messages, not the just-pushed empty one — but
  note the user message is already in `chat` by the time `history` is
  built; it's included).

---

## 4. State management

Two stores in `src/lib/store.ts`. Both are Zustand with `persist`.

### `useSettings`
- Key: `twinmind.settings.v1`.
- All fields persist. Includes `apiKey`.
- Actions: `setSettings(patch)`, `resetPrompts()`.

### `useSession`
- Key: `twinmind.session.v1`.
- **Only** persists history-bearing fields via `partialize`
  (`store.ts:172-177`): `sessionStartedAt`, `chunks`, `batches`, `chat`.
- Transient flags start fresh on every reload:
  `recording`, `mockActive`, `loadingSuggestions`, `chatStreaming`,
  `inflightTranscribes`, `transcribeErrorStreak`, `autoRefreshPaused`.
- Mutations are additive:
  - `addChunk` → appends (preserves insertion order).
  - `addBatch` → **prepends** (newest batch on top).
  - `addChatMessage` → appends.
  - `appendToChatMessage(id, delta)` → in-place edit of the matching msg.

### Access patterns
- Components read via selectors: `useSession((s) => s.chunks)` — re-renders
  scoped to the selected slice.
- Imperative reads (inside async handlers) use `useSession.getState()` to
  get the **freshest** value without stale closures
  (`SuggestionsColumn.tsx:61`, `83`; `page.tsx:24`).

---

## 5. Settings & persistence

- All settings (including API key) live in `localStorage` under
  `twinmind.settings.v1`.
- `SettingsDialog.tsx` is the sole UI for mutations; it calls
  `setSettings(patch)` which merges.
- `resetPrompts()` restores `DEFAULT_SUGGESTIONS_PROMPT`,
  `DEFAULT_DETAILED_ANSWER_PROMPT`, `DEFAULT_CHAT_PROMPT` — it does NOT
  touch any non-prompt field.
- Mid-meeting edits take effect on the **next** tick / request — no
  component captures settings in long-lived closures.

### Contract for adding a new persisted setting
1. Field in `Settings` (`types.ts:37-56`).
2. Default in `DEFAULT_SETTINGS` (`store.ts:17-36`).
3. UI control in `SettingsDialog.tsx`.
4. Read at the call site; do not precompute into a ref/closure.

---

## 6. Adaptive cadence gates (implemented)

Proposed in `ADAPTIVE_CADENCE.md`; implemented in
`src/components/SuggestionsColumn.tsx` + `src/lib/signals.ts` +
`src/lib/store.ts`. Summary of what is live today:

| Label | What | Bypassed by manual? |
|---|---|---|
| Cooldown | `minRefreshIntervalMs` between any two suggests | yes |
| **B1** question interrupt | Fire `refresh("interrupt")` on a new chunk matching `endsWithQuestion` | n/a (cooldown still caps cost) |
| **B2** decision interrupt | Same path, triggered by `containsDecisionPhrase` ("let's go with", "we'll ship", etc.) | n/a |
| **B4** named-claim interrupt | Same path, triggered by `containsNamedClaim` (number+unit, multi-word proper noun, acronym) | n/a |
| **B5** rolling summary | After every `SUMMARIZE_EVERY_CHUNKS` (default 6), regenerate a ≤200-word summary via `/api/chat` and inject as `meetingSummary` on the next suggest call | yes (manual refresh uses the current summary) |
| **D1** in-flight defer | Wait up to `inflightDeferMs` for latest chunk to land | yes |
| **D2** circuit breaker | After `transcribeErrorCircuitBreaker` consecutive transcribe errors, pause auto-refresh; resume via `resetTranscribeErrors` or next successful transcribe | yes (manual probes recovery) |
| **E1** dedup skip | Skip if `jaccard(window, lastSentWindow) > dedupJaccardThreshold`; show "no new context" notice | yes |

### Pure helpers (`src/lib/signals.ts`)
- `jaccard(a, b)` — token-bag similarity; both empty returns 1.
- `endsWithQuestion(text)` — `?` suffix OR last sentence starts with an
  interrogative opener.
- `containsDecisionPhrase(text)` — regex union over commitment phrases.
- `containsNamedClaim(text)` — number+unit, multi-word proper noun, or
  acronym; conservative to reduce false positives.
- `buildWindow(chunks, minutes, now)` — filters chunks with
  `endedAt >= now - minutes*60_000`; returns `{ text, lastChunkEndedAt }`.

### Unit-tested
`src/lib/signals.test.ts` — jaccard bounds, question / decision / named-claim
detection, window slicing. `src/lib/prompts.test.ts` — meeting-kind prompt
composition.

### Not yet implemented (see `ADAPTIVE_CADENCE.md §3`)
- A1 silence pause, A2 hot mode, A3 crosstalk hint, A4 shorter chunks,
  B3 window shrink on topic shift, C2 wrap-up, C3 role hint, D3 burst
  debounce, E1 UI "no-new-context for N ticks" indicator.

---

## 6b. Click-time web search (optional)

Lives entirely in the chat column and a single route; trivially removable.

### Flow
```
user clicks a card with needsWebSearch=true
  → ChatColumn.sendFromSuggestion(card)
      push user message (the card header)
      push empty assistant message, temporarily set content to "🔎 Searching the web…"
      → POST /api/websearch { query }          # src/app/api/websearch/route.ts
          forwards to Tavily; returns top-5 { title, url, snippet } + summary
      → attach sources to the assistant message (setChatMessageSources)
      → POST /api/chat with systemPrompt + "WEB SEARCH RESULTS:" block appended
      stream replaces the placeholder content with the answer
```

### Gates
- Chip render is gated on `settings.tavilyKey` being non-empty (or the
  server `TAVILY_API_KEY` env var being set — the chip component only sees
  the client key, so env-var-only setups hide the chip but the flow still
  works if the user clicks a free-form message).
- `/api/websearch` degrades gracefully: missing key → empty results array +
  an explanatory summary string; the chat call proceeds without grounding.

### Invariants
- Web search never runs from `/api/suggest`. Flagging is advisory; the
  expensive call happens only on user intent.
- Sources are persisted on the `ChatMessage` via `sources?: WebSearchSource[]`
  and included in the export JSON.

---

## 7. Mock playback mode

Used for testing without a mic. **Exercises the same downstream code as
real recording**, except `/api/transcribe` is bypassed.

### Flow
```
startMock() in TranscriptColumn.tsx:112
  → getScenario(settings.mockScenarioId)       src/lib/mockTranscripts.ts
  → startMockPlayback                          src/lib/mockPlayer.ts:59
      packChunks(scenario, chunkSeconds)       :27  (merges same-speaker lines,
                                                     flushes when bufDur ≥ chunkSeconds)
      setTimeout per chunk at
        delayMs = (cursorSec * 1000) / speed
      onChunk(text, startedAt, endedAt)
      → addChunk(...) directly                 (no API call)
```

### Invariants
- `useSession.mockActive` is a **separate** flag from `recording`.
- The suggestions loop gates on `recording || mockActive`
  (`SuggestionsColumn.tsx:23`), so cadence behaves identically in both.
- Mock and real mic cannot run simultaneously: `startMic` stops any mock
  (`TranscriptColumn.tsx:84`); `startMock` stops mic (`:114`).
- `mockSpeed` ∈ {1, 2, 5, 10} only affects the `setTimeout` delay; chunk
  durations are compressed but timestamps are anchored to `Date.now()` at
  emit time, so ordering remains correct.

---

## 8. Export

- Entry: Export button in `src/app/page.tsx:23-30`.
- Builder: `buildExport(...)` in `src/lib/export.ts:3-38`.
- Format: JSON. All timestamps as ISO-8601 strings.
- Structure:
  ```json
  {
    "session": { "startedAt", "exportedAt" },
    "transcript":       [ { "startedAt", "endedAt", "text" } ],
    "suggestionBatches":[ { "createdAt", "suggestions": [ { "type", "title", "preview" } ] } ],
    "chat":             [ { "createdAt", "role", "content", "fromSuggestion?" } ]
  }
  ```
- Batches are output in **chronological** order (`reverse()` at `:22`)
  even though in-memory they are newest-first.
- File name pattern: `twinmind-session-<ISO-with-dashes>.json`.

---

## 9. Error handling matrix

| Failure | Detected in | Propagation | User-visible |
|---|---|---|---|
| No API key | each column | early return + local `setError` | Red banner per column |
| Mic denied | `TranscriptColumn.startMic` catch | local | Banner |
| Transcribe HTTP error | `/api/transcribe` route | non-2xx response | Banner; increments `transcribeErrorStreak` → may trip D2 |
| Silent blob | `/api/transcribe:22` | `{text:""}` | Silent no-op |
| Suggest non-JSON | `/api/suggest:76-81` | 502 + raw text | Banner; next tick retries |
| Suggest HTTP error | route + client | error JSON | Banner |
| Chat HTTP error | route pre-stream | JSON body | Banner |
| Chat stream mid-break | `ChatColumn` reader catch (`:122-124`) | partial content stays visible | Banner; user retries |
| Prompt-edit mid-run | n/a — next call uses new prompt | — | — |

D2 circuit breaker recovers automatically on the next successful
transcribe (`store.ts:141-149`) or via a manual reload click.

---

## 10. Testing surface

- Runner: `vitest` + `jsdom` (`package.json:10-11`, `:29-35`).
- Specs:
  - `src/lib/signals.test.ts` — pure helpers.
  - `src/components/SuggestionsColumn.test.tsx` — refresh path, gates.
- Run: `npm test` (watch) or `npm run test:run` (CI).

### When adding a new adaptive gate
1. Add a pure helper in `src/lib/signals.ts` (keep React out).
2. Add a unit test in `signals.test.ts`.
3. Compose it inside `refresh()` with an ordering that respects:
   - `loadingSuggestions` first,
   - manual bypass semantics,
   - cooldown last (to bound cost of upstream gates).
4. Add a behavioral test in `SuggestionsColumn.test.tsx`.

---

## 11. Latency budget

End-to-end "click mic → first suggestion":

```
t = 0s   mic click, permission granted
t +0–30s first 30 s chunk (chunkSeconds)
t +~2s   Groq Whisper RTT (per chunk)
t +1s    React render / store update
t +0–30s suggestions countdown (autoRefreshSeconds, independent timer — may already be near 0)
t +~1–2s Groq gpt-oss-120b JSON-mode RTT for 3 suggestions, max_tokens=700
```

Floor ≈ `chunkSeconds + 2s + Groq RTT`. First streaming token for chat ≈
Groq TTFT (~0.5–1.5 s) + `fetch` overhead.

Tuning knobs for lower latency (with tradeoffs noted in `ADAPTIVE_CADENCE.md §A4`):
- Lower `chunkSeconds` to 10–15.
- Lower `autoRefreshSeconds` for denser cadence.
- Keep `max_tokens` on suggestions small (currently 700) — don't pay the tail.

---

## 12. Security notes

- **API key never on the server.** `getKey(req)` reads the per-request
  `x-groq-key` header (`src/lib/groq.ts:7-10`). Env variables are not
  consulted.
- **Do not log request bodies or the header value** from any route.
- **Same-origin** API calls only. The client never talks to Groq directly.
- **No auth** — this is a single-user local-key tool. If you add
  persistence across devices, add auth **and** rotate the key-transport
  mechanism (e.g., short-lived signed tokens from a server-side secret;
  see `DESIGN.md §10`).
- **localStorage is device-scoped.** Clearing site data removes API key
  and session history.
