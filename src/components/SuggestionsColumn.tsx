"use client";

import { useEffect, useRef, useState } from "react";
import { RefreshCw, Loader2 } from "lucide-react";
import { useSession, useSettings } from "@/lib/store";
import { formatClock, formatTime, uid } from "@/lib/utils";
import { Suggestion } from "@/lib/types";
import { InfoCard, Panel, PanelHeader, TypeChip } from "./ui";

export function SuggestionsColumn({
  onSuggestionClick,
}: {
  onSuggestionClick: (s: Suggestion) => void;
}) {
  const settings = useSettings((s) => s.settings);
  const recording = useSession((s) => s.recording);
  const mockActive = useSession((s) => s.mockActive);
  const active = recording || mockActive;
  const chunks = useSession((s) => s.chunks);
  const batches = useSession((s) => s.batches);
  const addBatch = useSession((s) => s.addBatch);
  const loading = useSession((s) => s.loadingSuggestions);
  const setLoading = useSession((s) => s.setLoadingSuggestions);

  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(settings.autoRefreshSeconds);
  const lastRefreshRef = useRef(0);

  const refresh = async () => {
    if (loading) return;
    if (!settings.apiKey) {
      setError("Paste your Groq API key in Settings first.");
      return;
    }
    // Build recent transcript window (last N minutes).
    const cutoff = Date.now() - settings.suggestionsContextMinutes * 60_000;
    const recent = chunks.filter((c) => c.endedAt >= cutoff);
    const transcript = recent
      .map((c) => `[${formatClock(c.startedAt)}] ${c.text}`)
      .join("\n");
    if (transcript.trim().length < 20) {
      setError("Not enough transcript yet — keep talking for a bit.");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const previousTitles = batches
        .slice(0, 2)
        .flatMap((b) => b.suggestions.map((s) => s.title));
      const res = await fetch("/api/suggest", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-groq-key": settings.apiKey,
        },
        body: JSON.stringify({
          transcript,
          previousTitles,
          prompt: settings.suggestionsPrompt,
          model: settings.llmModel,
        }),
      });
      const data = (await res.json()) as {
        suggestions?: Suggestion[];
        error?: string;
      };
      if (!res.ok) {
        setError(data.error || `Suggest failed (${res.status})`);
        return;
      }
      if (data.suggestions && data.suggestions.length > 0) {
        addBatch({
          id: uid(),
          createdAt: Date.now(),
          suggestions: data.suggestions,
        });
      }
      lastRefreshRef.current = Date.now();
      setCountdown(settings.autoRefreshSeconds);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Suggest error");
    } finally {
      setLoading(false);
    }
  };

  // Auto-refresh loop while recording OR mock is playing.
  useEffect(() => {
    if (!active) return;
    const interval = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          void refresh();
          return settings.autoRefreshSeconds;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, settings.autoRefreshSeconds, chunks.length]);

  // Reset countdown when a source becomes active.
  useEffect(() => {
    if (active) setCountdown(settings.autoRefreshSeconds);
  }, [active, settings.autoRefreshSeconds]);

  return (
    <Panel className="h-full">
      <PanelHeader
        title="2. Live Suggestions"
        right={`${batches.length} ${batches.length === 1 ? "batch" : "batches"}`}
      />

      <div
        className="flex items-center justify-between border-b px-4 py-2"
        style={{ borderColor: "var(--border)" }}
      >
        <button
          onClick={refresh}
          disabled={loading}
          className="inline-flex items-center gap-1.5 text-[13px] text-[var(--fg)] hover:text-white disabled:opacity-50"
        >
          {loading ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <RefreshCw size={14} />
          )}
          Reload suggestions
        </button>
        <div className="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">
          {active ? `auto-refresh in ${countdown}s` : "paused"}
        </div>
      </div>

      <InfoCard>
        On reload (or auto every ~{settings.autoRefreshSeconds}s), generate{" "}
        <b>3 fresh suggestions</b> from recent transcript context. New batch appears at the top;
        older batches push down (faded). Each is a tappable card: a{" "}
        <span style={{ color: "#f472b6" }}>question to ask</span>, a{" "}
        <span style={{ color: "#c4b5fd" }}>talking point</span>, an{" "}
        <span style={{ color: "#34d399" }}>answer</span>, or a{" "}
        <span style={{ color: "#fbbf24" }}>fact-check</span>. The preview alone should already be
        useful.
      </InfoCard>

      {error && (
        <div className="mx-4 mt-3 rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-[12px] text-red-300">
          {error}
        </div>
      )}

      <div className="scrollbar mt-4 min-h-0 flex-1 space-y-2 overflow-y-auto px-4 pb-4">
        {batches.length === 0 && !loading && (
          <div className="mt-8 text-center text-[13px] text-[var(--muted-2)]">
            Suggestions will appear here once the meeting is rolling.
          </div>
        )}

        {batches.map((batch, bIdx) => (
          <div key={batch.id} className="space-y-2">
            {bIdx > 0 && (
              <div className="my-3 flex items-center gap-3 text-[11px] uppercase tracking-[0.12em] text-[var(--muted-2)]">
                <div
                  className="h-px flex-1"
                  style={{ background: "var(--border)" }}
                />
                <span>
                  Batch {batches.length - bIdx} · {formatTime(batch.createdAt)}
                </span>
                <div
                  className="h-px flex-1"
                  style={{ background: "var(--border)" }}
                />
              </div>
            )}
            {batch.suggestions.map((s) => (
              <button
                key={s.id}
                onClick={() => onSuggestionClick(s)}
                className="block w-full rounded-lg border bg-[var(--panel-2)] px-3.5 py-3 text-left transition-colors hover:border-[var(--border-strong)] hover:bg-white/[0.03]"
                style={{
                  borderColor: "var(--border)",
                  opacity: bIdx === 0 ? 1 : Math.max(0.45, 1 - bIdx * 0.18),
                }}
              >
                <TypeChip type={s.type} />
                <div className="mt-2 text-[14px] font-medium leading-snug text-[var(--fg)]">
                  {s.title}
                </div>
                {s.preview && s.preview !== s.title && (
                  <div className="mt-1 text-[13px] leading-relaxed text-[var(--muted)]">
                    {s.preview}
                  </div>
                )}
              </button>
            ))}
          </div>
        ))}
      </div>
    </Panel>
  );
}
