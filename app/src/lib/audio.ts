"use client";

// Tiny wrapper around MediaRecorder that emits one Blob every `chunkMs`
// milliseconds. We use separate recorders per chunk (stop+start) rather
// than `timeslice`, because `timeslice` produces fragments that aren't
// individually decodable by Whisper. Each chunk is a self-contained file.

export interface ChunkRecorderHandle {
  stop: () => Promise<void>;
}

export async function startChunkRecorder(opts: {
  chunkMs: number;
  onChunk: (blob: Blob, startedAt: number, endedAt: number) => void;
  onError?: (err: unknown) => void;
}): Promise<ChunkRecorderHandle> {
  const { chunkMs, onChunk, onError } = opts;
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      channelCount: 1,
    },
  });

  const mimeType = pickMime();
  let stopped = false;
  let current: MediaRecorder | null = null;
  let currentStartedAt = 0;

  const cycle = () => {
    if (stopped) return;
    const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const parts: Blob[] = [];
    currentStartedAt = Date.now();

    rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) parts.push(e.data);
    };
    rec.onerror = (e) => onError?.(e);
    rec.onstop = () => {
      const endedAt = Date.now();
      if (parts.length) {
        const blob = new Blob(parts, {
          type: mimeType || "audio/webm",
        });
        onChunk(blob, currentStartedAt, endedAt);
      }
      if (!stopped) cycle();
    };

    current = rec;
    rec.start();
    setTimeout(() => {
      if (rec.state === "recording") rec.stop();
    }, chunkMs);
  };

  cycle();

  return {
    stop: async () => {
      stopped = true;
      if (current && current.state === "recording") {
        await new Promise<void>((resolve) => {
          current!.addEventListener("stop", () => resolve(), { once: true });
          current!.stop();
        });
      }
      stream.getTracks().forEach((t) => t.stop());
    },
  };
}

function pickMime(): string | null {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  for (const c of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) {
      return c;
    }
  }
  return null;
}
