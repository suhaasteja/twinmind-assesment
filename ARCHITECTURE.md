# Architecture — TwinMind Live Suggestions

> AI-agent reading guide. This file is a **map**, not a tutorial. Every claim
> points at an exact file. For prose rationale, see `DESIGN.md`. For adaptive
> cadence scenarios, see `ADAPTIVE_CADENCE.md`.

---

## 1. One-paragraph summary

Next.js 14 App-Router app. The browser records mic audio in self-contained
webm/opus chunks, uploads each chunk to a stateless Next API route that
proxies Groq Whisper for STT, and writes the text into an in-browser Zustand
store. A second client loop slices the last N minutes of transcript every
~30s and POSTs it to a second stateless route that proxies Groq
`gpt-oss-120b` in JSON mode, producing exactly 3 typed suggestion cards.
Clicking a card (or typing) POSTs to a third route that proxies Groq chat
with `stream:true` and unwraps SSE into a plain-text delta stream. **No
database. No server-side session state.** Session history persists in
`localStorage` only so it survives reloads on the same device.

---

## 2. Stack (from `package.json:13-20`)

| Concern | Choice | Version |
|---|---|---|
| Framework | Next.js App Router | `next@14.2.35` |
| Language | TypeScript | `^5` |
| UI | React 18 + Tailwind 3 + lucide-react | — |
| State | Zustand (+ `persist` middleware) | `^5.0.12` |
| STT | Groq `whisper-large-v3` | per-request |
| LLM | Groq `openai/gpt-oss-120b` | per-request |
| Audio | native `MediaRecorder` (webm/opus) | — |
| Tests | Vitest + Testing Library + jsdom | — |

No backend database. No Redis. No auth.

---

## 3. Process boundaries

```
┌────────────── Browser (Next.js client) ──────────────┐        ┌──────── Next.js server (stateless) ────────┐        ┌── Groq ──┐
│ TranscriptColumn ──────► MediaRecorder (audio.ts)    │  blob  │ POST /api/transcribe  ─► groqTranscribe ──►│  mp     │ Whisper  │
│ SuggestionsColumn ─ reads store, slices window       │  json  │ POST /api/suggest     ─► groqChat(JSON)  ─►│  json   │ gpt-oss  │
│ ChatColumn ─────── reads store + history             │  json  │ POST /api/chat (SSE→text)                ─►│  sse    │ gpt-oss  │
│ Zustand stores ── useSettings (persist) / useSession │        │                                            │         │          │
└──────────────────────────────────────────────────────┘        └────────────────────────────────────────────┘        └──────────┘
```

- **Client owns state.** API routes are pure functions of their inputs.
- **API key flow:** user pastes key → stored in `localStorage` →
  sent per request as `x-groq-key` header → read by
  `getKey()` in `@/Users/mac/Desktop/twinmind-assignment/src/lib/groq.ts:7-10`.
  **Never** read from env; **never** logged.
- **CORS is avoided** by having the client hit same-origin Next routes
  instead of Groq directly.

---

## 4. Repository map

```
/Users/mac/Desktop/twinmind-assignment/
├── src/
│   ├── app/
│   │   ├── layout.tsx              # root shell
│   │   ├── page.tsx                # 3-column composition + export button
│   │   ├── globals.css             # dark-theme tokens
│   │   └── api/
│   │       ├── transcribe/route.ts # Groq Whisper proxy
│   │       ├── suggest/route.ts    # Groq JSON-mode suggestions
│   │       └── chat/route.ts       # Groq SSE → plain-text stream
│   ├── components/
│   │   ├── TranscriptColumn.tsx    # mic + mock + upload loop
│   │   ├── SuggestionsColumn.tsx   # countdown + refresh + adaptive gates
│   │   ├── ChatColumn.tsx          # streaming chat + suggestion handler
│   │   ├── SettingsDialog.tsx      # all user-editable settings
│   │   ├── ui.tsx                  # Panel/Button/TypeChip/StatusDot
│   │   └── SuggestionsColumn.test.tsx
│   └── lib/
│       ├── store.ts                # Zustand: useSettings + useSession
│       ├── types.ts                # canonical data shapes
│       ├── prompts.ts              # default prompts (editable in UI)
│       ├── groq.ts                 # thin Groq fetch wrappers
│       ├── audio.ts                # MediaRecorder chunker
│       ├── mockPlayer.ts           # scripted transcript playback
│       ├── mockTranscripts.ts      # demo scenarios
│       ├── signals.ts              # pure helpers: jaccard, question regex, buildWindow
│       ├── signals.test.ts
│       ├── export.ts               # session → JSON
│       └── utils.ts                # cn, formatTime, formatClock, uid
├── DESIGN.md                       # prose design + mermaid
├── ADAPTIVE_CADENCE.md             # adaptive refresh proposals
├── ARCHITECTURE.md                 # this file — map
├── SYSTEM_DESIGN.md                # subsystem contracts
├── assignment.md                   # spec
└── README.md                       # setup + tradeoffs
```

