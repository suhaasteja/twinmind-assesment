"use client";

// Tiny wrapper around MediaRecorder that emits one Blob every `chunkMs`
// milliseconds. We use separate recorders per chunk (stop+start) rather
// than `timeslice`, because `timeslice` produces fragments that aren't
// individually decodable by Whisper. Each chunk is a self-contained file.
//
// Handover overlap (Option B): the next recorder is started HANDOVER_MS
// before the current one is stopped, so both capture the same audio across
// the seam. This eliminates the ~50-100 ms mic-dead gap that the previous
// "stop-then-start-in-onstop" pattern produced, which was responsible for
// boundary-cut artifacts in transcripts (e.g. "mundane tasks you / want to
// do" or the "oh wow wars" Whisper misread at a loop seam).
//
// Downstream code (window filter, D1 staleness) assumes chunks abut and do
// not overlap, so we NORMALIZE the reported timestamps: each chunk's
// startedAt is snapped to the prior chunk's endedAt, and both are offset
// by chunkMs exactly. The actual audio data in consecutive blobs overlaps
// by ~HANDOVER_MS on the wire, which is below the ~80 ms Whisper usually
// needs to emit a word, so we don't expect double-emitted tokens.

// ~50 ms of overlap: enough to close the stop→start gap that caused
// boundary cuts, short enough that Whisper shouldn't emit duplicate words
// at the seam (Opus frames are 20 ms; 50 ms ≈ 2-3 frames).
const HANDOVER_MS = 50;

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
  // Track every live recorder. During the HANDOVER_MS overlap window there
  // may be two; external stop() must clean up both.
  const recorders = new Set<MediaRecorder>();
  // Reported startedAt of the next chunk. Abuts the prior chunk's
  // reported endedAt so downstream time-based logic sees no overlap.
  let nextStartedAt = 0;

  const spawn = () => {
    if (stopped) return;
    const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const parts: Blob[] = [];

    // Pin reported timestamps at spawn time. Every chunk has a nominal
    // duration of exactly chunkMs — wall-clock drift across the stop()
    // latency is ignored on purpose so consecutive chunks remain abutting.
    const startedAt = nextStartedAt || Date.now();
    const endedAt = startedAt + chunkMs;
    nextStartedAt = endedAt;

    rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) parts.push(e.data);
    };
    rec.onerror = (e) => onError?.(e);
    rec.onstop = () => {
      recorders.delete(rec);
      if (parts.length) {
        const blob = new Blob(parts, {
          type: mimeType || "audio/webm",
        });
        onChunk(blob, startedAt, endedAt);
      }
    };

    recorders.add(rec);
    rec.start();

    // Pre-start the next recorder HANDOVER_MS before this one stops, so
    // the mic stream is captured continuously across the seam.
    setTimeout(() => {
      if (!stopped) spawn();
    }, Math.max(0, chunkMs - HANDOVER_MS));

    // Then stop the current recorder at its nominal end. By this point
    // the next recorder has been running for ~HANDOVER_MS, so no audio
    // is lost.
    setTimeout(() => {
      if (rec.state === "recording") rec.stop();
    }, chunkMs);
  };

  spawn();

  return {
    stop: async () => {
      stopped = true;
      // Snapshot and stop every live recorder. `recorders` mutates inside
      // each recorder's `onstop` (via `recorders.delete(rec)`), so we
      // iterate a snapshot to avoid skipping entries.
      const live = Array.from(recorders).filter(
        (r) => r.state === "recording"
      );
      await Promise.all(
        live.map(
          (r) =>
            new Promise<void>((resolve) => {
              r.addEventListener("stop", () => resolve(), { once: true });
              r.stop();
            })
        )
      );
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
