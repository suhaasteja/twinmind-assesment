"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";
import { useSession, useSettings } from "@/lib/store";
import { startChunkRecorder, ChunkRecorderHandle } from "@/lib/audio";
import { formatClock, uid } from "@/lib/utils";
import { InfoCard, Panel, PanelHeader, StatusDot } from "./ui";

export function TranscriptColumn({
  onChunkTranscribed,
}: {
  onChunkTranscribed?: () => void;
}) {
  const settings = useSettings((s) => s.settings);
  const recording = useSession((s) => s.recording);
  const setRecording = useSession((s) => s.setRecording);
  const addChunk = useSession((s) => s.addChunk);
  const chunks = useSession((s) => s.chunks);

  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(0);
  const handleRef = useRef<ChunkRecorderHandle | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to latest chunk.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [chunks.length]);

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
      if (text) {
        addChunk({ id: uid(), startedAt, endedAt, text });
        onChunkTranscribed?.();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Transcribe error");
    } finally {
      setPending((p) => Math.max(0, p - 1));
    }
  };

  const start = async () => {
    setError(null);
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
      handleRef.current = h;
      setRecording(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not access microphone");
    }
  };

  const stop = async () => {
    await handleRef.current?.stop();
    handleRef.current = null;
    setRecording(false);
  };

  return (
    <Panel className="h-full">
      <PanelHeader
        title="1. Mic & Transcript"
        right={
          recording ? (
            <StatusDot color="#ef4444" label="Recording" pulse />
          ) : (
            <StatusDot color="#6b7280" label="Idle" />
          )
        }
      />

      <div className="flex items-center gap-3 px-4 pt-4">
        <button
          onClick={recording ? stop : start}
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
        <div className="text-[13px] text-[var(--muted)]">
          {recording
            ? `Listening… transcript updates every ${settings.chunkSeconds}s.`
            : chunks.length === 0
            ? "Click the mic to start."
            : "Stopped. Click to resume."}
          {pending > 0 && (
            <span className="ml-2 text-[11px] text-[var(--muted-2)]">
              transcribing {pending}…
            </span>
          )}
        </div>
      </div>

      <InfoCard>
        The transcript scrolls and appends new chunks every ~{settings.chunkSeconds} seconds while
        recording. Use the mic button to start/stop. Use Export (top bar) to pull the full session.
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
        {chunks.length === 0 && !recording && (
          <div className="mt-8 text-center text-[13px] text-[var(--muted-2)]">
            No transcript yet.
          </div>
        )}
      </div>
    </Panel>
  );
}
