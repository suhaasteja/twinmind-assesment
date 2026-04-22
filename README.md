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
3. Click the mic to start recording.

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
- **Adaptive cadence** — per-refresh cooldown, in-flight transcribe defer, Jaccard dedup on near-identical windows, and a circuit breaker on consecutive transcribe errors.
- **Rolling summary** — compresses older transcript into ≤200 words every 6 chunks, so the suggest prompt stays small (recent ~5 min verbatim + summary of everything before).
- **Streaming everywhere** — suggest uses JSON-mode; chat streams Groq SSE → plain-text deltas.
- **Parallel transcription** — each chunk uploads independently so the UI never blocks.
- **Editable prompts** — all three system prompts live in `src/lib/prompts.ts` and are editable in Settings with a Reset button.

## Prompt architecture

### Context hierarchy

The model sees context in this priority order:

1. **System prompt** (`suggestions`, `detailed_answer`, `summary`, or `chat`) — sets role, rules, output format
2. **Meeting summary** — rolling ≤200-word compression of older context, fed only to `/api/suggest` as "MEETING SO FAR (background only)"
3. **Transcript** — wrapped in `<transcript>` XML tags; suggestions see last N minutes (default 3), chat sees full history or trimmed tail
4. **Web search results** — injected as `WEB SEARCH RESULTS:` block into detailed-answer system prompt (not a separate user turn, so the model treats it as authoritative)
5. **Chat history** — prior user/assistant turns for conversational continuity
6. **User message** — the triggering suggestion `[type] title\n\nPreview: ...` or free-form question

### Card type logic

The suggestions prompt enforces a 5-type taxonomy:

- **`question`** — sharp question the user should ask next (never web-search flagged)
- **`talking_point`** — concrete point to bring up (never flagged)
- **`answer`** — direct response to a question just asked in the meeting (flagged only if time-sensitive/external data needed)
- **`fact_check`** — verify/correct a claim (ALWAYS flagged for web search)
- **`clarify`** — supply missing context (ALWAYS flagged)

**Forced answer rule**: If the most recent transcript line contains an unanswered question, at least one of the 3 cards MUST be type `answer`.

**Recency anchor**: Transcript lines are ISO-timestamped (YYYY-MM-DD HH:MM:SS, 24hr) with the final line marked `← MOST RECENT`. The prompt explicitly instructs anchoring on this line — if the topic shifted, old topics are history.

### Anti-fabrication guardrails

- **No invented numbers**: Specific values (dollar amounts, percentages, dates, ranges) must be either verifiably known from training or omitted entirely — the card flags for web search instead of guessing.
- **No fake provenance**: Phrases like "studies show" or "per benchmarks" are banned unless actually stated in the transcript.
- **Teaser-free previews**: Every preview must deliver standalone value — never "click to find out".

### Rolling summary mechanism

Every 6 chunks (~3 min), a background `/api/chat` call produces an updated summary using `DEFAULT_SUMMARY_PROMPT`. The result is stored and fed into subsequent suggestion calls as `meetingSummary`, giving the suggest model long-term memory even though the live transcript window stays small for freshness.

### Detailed answer structure

When a suggestion is tapped, the detailed-answer prompt requires:
1. **FIRST**: One sentence explaining WHY this suggestion was surfaced — citing the specific transcript moment or web result that triggered it
2. **SECOND**: The answer/recommendation in a standalone first sentence
3. **Then**: 2–5 tight bullets with specifics

## Tradeoffs & constraints

### 30-second chunking vs streaming

**Tradeoff**: We stop/restart `MediaRecorder` every ~30s rather than stream continuously.
- **Pro**: Each chunk is a complete, Whisper-decodable webm/opus file that can upload in parallel without blocking the UI
- **Con**: 30s latency between speech and first transcript appearance (vs real-time streaming STT)
- **Mitigation**: Chunk duration is configurable in Settings (as low as 5s, though this increases API cost)

### JSON mode for suggestions (no streaming)

**Tradeoff**: Suggestions use Groq's `json_schema` strict mode for structured output.
- **Pro**: Guaranteed parseable, type-safe cards; Zod validation + salvage fallback means the UI never breaks on malformed model output
- **Con**: No streaming — the user waits for all 3 cards to appear at once
- **Mitigation**: Chat uses SSE streaming for a snappy feel; suggestions are small JSON (~1KB) so latency is acceptable

### Full transcript for chat, trimmed for summary

**Tradeoff**: Chat sees untrimmed transcript; summary generation uses `trimTranscriptForPrompt()` at 350k chars (~87k tokens).
- **Pro**: Chat answers can reference any prior moment; summary generation won't blow context windows on marathon 6+ hour sessions
- **Con**: Very long meetings eventually truncate even for chat (rare edge case)
- **Mitigation**: The 350k limit allows ~5–6 hours of typical speech before truncation; rolling summary preserves older context for suggestions

### Web search on-click (not auto)

**Tradeoff**: We search only when the user clicks a flagged card, not preemptively.
- **Pro**: Cost control — no wasted searches for cards the user ignores; fresh results at click-time
- **Con**: ~1–2s delay on first click while Tavily fetches
- **Mitigation**: Results are cached implicitly by streaming the answer immediately after; no persistent cache to avoid stale data

### No live transcript display

**Tradeoff**: The transcript UI shows finalized chunks only, no live partial ASR.
- **Pro**: Battery life — continuous DOM updates and Whisper polling would drain mobile devices
- **Con**: Users can't see words appear as they speak
- **Mitigation**: Auto-scroll keeps the view anchored on latest; each chunk has a clear timestamp so the cadence is predictable

### Single-session, no login

**Tradeoff**: Everything lives in `localStorage` + Zustand; no backend persistence.
- **Pro**: Zero auth friction; privacy by default — no transcript leaves the browser except to Groq/Tavily
- **Con**: Lost on hard refresh if user hasn't exported; no cross-device sync
- **Mitigation**: Export button produces ISO-timestamped JSON of full session (transcript, suggestions, chat, sources)

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
    TranscriptColumn.tsx    # mic / clear
    SuggestionsColumn.tsx   # cards, rolling summary loop
    ChatColumn.tsx          # streaming chat, web-search branch, sources footer
    SettingsDialog.tsx      # keys, prompts, meeting kind, cadence knobs
    WebSearchChip.tsx       # "click to web-search" chip (flagged cards)
    ui.tsx                  # Panel, TypeChip, StatusDot, etc.
  lib/
    prompts.ts              # editable defaults + meeting-kind hints
    store.ts                # zustand: settings + session
    groq.ts, audio.ts
    websearch.ts            # Tavily client + WEB SEARCH RESULTS formatter
    signals.ts              # transcript windowing + dedup utilities
    export.ts               # session → JSON download
    types.ts, utils.ts
```

## Deploy

Any Node host. Tested on Vercel (`npx vercel`). Build with `npm run build && npm start` elsewhere. `TAVILY_API_KEY` is an optional env var — if set, users don't need to paste the Tavily key in Settings. No other env vars required.

