# TwinMind — Live Suggestions

A live meeting copilot in the browser. Listens to your mic, transcribes every ~30s, and continuously surfaces **3 useful suggestions** based on what's being said. Clicking a suggestion opens a detailed, streamed answer in a session-only chat. Built to the [assignment spec](../assignment.md).

## Stack

- **Next.js 14** (App Router) + **TypeScript** — single deploy, API routes proxy Groq so the key doesn't hit CORS.
- **TailwindCSS** + **lucide-react** — dark UI tuned to the reference mockup.
- **Zustand** — small in-memory session store (transcript, batches, chat).
- **Groq** — `whisper-large-v3` for STT, `openai/gpt-oss-120b` for suggestions + chat (SSE streamed).
- **`MediaRecorder`** — one self-contained webm/opus blob per chunk (simpler + decodable by Whisper, unlike `timeslice` fragments).

## Run locally

```bash
cd app
npm install
npm run dev
# open http://localhost:3000, click Settings, paste a Groq key from console.groq.com
```

No env var is needed — the API key is stored only in browser `localStorage` and sent to server routes via an `x-groq-key` header per request.

## Layout

Three columns, matching the prototype:

1. **Mic & Transcript** — Start/stop mic, timestamped chunks every `chunkSeconds` (default 30s), auto-scroll, Recording/Idle badge.
2. **Live Suggestions** — Auto-refresh every `autoRefreshSeconds` (default 30s) plus manual reload. Each batch = exactly 3 typed cards (`QUESTION TO ASK`, `TALKING POINT`, `ANSWER`, `FACT-CHECK`, `CLARIFY`). New batches push in at the top; older batches stay visible and fade with depth.
3. **Chat (Detailed Answers)** — Session-only, streaming. Click a suggestion to seed a detailed answer (separate, longer prompt + wider transcript context). Also accepts free-form questions.

Top bar: **Export** (full session JSON with ISO timestamps for every chunk, batch, and message) and **Settings**.

## Prompt strategy

All three prompts are in `src/lib/prompts.ts` and are fully editable via the Settings dialog (with a "Reset prompts" button).

**Live suggestions** (`/api/suggest`):

- Strict JSON schema, enforced with Groq's `response_format: { type: "json_object" }`.
- Five suggestion types encode the possible UX moves: `question`, `talking_point`, `answer`, `fact_check`, `clarify`.
- Explicit **timing rules** baked into the system prompt:
  1. If the transcript has an unanswered question, at least one suggestion **must** be an `answer`.
  2. If a factual claim was just made, prefer `fact_check`.
  3. If the conversation is drifting, prefer `question` / `talking_point`.
  4. Mix types across the 3 — no triples-of-the-same unless the moment demands it.
  5. Previous-batch titles are passed in and must not be repeated.
- Preview text must be **self-sufficient** (a number, a concrete recommendation, a phrasing) — not a teaser.
- Context window is a rolling "last N minutes" slice (default 5 min) of timestamped chunks. Short slices = faster, fresher suggestions; older content is intended to live in a rolling summary (hook present; can be turned on for very long meetings).

**Detailed answer on click** (`/api/chat` with `detailedAnswerPrompt`):

- Separate, longer prompt tuned for the "read in 15 seconds and act" moment.
- First sentence = the answer. Then 2–5 tight bullets with specifics.
- Per-type behavior (`answer` → answer the question, `fact_check` → state right/wrong + corrected fact, etc.).
- Receives a wider transcript window (0 = full transcript by default).

**Typed chat** (`/api/chat` with `chatPrompt`):

- Shorter system prompt. Grounds in transcript when asked about the meeting; answers normally otherwise.

## Latency choices

- **Streaming** on chat (SSE parsed server-side, forwarded as plain text deltas — lean client).
- **Parallel** transcription: each chunk uploads independently; the UI never blocks on the previous one.
- **Small max_tokens** on suggestions (700) — they're short by design, so there's no reason to pay the tail.
- **`temperature=0`** for STT; **0.4** for suggestions (some variety), **0.5** for chat.
- **Skip silence**: chunks under 2 KB are dropped server-side before hitting Whisper.

## Tradeoffs

- **`MediaRecorder` stop/restart per chunk** instead of `timeslice`: each chunk is a valid, decodable file. Costs ~a frame of audio at the seam; worth it for reliability.
- **No rolling summary yet** — the hook is in `/api/suggest` (`meetingSummary` field). In a 2-hour meeting you'd want to generate one every ~5 batches to keep long-term context without growing prompt size. Left out to keep the first version tight.
- **localStorage key** is simpler and matches the spec ("paste your own key"); a production build would use a short-lived signed token from a server-side secret.
- **In-memory session only** — reloads wipe state, per spec.

## File map

```
src/
  app/
    api/
      transcribe/route.ts   # Groq Whisper proxy
      suggest/route.ts      # JSON-mode suggestions (3, typed)
      chat/route.ts         # SSE -> text streaming proxy
    layout.tsx, page.tsx    # 3-column shell
    globals.css             # dark theme tokens
  components/
    TranscriptColumn.tsx
    SuggestionsColumn.tsx
    ChatColumn.tsx
    SettingsDialog.tsx
    ui.tsx                  # Panel, Button, TypeChip, StatusDot
  lib/
    prompts.ts              # all default prompts
    store.ts                # zustand: settings (persisted) + session (in-memory)
    groq.ts                 # tiny fetch wrappers for Groq endpoints
    audio.ts                # chunked MediaRecorder
    export.ts               # session -> JSON download
    types.ts, utils.ts
```

## Deploy

Any static/Node host. Tested on Vercel (`npx vercel`). No env vars required.
