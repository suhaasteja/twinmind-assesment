"use client";

import { useEffect, useRef, useState } from "react";
import { Send, Loader2 } from "lucide-react";
import { useSession, useSettings } from "@/lib/store";
import { ChatMessage, Suggestion } from "@/lib/types";
import { formatClock, uid } from "@/lib/utils";
import { InfoCard, Panel, PanelHeader, TypeChip } from "./ui";

export interface ChatColumnHandle {
  sendFromSuggestion: (s: Suggestion) => void;
}

export function ChatColumn({
  registerHandle,
}: {
  registerHandle: (h: ChatColumnHandle) => void;
}) {
  const settings = useSettings((s) => s.settings);
  const chunks = useSession((s) => s.chunks);
  const chat = useSession((s) => s.chat);
  const addChatMessage = useSession((s) => s.addChatMessage);
  const appendToChatMessage = useSession((s) => s.appendToChatMessage);
  const streaming = useSession((s) => s.chatStreaming);
  const setStreaming = useSession((s) => s.setChatStreaming);

  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [chat]);

  const buildTranscript = (minutes: number) => {
    const cutoff = minutes > 0 ? Date.now() - minutes * 60_000 : 0;
    return chunks
      .filter((c) => c.endedAt >= cutoff)
      .map((c) => `[${formatClock(c.startedAt)}] ${c.text}`)
      .join("\n");
  };

  const send = async (
    userMessage: string,
    opts: {
      fromSuggestion?: Suggestion;
      systemPromptOverride?: string;
      contextMinutes?: number;
    } = {}
  ) => {
    if (!settings.apiKey) {
      setError("Paste your Groq API key in Settings first.");
      return;
    }
    if (!userMessage.trim()) return;
    setError(null);

    const userMsg: ChatMessage = {
      id: uid(),
      role: "user",
      content: userMessage,
      createdAt: Date.now(),
      fromSuggestion: opts.fromSuggestion
        ? {
            type: opts.fromSuggestion.type,
            title: opts.fromSuggestion.title,
          }
        : undefined,
    };
    addChatMessage(userMsg);

    const assistantId = uid();
    addChatMessage({
      id: assistantId,
      role: "assistant",
      content: "",
      createdAt: Date.now(),
    });

    setStreaming(true);
    try {
      const systemPrompt =
        opts.systemPromptOverride ?? settings.chatPrompt;
      const transcript = buildTranscript(
        opts.contextMinutes ?? settings.detailedContextMinutes
      );
      const history = chat
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-groq-key": settings.apiKey,
        },
        body: JSON.stringify({
          systemPrompt,
          transcript,
          history,
          userMessage,
          model: settings.llmModel,
        }),
      });

      if (!res.ok || !res.body) {
        const txt = await res.text();
        setError(`Chat failed: ${res.status} ${txt.slice(0, 200)}`);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        if (chunk) appendToChatMessage(assistantId, chunk);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chat error");
    } finally {
      setStreaming(false);
    }
  };

  // Expose an imperative handle so suggestion clicks can seed a detailed answer.
  useEffect(() => {
    registerHandle({
      sendFromSuggestion: (s: Suggestion) => {
        const userMessage = `[${s.type.replace("_", " ")}] ${s.title}\n\nPreview: ${s.preview}`;
        void send(userMessage, {
          fromSuggestion: s,
          systemPromptOverride: settings.detailedAnswerPrompt,
          contextMinutes: settings.detailedContextMinutes,
        });
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat, settings, chunks]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const v = input.trim();
    if (!v || streaming) return;
    setInput("");
    void send(v);
  };

  return (
    <Panel className="h-full">
      <PanelHeader title="3. Chat (Detailed Answers)" right="Session-only" />

      <InfoCard>
        Clicking a suggestion adds it to this chat and streams a detailed answer (separate prompt,
        more context). You can also type questions directly. One continuous chat per session — no
        login, no persistence.
      </InfoCard>

      {error && (
        <div className="mx-4 mt-3 rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-[12px] text-red-300">
          {error}
        </div>
      )}

      <div
        ref={scrollRef}
        className="scrollbar mt-4 min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-4"
      >
        {chat.length === 0 && (
          <div className="mt-12 text-center text-[13px] text-[var(--muted-2)]">
            Click a suggestion or type a question below.
          </div>
        )}
        {chat.map((m) => (
          <div key={m.id} className="space-y-1">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.12em] text-[var(--muted-2)]">
              <span>{m.role === "user" ? "You" : "Copilot"}</span>
              <span>·</span>
              <span>{formatClock(m.createdAt)}</span>
            </div>
            {m.fromSuggestion && (
              <div className="flex items-center gap-2">
                <TypeChip type={m.fromSuggestion.type} />
                <span className="text-[12px] text-[var(--muted)]">
                  {m.fromSuggestion.title}
                </span>
              </div>
            )}
            <div
              className={
                m.role === "user"
                  ? "rounded-lg border bg-[var(--panel-2)] px-3 py-2 text-[14px] leading-relaxed"
                  : "whitespace-pre-wrap text-[14px] leading-relaxed text-[var(--fg)]"
              }
              style={
                m.role === "user" ? { borderColor: "var(--border)" } : undefined
              }
            >
              {m.content || (m.role === "assistant" && streaming ? "…" : "")}
            </div>
          </div>
        ))}
      </div>

      <form
        onSubmit={onSubmit}
        className="flex items-center gap-2 border-t px-3 py-3"
        style={{ borderColor: "var(--border)" }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask anything..."
          className="flex-1 rounded-md border bg-[var(--panel-2)] px-3 py-2 text-[14px] outline-none placeholder:text-[var(--muted-2)] focus:border-[var(--border-strong)]"
          style={{ borderColor: "var(--border)" }}
          disabled={streaming}
        />
        <button
          type="submit"
          disabled={streaming || !input.trim()}
          className="inline-flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {streaming ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          Send
        </button>
      </form>
    </Panel>
  );
}
