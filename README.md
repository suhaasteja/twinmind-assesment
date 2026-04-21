# TwinMind — Live Meeting Copilot

A browser-based Jarvis for meetings. Mic → transcription in ~30s chunks → 3 context-aware suggestions → one-click detailed answer in a side chat, with optional live web grounding.

Built to [`assignment.md`](./assignment.md). The next section maps every spec bullet to where it's implemented — start there.

## Run locally

```bash
npm install
npm run dev
# opens http://localhost:3000
```

1. Click **Settings** → paste a **Groq API key** ([console.groq.com](https://console.groq.com)).
2. (Optional) Paste a **Tavily API key** ([app.tavily.com](https://app.tavily.com)) to enable click-time web search.
3. Click the mic, or use **Play mock** to demo with a pre-recorded podcast transcript at 2×–10× speed (useful if you don't want to speak into a mic).

Keys are held only in browser `localStorage` and forwarded via per-request headers. No `.env` required.

## How it meets the assignment spec

### Mic + transcript (left column)

- **Start/stop mic button** — `TranscriptColumn.tsx` mic button (red dot while recording).
- **Chunks every ~30 seconds** — `settings.chunkSeconds` (default 30); `MediaRecorder` stops and restarts per chunk so each upload is a self-contained, Whisper-decodable webm/opus file (more reliable than `timeslice` fragments).
- **Auto-scroll to latest line** — `useEffect` on `chunks.length` in `TranscriptColumn.tsx`.

### Live suggestions (middle column)

- **Auto-refresh every ~30s** — countdown visible in the header; `settings.autoRefreshSeconds` (default 30).
- **Manual refresh button** — `Reload suggestions` in `SuggestionsColumn.tsx` header.
- **Exactly 3 fresh suggestions per refresh** — enforced in the system prompt and by `.slice(0, 3)` in the suggest parser.
- **New batch on top, older batches below** — batches stack with `bIdx === 0` at full opacity; older ones fade.
- **Tappable cards with a useful preview** — each card is a `<button>`; the preview is self-sufficient (usable fact or phrasing) per strict prompt rules. Clicking routes to the chat.
- **Context-appropriate type mix** — five types (`question` / `talking_point` / `answer` / `fact_check` / `clarify`). Prompt rules force an `answer` when there's an unanswered question, prefer `fact_check` on concrete claims, `clarify` on missing context, and `question`/`talking_point` when the conversation drifts. Meeting-kind presets (lecture / 1:1 / pitch / standup / interview) tune the mix and tone further.

### Chat (right column)

- **Click suggestion → detailed answer in chat** — `sendFromSuggestion()` in `ChatColumn.tsx` seeds the chat with a suggestion-chip header and streams a longer detailed-answer prompt back.
- **Wider context** — detailed-answer call sends the **full transcript** by default (`detailedContextMinutes: 0`) plus the entire prior chat history.
- **Free-form typed questions** — the text input below the chat goes through the same stream with the shorter `chatPrompt`.
- **One continuous chat per session, no login** — single in-memory chat array in the Zustand store.
- **Reload behavior** — the store is wrapped in `persist` so transcript / batches / chat / summary survive accidental reloads. The **Clear** button in the transcript column is the explicit reset (wipes all state including the rolling summary). The spec only says persistence isn't required; this is a small UX win on top.

### Export

- **Full session JSON** — `export.ts` emits transcript chunks, suggestion batches, chat messages, and (when present) web-search sources — all with ISO timestamps. Downloadable from the top bar.

## Beyond the spec

### Click-time web search (`fact_check` / `clarify` / time-sensitive `answer`)

The suggest model sets `needsWebSearch: true` on cards whose concrete value it shouldn't guess. The parser force-ons this for every `fact_check` and `clarify`. Flagged cards render a `🌐 click to web-search` chip (only if a Tavily key is configured). Clicking a flagged card → chat shows `🔎 Searching the web…` → Tavily returns top-5 results → they're injected into the detailed-answer system prompt as a `WEB SEARCH RESULTS:` block → the streamed answer cites inline and a clickable **Sources** footer renders under it (preserved in the export).

### Suggestion quality

- **Strict JSON schema**, enforced with Groq's `response_format: { type: "json_object" }`.
- **Anti-fabrication guardrail** in the prompt: numbers/dates/ranges must be grounded or deferred to web search — never invented.
- **User-editable prompts** — all three (suggestions / detailed-answer / chat) editable in Settings with a Reset button.

### Latency & cost

- **Streaming** chat (server parses Groq SSE, forwards plain text deltas).
- **Parallel transcription** — each chunk uploads independently; UI never blocks.
- **Rolling summary** compresses older transcript into ≤200 words every 6 chunks, so the suggest prompt stays small (recent ~5 min verbatim + summary of everything before).
- **Adaptive cadence** — per-refresh cooldown, in-flight transcribe defer, Jaccard dedup on identical windows, circuit breaker on consecutive transcribe errors (`ADAPTIVE_CADENCE.md`).
- **Interrupt triggers** — off-cycle refresh when the transcript shows an unanswered question, decision phrase, or named claim (`signals.ts`).

### Mock playback (for reviewers without mic access)

`Play mock` plays a pre-recorded transcript (default: TwinMind founder podcast with speaker labels) at 1×–10× speed. No mic permission, no Whisper calls. Every feature above is visible in this mode.

## Stack

- **Next.js 14** (App Router) + **TypeScript** — single deploy; API routes proxy all third-party calls so keys never hit CORS.
- **TailwindCSS** + **lucide-react** — dark UI.
- **Zustand** (+ `persist`) — session store.
- **Groq** — `whisper-large-v3` for STT, `openai/gpt-oss-120b` for suggestions + chat (SSE).
- **Tavily** (optional) — web search on flagged clicks.
- **`MediaRecorder`** — per-chunk stop/restart for clean webm/opus blobs.

## File map

```
src/
  app/
    api/
      transcribe/route.ts   # Groq Whisper proxy
      suggest/route.ts      # JSON-mode suggestions, permissive needsWebSearch parser
      chat/route.ts         # SSE → plain-text streaming proxy
      websearch/route.ts    # Tavily proxy; graceful no-key fallback
    layout.tsx, page.tsx    # 3-column shell
    globals.css             # dark theme tokens
  components/
    TranscriptColumn.tsx    # mic / mock / clear
    SuggestionsColumn.tsx   # cards, interrupt triggers, rolling summary loop
    ChatColumn.tsx          # streaming chat, web-search branch, sources footer
    SettingsDialog.tsx      # keys, prompts, meeting kind, cadence knobs
    WebSearchChip.tsx       # "click to web-search" chip (flagged cards)
    ui.tsx                  # Panel, TypeChip, StatusDot, etc.
  lib/
    prompts.ts              # editable defaults + meeting-kind hints
    store.ts                # zustand: settings + session
    groq.ts, audio.ts
    websearch.ts            # Tavily client + WEB SEARCH RESULTS formatter
    signals.ts              # interrupt-trigger heuristics
    export.ts               # session → JSON download
    mockTranscripts.ts, mockPlayer.ts
    types.ts, utils.ts
```

## Deploy

Any Node host. Tested on Vercel (`npx vercel`).

- `TAVILY_API_KEY` env var is optional — if set, users don't need to paste the Tavily key in Settings.
- No other env vars required.

## Further reading

- `ARCHITECTURE.md` — component + data-flow diagrams.
- `ADAPTIVE_CADENCE.md` — refresh-cadence scenarios and tuning.
- `DESIGN.md`, `PRODUCT_ALIGNMENT.md`, `FUTURE_WORK.md` — design journal.