---

## 5. Canonical data shapes (authoritative: `src/lib/types.ts`)

```ts
// src/lib/types.ts
type SuggestionType = "question" | "talking_point" | "answer" | "fact_check" | "clarify";

interface Suggestion       { id; type: SuggestionType; title; preview; }
interface SuggestionBatch  { id; createdAt: number; suggestions: Suggestion[]; }  // length ALWAYS 0 or 3
interface TranscriptChunk  { id; startedAt: number; endedAt: number; text; }
interface ChatMessage      { id; role: "user"|"assistant"|"system"; content; createdAt; fromSuggestion?; }
interface Settings         { apiKey; 3 prompts; 2 context windows; autoRefreshSeconds;
                             chunkSeconds; sttModel; llmModel; mockSpeed; mockScenarioId;
                             minRefreshIntervalMs; inflightDeferMs;
                             dedupJaccardThreshold; transcribeErrorCircuitBreaker; }
```

**Invariant:** suggestion count per batch is enforced server-side in
`src/app/api/suggest/route.ts:83-93` via `.slice(0, 3)` after filtering
invalid entries.

---

## 6. State model

Two Zustand stores, both in `src/lib/store.ts`.

### 6a. `useSettings` — persisted
- Storage key: `twinmind.settings.v1` (localStorage).
- Holds user-tunable knobs + the Groq API key.
- Defaults live in `DEFAULT_SETTINGS` (`store.ts:17-36`).

### 6b. `useSession` — partially persisted
- Storage key: `twinmind.session.v1` (localStorage).
- `partialize` (`store.ts:172-177`) persists ONLY `sessionStartedAt`,
  `chunks`, `batches`, `chat`.
- Transient fields (`recording`, `mockActive`, `loadingSuggestions`,
  `chatStreaming`, `inflightTranscribes`, `transcribeErrorStreak`,
  `autoRefreshPaused`) are **intentionally not persisted** — they must
  start fresh on reload. Do not add to `partialize` without reason.

**Contract for new fields:**
- History-bearing (user cares across reloads) → add to `partialize`.
- Runtime flag / counter → leave out of `partialize`.

---

## 7. Request shapes (server contracts)

### `POST /api/transcribe`
```
Headers : x-groq-key: <apiKey>
Body    : multipart/form-data  { file: Blob, model: string }
Returns : { text: string }                       // empty if file < 2 KB (silence)
Errors  : 401 missing key | 400 missing file | upstream status on Groq failure
Source  : src/app/api/transcribe/route.ts
```

### `POST /api/suggest`
```
Headers : x-groq-key, Content-Type: application/json
Body    : { transcript, previousTitles[], prompt, model, meetingSummary? }
Returns : { suggestions: Suggestion[] }          // length 0 or 3
Errors  : 401 | 502 (model returned non-JSON) | upstream
Guard   : transcript < 20 chars → { suggestions: [] } (no Groq call)
Groq    : response_format={ type:"json_object" }, temperature=0.4, max_tokens=700
Source  : src/app/api/suggest/route.ts
```

### `POST /api/chat`
```
Headers : x-groq-key, Content-Type: application/json
Body    : { systemPrompt, transcript, history[], userMessage, model }
Returns : text/plain stream of token deltas (SSE parsed server-side)
Errors  : 401 | upstream (JSON body on failure)
Groq    : stream=true, temperature=0.5, max_tokens=900
Source  : src/app/api/chat/route.ts
```

**All three routes:** `runtime = "nodejs"`, `maxDuration = 60`. Stateless —
no module-level cache, no shared variables across requests.

---

## 8. End-to-end flow (happy path)

