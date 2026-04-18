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

// ---- Session store (in-memory only — spec says no persistence across reloads) ----

interface SessionState {
  sessionStartedAt: number;
  recording: boolean;
  mockActive: boolean;
  chunks: TranscriptChunk[];
  batches: SuggestionBatch[];
  chat: ChatMessage[];
  loadingSuggestions: boolean;
  chatStreaming: boolean;

  setRecording: (v: boolean) => void;
  setMockActive: (v: boolean) => void;
  addChunk: (c: TranscriptChunk) => void;
  addBatch: (b: SuggestionBatch) => void;
  addChatMessage: (m: ChatMessage) => void;
  appendToChatMessage: (id: string, delta: string) => void;
  setLoadingSuggestions: (v: boolean) => void;
  setChatStreaming: (v: boolean) => void;
  clear: () => void;
}

export const useSession = create<SessionState>((set) => ({
  sessionStartedAt: Date.now(),
  recording: false,
  mockActive: false,
  chunks: [],
  batches: [],
  chat: [],
  loadingSuggestions: false,
  chatStreaming: false,
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
  clear: () =>
    set({
      sessionStartedAt: Date.now(),
      recording: false,
      mockActive: false,
      chunks: [],
      batches: [],
      chat: [],
    }),
}));
