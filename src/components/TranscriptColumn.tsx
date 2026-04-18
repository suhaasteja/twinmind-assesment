"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, Square, Play } from "lucide-react";
import { useSession, useSettings } from "@/lib/store";
import { startChunkRecorder, ChunkRecorderHandle } from "@/lib/audio";
import { startMockPlayback, MockPlayerHandle } from "@/lib/mockPlayer";
import { getScenario, MOCK_SCENARIOS } from "@/lib/mockTranscripts";
import { formatClock, uid } from "@/lib/utils";
import { InfoCard, Panel, PanelHeader, StatusDot } from "./ui";

export function TranscriptColumn() {
  const settings = useSettings((s) => s.settings);
  const setSettings = useSettings((s) => s.setSettings);
  const recording = useSession((s) => s.recording);
  const setRecording = useSession((s) => s.setRecording);
  const mockActive = useSession((s) => s.mockActive);
  const setMockActive = useSession((s) => s.setMockActive);
  const addChunk = useSession((s) => s.addChunk);
  const chunks = useSession((s) => s.chunks);

  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(0);
  const micHandleRef = useRef<ChunkRecorderHandle | null>(null);
  const mockHandleRef = useRef<MockPlayerHandle | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to latest chunk.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [chunks.length]);

  // ---- MIC MODE ----

  const transcribeBlob = async (blob: Blob, startedAt: number, endedAt: number) => {
    if (!settings.apiKey) {
      setError("Paste your Groq API key in Settings to start transcribing.");
      return;
    }
    setPending((p) => p + 1);
    try {
      const fd = new FormData();
      fd.append("file", blob, "chunk.webm");
      fd.append("model", settings.sttModel);
      const res = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "x-groq-key": settings.apiKey },
        body: fd,
      });
      const data = (await res.json()) as { text?: string; error?: string };
      if (!res.ok) {
        setError(data.error || `Transcribe failed (${res.status})`);
        return;
      }
      const text = (data.text ?? "").trim();
      if (text) addChunk({ id: uid(), startedAt, endedAt, text });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Transcribe error");
    } finally {
      setPending((p) => Math.max(0, p - 1));
    }
  };

  const stopMock = () => {
    mockHandleRef.current?.stop();
    mockHandleRef.current = null;
    setMockActive(false);
  };

  const startMic = async () => {
    setError(null);
    if (mockActive) stopMock();
    if (!settings.apiKey) {
      setError("Paste your Groq API key in Settings first.");
      return;
    }
    try {
      const h = await startChunkRecorder({
        chunkMs: settings.chunkSeconds * 1000,
        onChunk: (blob, startedAt, endedAt) => {
          void transcribeBlob(blob, startedAt, endedAt);
        },
        onError: (err) => setError(String(err)),
      });
      micHandleRef.current = h;
      setRecording(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not access microphone");
    }
  };

  const stopMic = async () => {
    await micHandleRef.current?.stop();
    micHandleRef.current = null;
    setRecording(false);
  };

  // ---- MOCK MODE ----

  const startMock = () => {
    setError(null);
    if (recording) void stopMic();
    const scenario = getScenario(settings.mockScenarioId);
    const h = startMockPlayback({
      scenario,
      chunkSeconds: settings.chunkSeconds,
      speed: settings.mockSpeed,
      onChunk: (text, startedAt, endedAt) => {
        addChunk({ id: uid(), startedAt, endedAt, text });
      },
      onDone: () => {
        // Playback reached the end of the script — stop the mock session
        // so the suggestions loop pauses naturally.
        mockHandleRef.current = null;
        setMockActive(false);
      },
    });
    mockHandleRef.current = h;
    setMockActive(true);
  };

  // Stop everything on unmount.
  useEffect(() => {
    return () => {
      mockHandleRef.current?.stop();
      void micHandleRef.current?.stop();
    };
  }, []);

  const active = recording || mockActive;

  return (
    <Panel className="h-full">
      <PanelHeader
        title="1. Mic & Transcript"
        right={
          recording ? (
            <StatusDot color="#ef4444" label="Recording" pulse />
          ) : mockActive ? (
            <StatusDot color="#f59e0b" label="Mock" pulse />
          ) : (
            <StatusDot color="#6b7280" label="Idle" />
          )
        }
      />

      <div className="flex flex-wrap items-center gap-2 px-4 pt-4">
        <button
          onClick={recording ? stopMic : startMic}
          aria-label={recording ? "Stop recording" : "Start recording"}
          className="flex h-10 w-10 items-center justify-center rounded-full border transition-colors"
          style={{
            background: recording ? "#ef4444" : "transparent",
            borderColor: recording ? "#ef4444" : "var(--border-strong)",
            color: recording ? "white" : "#ef4444",
          }}
        >
          {recording ? <Square size={16} fill="currentColor" /> : <Mic size={18} />}
        </button>

        <button
          onClick={mockActive ? stopMock : startMock}
          aria-label={mockActive ? "Stop mock playback" : "Play mock scenario"}
          disabled={recording}
          className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40"
          style={{
            background: mockActive ? "rgba(245,158,11,0.15)" : "var(--panel-2)",
            borderColor: mockActive ? "#f59e0b" : "var(--border)",
            color: mockActive ? "#fbbf24" : "var(--fg)",
          }}
          title="Play a pre-written demo transcript — no mic or Whisper needed"
        >
          {mockActive ? <Square size={12} fill="currentColor" /> : <Play size={12} fill="currentColor" />}
          {mockActive ? "Stop mock" : "Play mock"}
        </button>

        <select
          value={settings.mockScenarioId}
          onChange={(e) => setSettings({ mockScenarioId: e.target.value })}
          disabled={mockActive || recording}
          className="rounded-md border bg-[var(--panel-2)] px-2 py-1.5 text-[12px] outline-none disabled:opacity-50"
          style={{ borderColor: "var(--border)" }}
          title="Pick mock scenario"
        >
          {MOCK_SCENARIOS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </select>

        <select
          value={settings.mockSpeed}
          onChange={(e) => setSettings({ mockSpeed: Number(e.target.value) })}
          disabled={mockActive || recording}
          className="rounded-md border bg-[var(--panel-2)] px-2 py-1.5 text-[12px] outline-none disabled:opacity-50"
          style={{ borderColor: "var(--border)" }}
          title="Mock playback speed"
        >
          {[1, 2, 5, 10].map((s) => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </select>
      </div>

      <div className="px-4 pt-2 text-[13px] text-[var(--muted)]">
        {recording
          ? `Listening… transcript updates every ${settings.chunkSeconds}s.`
          : mockActive
          ? `Playing mock "${getScenario(settings.mockScenarioId).title}" at ${settings.mockSpeed}×.`
          : chunks.length === 0
          ? "Click the mic to start, or Play mock for a demo."
          : "Stopped. Click mic or Play mock to resume."}
        {pending > 0 && (
          <span className="ml-2 text-[11px] text-[var(--muted-2)]">
            transcribing {pending}…
          </span>
        )}
      </div>

      <InfoCard>
        The transcript scrolls and appends new chunks every ~{settings.chunkSeconds} seconds while
        recording. <b>Play mock</b> streams a pre-written meeting into the session at the same
        cadence — useful for testing without a mic. Use Export (top bar) to pull the full session.
      </InfoCard>

      {error && (
        <div className="mx-4 mt-3 rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-[12px] text-red-300">
          {error}
        </div>
      )}

      <div
        ref={scrollRef}
        className="scrollbar mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-4 text-[14px] leading-relaxed"
      >
        {chunks.map((c) => (
          <p key={c.id} className="text-[var(--fg)]">
            <span className="mr-2 text-[12px] text-[var(--muted-2)]">
              {formatClock(c.startedAt)}
            </span>
            {c.text}
          </p>
        ))}
        {chunks.length === 0 && !active && (
          <div className="mt-8 text-center text-[13px] text-[var(--muted-2)]">
            No transcript yet.
          </div>
        )}
      </div>
    </Panel>
  );
}
