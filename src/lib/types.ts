export type SuggestionType =
  | "question"
  | "talking_point"
  | "answer"
  | "fact_check"
  | "clarify";

export type MeetingKind =
  | "general"
  | "lecture"
  | "one_on_one"
  | "pitch"
  | "standup"
  | "interview";

export interface Suggestion {
  id: string;
  type: SuggestionType;
  title: string;
  preview: string;
  // When true, the card's preview intentionally withholds the concrete value
  // and defers verification to click-time. ChatColumn will run /api/websearch
  // first and inject the results into the detailed-answer prompt. Only ever
  // set on "fact_check" or "answer" cards — enforced by the suggest route.
  needsWebSearch?: boolean;
}

export interface SuggestionBatch {
  id: string;
  createdAt: number;
  suggestions: Suggestion[];
}

export interface TranscriptChunk {
  id: string;
  startedAt: number;
  endedAt: number;
  text: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: number;
  // When seeded from a suggestion click
  fromSuggestion?: {
    type: SuggestionType;
    title: string;
    needsWebSearch?: boolean;
  };
  // Populated on assistant messages whose detailed-answer call was grounded
  // on /api/websearch results. Renders as a clickable references footer in
  // ChatColumn and is preserved in the session export JSON.
  sources?: { title: string; url: string }[];
}

export interface Settings {
  apiKey: string;
  // Optional Tavily API key used by /api/websearch when the user clicks a
  // needsWebSearch-flagged suggestion. Falls back to process.env.TAVILY_API_KEY
  // on the server; if neither is present, the detailed-answer call runs
  // without web grounding and notes the omission in its reply.
  tavilyKey: string;
  suggestionsPrompt: string;
  detailedAnswerPrompt: string;
  chatPrompt: string;
  suggestionsContextMinutes: number; // how many recent minutes of transcript to send
  detailedContextMinutes: number;    // 0 = full transcript
  autoRefreshSeconds: number;        // interval between auto-refreshes
  chunkSeconds: number;              // MediaRecorder timeslice
  sttModel: string;
  llmModel: string;
  mockSpeed: number; // 1 = realtime, 2/5/10 = faster playback
  mockScenarioId: string;

  // Meeting kind — appends a kind-specific hint to the suggestions prompt so
  // the model tunes its type mix and tone to the situation (lecture vs. pitch
  // vs. 1:1 etc.). "general" = no hint appended.
  meetingKind: MeetingKind;

  // --- Adaptive cadence (see ADAPTIVE_CADENCE.md) -------------------------
  minRefreshIntervalMs: number;         // cooldown between any two /api/suggest calls (auto/interrupt)
  inflightDeferMs: number;              // max ms to wait on in-flight transcribes before firing anyway
  dedupJaccardThreshold: number;        // skip refresh when window similarity exceeds this
  transcribeErrorCircuitBreaker: number; // consecutive transcribe errors that pause auto-refresh
}