```
user click mic
  → TranscriptColumn.startMic()                 src/components/TranscriptColumn.tsx:81
  → audio.startChunkRecorder({ chunkMs })       src/lib/audio.ts:12
  (every chunkMs)
      → onChunk(blob, startedAt, endedAt)
      → POST /api/transcribe                    src/components/TranscriptColumn.tsx:53
      → groqTranscribe                          src/lib/groq.ts:28
      → addChunk(...)                           src/lib/store.ts:124

(independent 1 s interval while recording)
  → SuggestionsColumn countdown useEffect       src/components/SuggestionsColumn.tsx:170
  (on tick to 0)
      → refresh("auto")                         :47
          gates: D2 circuit breaker / D1 defer / window≥20 / E1 jaccard dedup / cooldown
      → POST /api/suggest                       :130
      → addBatch(prepend)                       src/lib/store.ts:125

(on suggestion click or user text)
  → ChatColumn.send                             src/components/ChatColumn.tsx:45
  → POST /api/chat                              :93
  → read ReadableStream, appendToChatMessage    :114-121, store.ts:127
```

---

## 9. Key invariants (DO NOT BREAK)

1. **Suggestion batch size = 3** (enforced server-side, `suggest/route.ts:85`).
2. **`MediaRecorder` stop/restart per chunk** — never switch to `timeslice`;
   fragments are not individually decodable by Whisper. See `audio.ts:31-57`.
3. **Single refresh path** — auto, manual, and interrupt triggers all call
   the same `refresh()` in `SuggestionsColumn.tsx:47`. Do not fork.
4. **Manual refresh bypasses every adaptive gate** except `loadingSuggestions`
   (`SuggestionsColumn.tsx:54` and 78, 108, 118). Cooldown, circuit breaker,
   defer, and dedup skip `isManual`.
5. **`loadingSuggestions` guard is authoritative** — no trigger may start a
   second `/api/suggest` while one is in flight. Guard lives at `:48`.
6. **Transient flags must not persist.** See `partialize` in `store.ts:172-177`.
7. **API key only travels in `x-groq-key` header.** Never in query string,
   never in request body, never logged server-side.
8. **Settings reads happen at request-build time**, so in-meeting edits take
   effect on the next tick without restart. Do not close over settings inside
   long-lived timers.

---

## 10. Extension playbook (for coding agents)

### Add a new suggestion type
1. Extend `SuggestionType` union — `src/lib/types.ts:1-6`.
2. Add to `VALID_TYPES` — `src/app/api/suggest/route.ts:16-22`.
3. Add a chip color — `src/components/ui.tsx` (TypeChip).
4. Mention the new type in `DEFAULT_SUGGESTIONS_PROMPT` — `src/lib/prompts.ts:4-30`.
5. (Optional) Mention behavior in `DEFAULT_DETAILED_ANSWER_PROMPT` — `prompts.ts:32-43`.

### Add a new user-editable setting
1. Add field + default to `Settings` — `types.ts:37-56` and
   `DEFAULT_SETTINGS` — `store.ts:17-36`.
2. Add control in `SettingsDialog.tsx`.
3. Read it where it's used; **do not** capture it in a stale closure.

### Add a new stateless API route
1. Create `src/app/api/<name>/route.ts` with `runtime = "nodejs"`.
2. Use `getKey(req)` from `groq.ts:7` for auth.
3. Return `NextResponse.json` OR a `ReadableStream` if you want streaming.
4. Keep it a pure function of its inputs — no module-level mutable state.

### Persist across devices (future, out of scope today)
See `DESIGN.md §10`. Single additive change: add `sessionId` + a Postgres
table keyed by it; API routes become thin reads/writes. Prompts, streaming
path, and the 30 s loop do not change.

---

## 11. Non-goals / explicit omissions

- **No server-side persistence.** Anything you add server-side must stay
  stateless or live behind a new opt-in route.
- **No auth.** The API key is user-owned and per-request.
- **No diarization.** See `ADAPTIVE_CADENCE.md §7`.
- **No streaming STT.** Groq Whisper is request/response.
- **No rolling summary yet.** Hook is wired (`meetingSummary` param in
  `suggest/route.ts:13,39`) but not generated.

---

## 12. Where to look first for common tasks

| Task | Start at |
|---|---|
| Change cadence / add adaptive rule | `src/components/SuggestionsColumn.tsx:47-210` + `src/lib/signals.ts` |
| Change audio chunking | `src/lib/audio.ts` |
| Tweak default prompts | `src/lib/prompts.ts` |
| Add a UI control | `src/components/SettingsDialog.tsx` + `src/lib/types.ts` |
| Change export format | `src/lib/export.ts` |
| Debug "no suggestions appear" | `suggest/route.ts:33-36` (guard) then `SuggestionsColumn.tsx:100-121` (gates) |
| Debug "chat never streams" | `chat/route.ts:56-90` (SSE parser) then `ChatColumn.tsx:114-121` (reader) |
