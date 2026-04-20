"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import {
  ChatMessage,
  Settings,
  SuggestionBatch,
  TranscriptChunk,
} from "./types";
import {
  DEFAULT_CHAT_PROMPT,
  DEFAULT_DETAILED_ANSWER_PROMPT,
  DEFAULT_SUGGESTIONS_PROMPT,
} from "./prompts";

const DEFAULT_SETTINGS: Settings = {
  apiKey: "",
  suggestionsPrompt: DEFAULT_SUGGESTIONS_PROMPT,
  detailedAnswerPrompt: DEFAULT_DETAILED_ANSWER_PROMPT,
  chatPrompt: DEFAULT_CHAT_PROMPT,
  suggestionsContextMinutes: 5,
  detailedContextMinutes: 0, // 0 = full transcript
  autoRefreshSeconds: 30,
  chunkSeconds: 30,
  sttModel: "whisper-large-v3",
  llmModel: "openai/gpt-oss-120b",
  mockSpeed: 1,
  mockScenarioId: "infra",
  meetingKind: "general",

  // Adaptive cadence defaults — tuned in ADAPTIVE_CADENCE.md §5.
  minRefreshIntervalMs: 10_000,
  inflightDeferMs: 5_000,
  dedupJaccardThreshold: 0.9,
  transcribeErrorCircuitBreaker: 3,
};

// ---- Settings store (persisted to localStorage) ----

interface SettingsState {
  settings: Settings;
  setSettings: (patch: Partial<Settings>) => void;
  resetPrompts: () => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      settings: DEFAULT_SETTINGS,
      setSettings: (patch) =>
        set((s) => ({ settings: { ...s.settings, ...patch } })),
      resetPrompts: () =>
        set((s) => ({
          settings: {
            ...s.settings,
            suggestionsPrompt: DEFAULT_SUGGESTIONS_PROMPT,
            detailedAnswerPrompt: DEFAULT_DETAILED_ANSWER_PROMPT,
            chatPrompt: DEFAULT_CHAT_PROMPT,
          },
        })),
    }),
    {
      name: "twinmind.settings.v1",
      storage: createJSONStorage(() => localStorage),
    }
  )
);

// ---- Session store ------------------------------------------------------
// Transcript chunks, suggestion batches, and chat messages persist to
// localStorage so users keep their history across reloads. Transient flags
// (recording, loading, in-flight counts, error streaks) are intentionally
// NOT persisted — they should always start fresh on load.

interface SessionState {
  sessionStartedAt: number;
  recording: boolean;
  mockActive: boolean;
  chunks: TranscriptChunk[];
  batches: SuggestionBatch[];
  chat: ChatMessage[];
  loadingSuggestions: boolean;
  chatStreaming: boolean;

  // --- Adaptive cadence state (D1/D2) ------------------------------------
  inflightTranscribes: number;
  transcribeErrorStreak: number;
  autoRefreshPaused: boolean;

  // --- Rolling meeting summary (B5) --------------------------------------
  // Long-term memory of the session. `meetingSummary` is persisted because
  // it's history-bearing; `lastSummarizedChunkCount` and `summarizing` are
  // transient runtime flags.
  meetingSummary: string;
  lastSummarizedChunkCount: number;
  summarizing: boolean;

  setRecording: (v: boolean) => void;
  setMockActive: (v: boolean) => void;
  addChunk: (c: TranscriptChunk) => void;
  addBatch: (b: SuggestionBatch) => void;
  addChatMessage: (m: ChatMessage) => void;
  appendToChatMessage: (id: string, delta: string) => void;
  setLoadingSuggestions: (v: boolean) => void;
  setChatStreaming: (v: boolean) => void;

  incInflight: () => void;
  decInflight: () => void;
  recordTranscribeResult: (ok: boolean) => void;
  resetTranscribeErrors: () => void;
  setAutoRefreshPaused: (v: boolean) => void;

  setMeetingSummary: (s: string, atChunkCount: number) => void;
  setSummarizing: (v: boolean) => void;

  clear: () => void;
}

export const useSession = create<SessionState>()(
  persist(
    (set) => ({
  sessionStartedAt: Date.now(),
  recording: false,
  mockActive: false,
  chunks: [],
  batches: [],
  chat: [],
  loadingSuggestions: false,
  chatStreaming: false,
  inflightTranscribes: 0,
  transcribeErrorStreak: 0,
  autoRefreshPaused: false,
  meetingSummary: "",
  lastSummarizedChunkCount: 0,
  summarizing: false,
  setRecording: (v) => set({ recording: v }),
  setMockActive: (v) => set({ mockActive: v }),
  addChunk: (c) => set((s) => ({ chunks: [...s.chunks, c] })),
  addBatch: (b) => set((s) => ({ batches: [b, ...s.batches] })),
  addChatMessage: (m) => set((s) => ({ chat: [...s.chat, m] })),
  appendToChatMessage: (id, delta) =>
    set((s) => ({
      chat: s.chat.map((m) =>
        m.id === id ? { ...m, content: m.content + delta } : m
      ),
    })),
  setLoadingSuggestions: (v) => set({ loadingSuggestions: v }),
  setChatStreaming: (v) => set({ chatStreaming: v }),
  incInflight: () =>
    set((s) => ({ inflightTranscribes: s.inflightTranscribes + 1 })),
  decInflight: () =>
    set((s) => ({
      inflightTranscribes: Math.max(0, s.inflightTranscribes - 1),
    })),
  recordTranscribeResult: (ok) =>
    set((s) => {
      if (ok) {
        // A healthy transcribe clears the error streak and un-pauses any
        // auto-refresh that had been circuit-broken by prior failures.
        return { transcribeErrorStreak: 0, autoRefreshPaused: false };
      }
      return { transcribeErrorStreak: s.transcribeErrorStreak + 1 };
    }),
  resetTranscribeErrors: () =>
    set({ transcribeErrorStreak: 0, autoRefreshPaused: false }),
  setAutoRefreshPaused: (v) => set({ autoRefreshPaused: v }),
  setMeetingSummary: (s, atChunkCount) =>
    set({ meetingSummary: s, lastSummarizedChunkCount: atChunkCount }),
  setSummarizing: (v) => set({ summarizing: v }),
  clear: () =>
    set({
      sessionStartedAt: Date.now(),
      recording: false,
      mockActive: false,
      chunks: [],
      batches: [],
      chat: [],
      inflightTranscribes: 0,
      transcribeErrorStreak: 0,
      autoRefreshPaused: false,
      meetingSummary: "",
      lastSummarizedChunkCount: 0,
      summarizing: false,
    }),
    }),
    {
      name: "twinmind.session.v1",
      storage: createJSONStorage(() => localStorage),
      // Only persist the history-bearing fields. Transient runtime flags
      // (recording, loading, in-flight counters, circuit-breaker state)
      // must always start fresh on reload.
      partialize: (state) => ({
        sessionStartedAt: state.sessionStartedAt,
        chunks: state.chunks,
        batches: state.batches,
        chat: state.chat,
        meetingSummary: state.meetingSummary,
      }),
    }
  )
);
