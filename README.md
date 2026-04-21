# TwinMind — Live Meeting Copilot

A browser-based copilot for live meetings. It listens through your mic, transcribes in ~30s chunks, surfaces three context-aware suggestions every refresh, and streams a detailed answer in a side chat whenever you tap a card — with optional live web grounding for claims it shouldn't guess at.

## Quick start

```bash
npm install
npm run dev
# http://localhost:3000
```

1. Open **Settings** and paste a **Groq API key** ([console.groq.com](https://console.groq.com)).
2. *(Optional)* Paste a **Tavily API key** ([app.tavily.com](https://app.tavily.com)) to enable click-time web search.
3. Click the mic — or hit **Play mock** to demo with a pre-recorded podcast transcript (1×–10× speed) without granting mic access.

Keys stay in browser `localStorage` and are forwarded to server routes via per-request headers. No `.env` required.

## What it does

### Transcript (left column)

Start/stop mic. Audio is chunked every ~30s by stopping and restarting `MediaRecorder` so every upload is a complete, Whisper-decodable webm/opus file. Chunks render as timestamped lines and auto-scroll. A **Clear** button wipes the session.

### Live suggestions (middle column)

Auto-refreshes every `autoRefreshSeconds` (default 30s), with a visible countdown and a manual reload button. Each refresh produces **exactly three** fresh cards, new batch on top, older batches fading below.

Cards are typed — `question`, `talking_point`, `answer`, `fact_check`, `clarify` — and mixed by the prompt: if an unanswered question sits in the transcript an `answer` is forced; concrete claims invite `fact_check`; missing context invites `clarify`; drift invites `question` / `talking_point`. **Meeting-kind presets** (general / lecture / 1:1 / pitch / standup / interview) append a short hint that shifts the type-mix and tone.

Every preview is written to stand on its own — a usable fact or phrasing, never a teaser. When the model can't know a concrete value without grounding, it flags the card instead of guessing.

### Chat (right column)

One continuous, streaming chat. Tapping a suggestion seeds the chat with a card header and streams a longer detailed answer that sees the **full transcript** plus prior chat history. You can also type free-form questions — same stream, lighter prompt.

The session store persists across accidental reloads; the transcript's **Clear** button is the explicit reset.

### Export

One-click JSON download of the full session: transcript chunks, every suggestion batch, the chat transcript, and any web-search sources — all ISO-timestamped.

## Web search, on click

The suggest model marks `fact_check` and `clarify` cards (and time-sensitive `answer`s) with `needsWebSearch: true`. If a Tavily key is configured, those cards render a `🌐 click to web-search` chip. Clicking one:

1. The chat shows `🔎 Searching the web…`.
2. Tavily returns the top 5 results.
3. They're injected into the detailed-answer system prompt as a `WEB SEARCH RESULTS:` block.
4. The answer streams back with inline citations and a clickable **Sources** footer — preserved in the export.

If the key isn't set, the chip is hidden and suggestions still work (just without live grounding).

## Design details worth calling out

- **Strict JSON schema** on suggestions, enforced with Groq's `response_format: { type: "json_object" }`.
- **Anti-fabrication guardrail** — the prompt forbids invented numbers, dates, ranges, or provenance. Un-groundable facts defer to web search instead of being guessed.
- **Rolling summary** compresses older transcript into ≤200 words every 6 chunks, so the suggest prompt stays small (recent ~5 min verbatim + summary of everything before).
- **Adaptive cadence** — per-refresh cooldown, in-flight transcribe defer, Jaccard dedup on near-identical windows, and a circuit breaker on consecutive transcribe errors. See `ADAPTIVE_CADENCE.md`.
- **Interrupt triggers** — an off-cycle refresh fires when the transcript shows an unanswered question, decision phrase, or named claim (`signals.ts`).
- **Streaming everywhere** — suggest uses JSON-mode; chat streams Groq SSE → plain-text deltas.
- **Parallel transcription** — each chunk uploads independently so the UI never blocks.
- **Editable prompts** — all three system prompts live in `src/lib/prompts.ts` and are editable in Settings with a Reset button.

## Mock playback

If you don't want to grant mic access, **Play mock** streams a pre-recorded transcript (default: TwinMind founder podcast with speaker labels) at 1×–10×. Everything above — suggestions, chat, web search, export — works the same.

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

Any Node host. Tested on Vercel (`npx vercel`). Build with `npm run build && npm start` elsewhere. `TAVILY_API_KEY` is an optional env var — if set, users don't need to paste the Tavily key in Settings. No other env vars required.

## Further reading

- `ARCHITECTURE.md` — component + data-flow diagrams.
- `ADAPTIVE_CADENCE.md` — refresh-cadence scenarios and tuning.
- `DESIGN.md`, `PRODUCT_ALIGNMENT.md`, `FUTURE_WORK.md` — design journal.
