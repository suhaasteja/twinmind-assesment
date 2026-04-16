"use client";

import { useRef, useState } from "react";
import { Download, Settings as SettingsIcon, Sparkles } from "lucide-react";
import { TranscriptColumn } from "@/components/TranscriptColumn";
import { SuggestionsColumn } from "@/components/SuggestionsColumn";
import { ChatColumn, ChatColumnHandle } from "@/components/ChatColumn";
import { SettingsDialog } from "@/components/SettingsDialog";
import { Button } from "@/components/ui";
import { useSession, useSettings } from "@/lib/store";
import { buildExport, downloadJSON } from "@/lib/export";
import { Suggestion } from "@/lib/types";

export default function Home() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const chatRef = useRef<ChatColumnHandle | null>(null);
  const apiKey = useSettings((s) => s.settings.apiKey);

  const onSuggestionClick = (s: Suggestion) => {
    chatRef.current?.sendFromSuggestion(s);
  };

  const onExport = () => {
    const { sessionStartedAt, chunks, batches, chat } = useSession.getState();
    const data = buildExport({ sessionStartedAt, chunks, batches, chat });
    downloadJSON(
      `twinmind-session-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
      data
    );
  };

  return (
    <div className="flex h-screen flex-col">
      <header
        className="flex items-center justify-between border-b px-5 py-3"
        style={{ borderColor: "var(--border)" }}
      >
        <div className="flex items-center gap-2">
          <Sparkles size={16} className="text-[var(--accent)]" />
          <div className="text-[14px] font-semibold">
            TwinMind
            <span className="ml-2 text-[13px] font-normal text-[var(--muted)]">
              Live Suggestions
            </span>
          </div>
        </div>
        <div className="hidden text-[11px] uppercase tracking-[0.12em] text-[var(--muted)] md:block">
          3-column layout · Transcript · Live Suggestions · Chat
        </div>
        <div className="flex items-center gap-2">
          {!apiKey && (
            <span className="hidden rounded-full bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-300 md:inline">
              Add Groq API key →
            </span>
          )}
          <Button onClick={onExport}>
            <Download size={14} /> Export
          </Button>
          <Button onClick={() => setSettingsOpen(true)}>
            <SettingsIcon size={14} /> Settings
          </Button>
        </div>
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-1 gap-3 p-3 md:grid-cols-3">
        <TranscriptColumn />
        <SuggestionsColumn onSuggestionClick={onSuggestionClick} />
        <ChatColumn
          registerHandle={(h) => {
            chatRef.current = h;
          }}
        />
      </main>

      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
