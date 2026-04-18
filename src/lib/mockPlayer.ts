"use client";

// Mock transcript playback. Groups scenario lines into chunks matching the
// real `chunkSeconds` cadence and emits them via `onChunk` at the same
// intervals a real recorder would. Shape is intentionally similar to
// `ChunkRecorderHandle` so it's a drop-in alternative.

import { MockScenario } from "./mockTranscripts";

export interface MockPlayerHandle {
  stop: () => void;
}

export interface StartMockArgs {
  scenario: MockScenario;
  chunkSeconds: number;
  speed: number; // 1 = realtime, 5 = 5x faster, etc.
  onChunk: (text: string, startedAt: number, endedAt: number) => void;
  onDone?: () => void;
}

interface PackedChunk {
  text: string;
  durationSec: number;
}

function packChunks(
  scenario: MockScenario,
  chunkSeconds: number
): PackedChunk[] {
  const out: PackedChunk[] = [];
  let buf: string[] = [];
  let bufDur = 0;
  let lastSpeaker: string | null = null;

  const flush = () => {
    if (buf.length) out.push({ text: buf.join("\n"), durationSec: bufDur });
    buf = [];
    bufDur = 0;
    lastSpeaker = null;
  };

  for (const line of scenario.lines) {
    // Collapse consecutive lines from the same speaker into one paragraph;
    // otherwise prefix with "Speaker: ".
    if (line.speaker === lastSpeaker && buf.length) {
      buf[buf.length - 1] = `${buf[buf.length - 1]} ${line.text}`;
    } else {
      buf.push(`${line.speaker}: ${line.text}`);
      lastSpeaker = line.speaker;
    }
    bufDur += line.durationSec;
    if (bufDur >= chunkSeconds) flush();
  }
  flush();
  return out;
}

export function startMockPlayback(args: StartMockArgs): MockPlayerHandle {
  const { scenario, chunkSeconds, speed, onChunk, onDone } = args;
  const chunks = packChunks(scenario, chunkSeconds);
  const safeSpeed = Math.max(1, speed || 1);

  let stopped = false;
  const timers: ReturnType<typeof setTimeout>[] = [];

  let cursorSec = 0; // how many seconds of "meeting time" have elapsed
  for (const c of chunks) {
    const emitAtSec = cursorSec + c.durationSec; // emit at end of chunk
    const delayMs = (emitAtSec * 1000) / safeSpeed;
    const chunkStartOffsetSec = cursorSec;
    const chunkEndOffsetSec = emitAtSec;
    cursorSec = emitAtSec;

    const scheduledAt = Date.now();
    timers.push(
      setTimeout(() => {
        if (stopped) return;
        // Use wall-clock timestamps anchored to now so auto-scroll/ordering works.
        const endedAt = Date.now();
        const startedAt =
          endedAt - Math.round(((chunkEndOffsetSec - chunkStartOffsetSec) * 1000) / safeSpeed);
        onChunk(c.text, startedAt, endedAt);
        // Fire onDone after the last chunk.
        if (c === chunks[chunks.length - 1]) {
          onDone?.();
        }
        void scheduledAt;
      }, delayMs)
    );
  }

  return {
    stop: () => {
      stopped = true;
      for (const t of timers) clearTimeout(t);
    },
  };
}
