"use client";

import { useEffect, useRef, useState } from "react";
import { RefreshCw, Loader2 } from "lucide-react";
import { useSession, useSettings } from "@/lib/store";
import { formatTime, uid } from "@/lib/utils";
import {
  buildWindow,
  containsDecisionPhrase,
  containsNamedClaim,
  endsWithQuestion,
  jaccard,
} from "@/lib/signals";
import { buildSuggestionsPrompt, DEFAULT_SUMMARY_PROMPT } from "@/lib/prompts";
import { Suggestion } from "@/lib/types";
import { InfoCard, Panel, PanelHeader, TypeChip } from "./ui";
import { WebSearchChip } from "./WebSearchChip";

type RefreshTrigger = "auto" | "manual" | "interrupt";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

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
  const autoRefreshPaused = useSession((s) => s.autoRefreshPaused);
  const setAutoRefreshPaused = useSession((s) => s.setAutoRefreshPaused);

  const [error, setError] = useState<string | null>(null);
  const [skipNotice, setSkipNotice] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(settings.autoRefreshSeconds);

  // Adaptive-cadence refs. Not state because they don't drive rendering and
  // we want reads inside refresh() to see the freshest values without
  // re-creating the handler on every tick.
  const lastRefreshAtRef = useRef(0);
  const lastSentWindowRef = useRef("");
  const lastInterruptChunkIdRef = useRef<string | null>(null);
  // Synchronous in-flight guard. Set at function entry before any await so
  // two triggers firing in the same tick (e.g. auto-tick + B1/B2/B4
  // interrupt on the same chunk-add) can't both clear the gates and issue
  // duplicate /api/suggest calls. `loadingSuggestions` in the store is not
  // sufficient because it isn't set until after the defer sleep below.
  const inflightRef = useRef(false);
  // Mirror of countdown so the interval reads the current value without
  // bundling side-effects into a setState updater (which can mis-fire under
  // React strict/concurrent batching).
  const countdownRef = useRef(settings.autoRefreshSeconds);

  const refresh = async (trigger: RefreshTrigger = "auto") => {
    if (inflightRef.current) return;
    if (loading) return;
    if (!settings.apiKey) {
      setError("Paste your Groq API key in Settings first.");
      return;
    }
    inflightRef.current = true;
    try {
      await refreshImpl(trigger);
    } finally {
      inflightRef.current = false;
    }
  };

  const refreshImpl = async (trigger: RefreshTrigger) => {
    const isManual = trigger === "manual";

    // --- D2: transcribe circuit breaker -----------------------------------
    // Block auto/interrupt triggers once the transcribe error streak has
    // exceeded the threshold. Manual reload always bypasses so the user can
    // probe recovery.
    if (!isManual) {
      const s = useSession.getState();
      if (
        s.transcribeErrorStreak >= settings.transcribeErrorCircuitBreaker &&
        settings.transcribeErrorCircuitBreaker > 0
      ) {
        setAutoRefreshPaused(true);
        setError(
          "Transcription unavailable \u2014 check your Groq key / rate limit. Click Reload to retry."
        );
        return;
      }
    }

    // --- D1: defer briefly on in-flight transcribes -----------------------
    // If a transcribe is still running and the latest chunk we have is
    // stale, wait up to `inflightDeferMs` for it to land so the window
    // isn't missing the most-recent content.
    if (!isManual) {
      const deferStart = Date.now();
      const deferMs = Math.max(0, settings.inflightDeferMs);
      const staleCutoffMs = 10_000;
      while (true) {
        const s = useSession.getState();
        const newest = s.chunks.length
          ? s.chunks[s.chunks.length - 1].endedAt
          : 0;
        const stale = Date.now() - newest > staleCutoffMs;
        if (s.inflightTranscribes === 0 || !stale) break;
        if (Date.now() - deferStart >= deferMs) break;
        await sleep(100);
      }
    }

    // --- Build window -----------------------------------------------------
    const win = buildWindow(
      chunks,
      settings.suggestionsContextMinutes,
      Date.now()
    );
    if (win.text.trim().length < 20) {
      if (isManual) {
        setError("Not enough transcript yet — keep talking for a bit.");
      }
      return;
    }

    // --- E1: dedup-skip ---------------------------------------------------
    if (!isManual && lastSentWindowRef.current) {
      const similarity = jaccard(win.text, lastSentWindowRef.current);
      if (similarity > settings.dedupJaccardThreshold) {
        setSkipNotice("no new context \u2014 skipped");
        setCountdown(settings.autoRefreshSeconds);
        return;
      }
    }

    // --- Cooldown (auto + interrupt; manual bypasses) ---------------------
    if (!isManual && lastRefreshAtRef.current) {
      const sinceLast = Date.now() - lastRefreshAtRef.current;
      if (sinceLast < settings.minRefreshIntervalMs) return;
    }

    // Stamp cooldown + dedup window on gate-pass, not on fetch-success. If
    // a second trigger races in while this fetch is still pending, the
    // cooldown gate above must already reflect "we're refreshing right
    // now". Burning the window on a failed fetch is intentional: it
    // provides backpressure on a flapping endpoint.
    lastRefreshAtRef.current = Date.now();
    lastSentWindowRef.current = win.text;

    setError(null);
    setSkipNotice(null);
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
          transcript: win.text,
          previousTitles,
          prompt: buildSuggestionsPrompt(
            settings.suggestionsPrompt,
            settings.meetingKind
          ),
          model: settings.llmModel,
          meetingSummary:
            useSession.getState().meetingSummary || undefined,
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
      if (isManual) setAutoRefreshPaused(false);
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
    if (autoRefreshPaused) return;
    const interval = setInterval(() => {
      const next = countdownRef.current - 1;
      if (next <= 0) {
        countdownRef.current = settings.autoRefreshSeconds;
        setCountdown(settings.autoRefreshSeconds);
        void refresh("auto");
      } else {
        countdownRef.current = next;
        setCountdown(next);
      }
    }, 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, autoRefreshPaused, settings.autoRefreshSeconds, chunks.length]);

  // B1/B2/B4: jump-in triggers. When a new chunk lands that contains a
  // question, a decision phrase, or a named/numeric claim worth verifying,
  // fire an early refresh — subject to the in-refresh() cooldown gate. We
  // key off the latest chunk's id so we never re-trigger for the same
  // chunk on re-renders.
  useEffect(() => {
    if (!active) return;
    if (autoRefreshPaused) return;
    if (chunks.length === 0) return;
    const latest = chunks[chunks.length - 1];
    if (latest.id === lastInterruptChunkIdRef.current) return;
    lastInterruptChunkIdRef.current = latest.id;
    const shouldInterrupt =
      endsWithQuestion(latest.text) ||
      containsDecisionPhrase(latest.text) ||
      containsNamedClaim(latest.text);
    if (!shouldInterrupt) return;
    void refresh("interrupt");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chunks.length, active, autoRefreshPaused]);

  // B5: rolling meeting summary. Every SUMMARIZE_EVERY_CHUNKS new chunks we
  // re-summarize the full transcript in a background /api/chat call. The
  // result is threaded into subsequent /api/suggest requests as
  // `meetingSummary`, giving the suggestions model long-term memory even
  // though the live window stays small for freshness.
  useEffect(() => {
    if (!active) return;
    if (!settings.apiKey) return;
    const s = useSession.getState();
    if (s.summarizing) return;
    const SUMMARIZE_EVERY_CHUNKS = 6; // ≈ 3 min at 30s/chunk
    const delta = chunks.length - s.lastSummarizedChunkCount;
    if (delta < SUMMARIZE_EVERY_CHUNKS) return;
    if (chunks.length === 0) return;

    const snapshotLen = chunks.length;
    const priorSummary = s.meetingSummary;
    const fullTranscript = chunks.map((c) => c.text).join("\n");

    useSession.getState().setSummarizing(true);
    void (async () => {
      try {
        const userMessage = priorSummary
          ? `Prior rolling summary:\n${priorSummary}\n\nUpdate it using the full transcript below; produce a single replacement summary, not a diff.`
          : `Produce the first rolling summary of this meeting from the full transcript below.`;

        const res = await fetch("/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-groq-key": settings.apiKey,
          },
          body: JSON.stringify({
            systemPrompt: DEFAULT_SUMMARY_PROMPT,
            transcript: fullTranscript,
            history: [],
            userMessage,
            model: settings.llmModel,
          }),
        });
        if (!res.ok || !res.body) return;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let out = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          out += decoder.decode(value, { stream: true });
        }
        const cleaned = out.trim();
        if (cleaned) {
          useSession.getState().setMeetingSummary(cleaned, snapshotLen);
        }
      } catch {
        // Non-fatal: we'll try again on the next threshold. Keep the prior
        // summary intact so suggestions still benefit from older context.
      } finally {
        useSession.getState().setSummarizing(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chunks.length, active, settings.apiKey]);

  // Reset countdown when a source becomes active.
  useEffect(() => {
    if (active) {
      countdownRef.current = settings.autoRefreshSeconds;
      setCountdown(settings.autoRefreshSeconds);
    }
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
          onClick={() => void refresh("manual")}
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
          {!active
            ? "paused"
            : autoRefreshPaused
            ? "auto-refresh paused"
            : `auto-refresh in ${countdown}s`}
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
      {!error && skipNotice && (
        <div className="mx-4 mt-3 rounded border px-3 py-2 text-[11px] uppercase tracking-[0.12em] text-[var(--muted-2)]"
             style={{ borderColor: "var(--border)" }}>
          {skipNotice}
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
                {s.needsWebSearch && settings.tavilyKey && (
                  <div className="mt-2">
                    <WebSearchChip />
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
