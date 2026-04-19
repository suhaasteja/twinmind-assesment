/**
 * Behavior tests for SuggestionsColumn adaptive-cadence gates.
 *
 * Each scenario from ADAPTIVE_CADENCE.md §3 (E1, D1, D2, B1) maps to one or
 * more tests below. Baseline regression tests guard the unchanged happy path.
 *
 * fetch is mocked. Fake timers drive the countdown + defer loop. The Zustand
 * stores are reset between tests via `resetStores()`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { SuggestionsColumn } from "./SuggestionsColumn";
import { useSession, useSettings } from "@/lib/store";
import { TranscriptChunk } from "@/lib/types";

// ---------- helpers ---------------------------------------------------------

const NOW = 1_700_000_000_000;

const mkChunk = (overrides: Partial<TranscriptChunk> & { text: string }): TranscriptChunk => ({
  id: overrides.id ?? `c-${Math.random().toString(36).slice(2, 8)}`,
  startedAt: overrides.startedAt ?? NOW - 30_000,
  endedAt: overrides.endedAt ?? NOW,
  text: overrides.text,
});

// A realistic 5-min window's worth of text. Jaccard against the same text +
// 3 extra words is >0.9, which is what the dedup gate asserts against.
const seedWindowText = () =>
  Array.from({ length: 50 }, (_, i) => `word${i}`).join(" ");

const primeSettings = (patch: Partial<ReturnType<typeof useSettings.getState>["settings"]> = {}) => {
  useSettings.setState((s) => ({
    settings: { ...s.settings, apiKey: "gsk_test", ...patch },
  }));
};

const resetStores = () => {
  useSession.getState().clear();
  useSession.setState({
    recording: true, // so the auto-refresh loop runs
    loadingSuggestions: false,
    chatStreaming: false,
  });
  useSettings.setState((s) => ({
    settings: {
      ...s.settings,
      apiKey: "",
      autoRefreshSeconds: 30,
      suggestionsContextMinutes: 5,
      minRefreshIntervalMs: 10_000,
      inflightDeferMs: 5_000,
      dedupJaccardThreshold: 0.9,
      transcribeErrorCircuitBreaker: 3,
    },
  }));
};

let sugCounter = 0;
const mockFetchOk = () => {
  const fetchMock = vi.fn(async () => {
    const base = sugCounter++;
    return new Response(
      JSON.stringify({
        suggestions: [
          { id: `s${base}-1`, type: "talking_point", title: "t1", preview: "p1" },
          { id: `s${base}-2`, type: "talking_point", title: "t2", preview: "p2" },
          { id: `s${base}-3`, type: "talking_point", title: "t3", preview: "p3" },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

// Advance fake timers in small steps so React effects and awaited sleeps flush.
const tick = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

// Count only suggestion requests (our tests also trigger renders but don't
// make other network calls).
const suggestCalls = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.filter(([url]) => String(url).includes("/api/suggest")).length;

// ---------- lifecycle -------------------------------------------------------

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  resetStores();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// ---------- baseline regression --------------------------------------------

describe("baseline: auto-refresh path still works", () => {
  it("fires /api/suggest once per countdown tick when chunks advance", async () => {
    primeSettings();
    const fetchMock = mockFetchOk();

    render(<SuggestionsColumn onSuggestionClick={() => {}} />);

    // Seed enough transcript so the window is non-empty.
    act(() => {
      useSession.setState((s) => ({
        chunks: [
          ...s.chunks,
          mkChunk({ id: "c1", text: "the meeting started and we discussed pricing" }),
        ],
      }));
    });

    // Trip the 30s countdown.
    await tick(31_000);

    expect(suggestCalls(fetchMock)).toBe(1);
  });
});

// ---------- E1: dedup-skip -------------------------------------------------

describe("E1 dedup-skip", () => {
  it("skips the auto-refresh when the window is near-identical to the last sent", async () => {
    primeSettings();
    const fetchMock = mockFetchOk();

    render(<SuggestionsColumn onSuggestionClick={() => {}} />);

    // Prime lastSentWindowRef by firing one successful auto-refresh.
    act(() => {
      useSession.setState((s) => ({
        chunks: [
          ...s.chunks,
          mkChunk({ id: "c1", text: seedWindowText() }),
        ],
      }));
    });
    await tick(31_000);
    expect(suggestCalls(fetchMock)).toBe(1);

    // No new chunks -> window identical. Advance past cooldown AND next tick.
    await tick(31_000);

    expect(suggestCalls(fetchMock)).toBe(1); // still 1
    expect(screen.getByText(/no new context/i)).toBeInTheDocument();
  });

  it("fires a fresh refresh when the window has meaningfully changed", async () => {
    primeSettings();
    const fetchMock = mockFetchOk();

    render(<SuggestionsColumn onSuggestionClick={() => {}} />);

    act(() => {
      useSession.setState((s) => ({
        chunks: [
          ...s.chunks,
          mkChunk({ id: "c1", text: seedWindowText() }),
        ],
      }));
    });
    await tick(31_000);
    expect(suggestCalls(fetchMock)).toBe(1);

    // Add a big new chunk that changes the Jaccard below 0.9.
    act(() => {
      useSession.setState((s) => ({
        chunks: [
          ...s.chunks,
          mkChunk({
            id: "c2",
            text: "completely different content about roadmap priorities decisions timelines budgets headcount",
            startedAt: NOW,
            endedAt: NOW + 30_000,
          }),
        ],
      }));
    });

    // Need to pass cooldown (10s) AND next tick.
    await tick(31_000);

    expect(suggestCalls(fetchMock)).toBe(2);
  });
});

// ---------- D1: in-flight defer --------------------------------------------

describe("D1 in-flight defer", () => {
  it("waits for in-flight transcribes before firing, then fires", async () => {
    primeSettings({ inflightDeferMs: 5_000 });
    const fetchMock = mockFetchOk();

    render(<SuggestionsColumn onSuggestionClick={() => {}} />);

    // Seed a stale chunk (15s old) and pretend one transcribe is still in flight.
    act(() => {
      useSession.setState((s) => ({
        chunks: [
          mkChunk({
            id: "c1",
            text: seedWindowText(),
            startedAt: NOW - 45_000,
            endedAt: NOW - 15_000,
          }),
        ],
        inflightTranscribes: 1,
      }));
    });

    // Trip the countdown. The refresh() call will enter the defer loop.
    await tick(31_000);
    expect(suggestCalls(fetchMock)).toBe(0);

    // Resolve the in-flight transcribe partway through the defer window.
    act(() => {
      useSession.setState(() => ({ inflightTranscribes: 0 }));
    });

    // Let the sleep(100) loop poll and fall through.
    await tick(200);

    expect(suggestCalls(fetchMock)).toBe(1);
  });

  it("stops waiting after inflightDeferMs and fires anyway", async () => {
    primeSettings({ inflightDeferMs: 5_000 });
    const fetchMock = mockFetchOk();

    render(<SuggestionsColumn onSuggestionClick={() => {}} />);

    act(() => {
      useSession.setState(() => ({
        chunks: [
          mkChunk({
            id: "c1",
            text: seedWindowText(),
            startedAt: NOW - 45_000,
            endedAt: NOW - 15_000,
          }),
        ],
        inflightTranscribes: 2, // never drops in this test
        recording: true,
      }));
    });

    await tick(31_000);
    expect(suggestCalls(fetchMock)).toBe(0);

    // Advance past the 5s ceiling.
    await tick(5_500);

    expect(suggestCalls(fetchMock)).toBe(1);
  });
});

// ---------- D2: error circuit breaker --------------------------------------

describe("D2 transcribe error circuit breaker", () => {
  it("pauses auto-refresh once streak hits threshold", async () => {
    primeSettings({ transcribeErrorCircuitBreaker: 3 });
    const fetchMock = mockFetchOk();

    render(<SuggestionsColumn onSuggestionClick={() => {}} />);

    act(() => {
      useSession.setState(() => ({
        chunks: [mkChunk({ id: "c1", text: seedWindowText() })],
        transcribeErrorStreak: 3,
        recording: true,
      }));
    });

    await tick(31_000);

    expect(suggestCalls(fetchMock)).toBe(0);
    expect(useSession.getState().autoRefreshPaused).toBe(true);
    expect(screen.getByText(/transcription unavailable/i)).toBeInTheDocument();
  });

  it("manual reload bypasses the breaker", async () => {
    primeSettings({ transcribeErrorCircuitBreaker: 3 });
    const fetchMock = mockFetchOk();

    render(<SuggestionsColumn onSuggestionClick={() => {}} />);

    act(() => {
      useSession.setState(() => ({
        chunks: [mkChunk({ id: "c1", text: seedWindowText() })],
        transcribeErrorStreak: 3,
        autoRefreshPaused: true,
        recording: true,
      }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /reload suggestions/i }));
    });
    // Let the awaited fetch + state updates settle.
    await tick(10);

    expect(suggestCalls(fetchMock)).toBe(1);
    expect(useSession.getState().autoRefreshPaused).toBe(false);
  });

  it("successful transcribe resets the streak via recordTranscribeResult(true)", () => {
    useSession.setState(() => ({
      transcribeErrorStreak: 2,
      autoRefreshPaused: true,
    }));
    useSession.getState().recordTranscribeResult(true);
    expect(useSession.getState().transcribeErrorStreak).toBe(0);
    expect(useSession.getState().autoRefreshPaused).toBe(false);
  });
});

// ---------- B1: question interrupt -----------------------------------------

describe("B1 question-interrupt trigger", () => {
  it("fires an early refresh when a new chunk ends with a question", async () => {
    primeSettings();
    const fetchMock = mockFetchOk();

    render(<SuggestionsColumn onSuggestionClick={() => {}} />);

    // Baseline: no prior refresh, cooldown isn't armed.
    act(() => {
      useSession.setState((s) => ({
        chunks: [
          ...s.chunks,
          mkChunk({
            id: "q1",
            text: seedWindowText() + " so how should we price this?",
          }),
        ],
      }));
    });

    // The interrupt effect runs inside React's update cycle; let awaited fetch settle.
    await tick(10);

    expect(suggestCalls(fetchMock)).toBe(1);
  });

  it("does not double-fire for the same chunk on re-render", async () => {
    primeSettings();
    const fetchMock = mockFetchOk();

    const { rerender } = render(<SuggestionsColumn onSuggestionClick={() => {}} />);

    act(() => {
      useSession.setState((s) => ({
        chunks: [
          ...s.chunks,
          mkChunk({ id: "q1", text: seedWindowText() + " what do you think?" }),
        ],
      }));
    });
    await tick(10);
    expect(suggestCalls(fetchMock)).toBe(1);

    // Force a re-render without changing chunks.
    rerender(<SuggestionsColumn onSuggestionClick={() => {}} />);
    await tick(10);
    expect(suggestCalls(fetchMock)).toBe(1);
  });

  it("cooldown blocks interrupt when last refresh was recent", async () => {
    primeSettings({ minRefreshIntervalMs: 10_000 });
    const fetchMock = mockFetchOk();

    render(<SuggestionsColumn onSuggestionClick={() => {}} />);

    // Prime a recent refresh.
    act(() => {
      useSession.setState((s) => ({
        chunks: [
          ...s.chunks,
          mkChunk({ id: "c1", text: seedWindowText() }),
        ],
      }));
    });
    await tick(31_000);
    expect(suggestCalls(fetchMock)).toBe(1);

    // Only 3s later, a question chunk arrives — cooldown should block.
    await tick(3_000);
    act(() => {
      useSession.setState((s) => ({
        chunks: [
          ...s.chunks,
          mkChunk({
            id: "q1",
            text: "wait, " + seedWindowText() + " can we pause here?",
            startedAt: NOW + 3_000,
            endedAt: NOW + 3_000,
          }),
        ],
      }));
    });
    await tick(10);

    expect(suggestCalls(fetchMock)).toBe(1); // still just the baseline call
  });
});

// ---------- guard interactions ---------------------------------------------

describe("guards", () => {
  it("loadingSuggestions short-circuits every trigger", async () => {
    primeSettings();
    const fetchMock = mockFetchOk();

    render(<SuggestionsColumn onSuggestionClick={() => {}} />);

    act(() => {
      useSession.setState(() => ({
        chunks: [mkChunk({ id: "c1", text: seedWindowText() + " what next?" })],
        loadingSuggestions: true,
        recording: true,
      }));
    });

    // Auto tick
    await tick(31_000);
    // Manual click — button is disabled while loading, but force-fire to
    // prove the in-function guard would block even if the UI didn't.
    const btn = screen.getByRole("button", { name: /reload suggestions/i });
    await act(async () => {
      fireEvent.click(btn);
    });
    await tick(10);

    expect(suggestCalls(fetchMock)).toBe(0);
  });

  it("manual reload ignores dedup and cooldown gates", async () => {
    primeSettings();
    const fetchMock = mockFetchOk();

    render(<SuggestionsColumn onSuggestionClick={() => {}} />);

    // Prime a successful refresh so dedup + cooldown would both apply.
    act(() => {
      useSession.setState(() => ({
        chunks: [mkChunk({ id: "c1", text: seedWindowText() })],
        recording: true,
      }));
    });
    await tick(31_000);
    expect(suggestCalls(fetchMock)).toBe(1);

    // Click Reload immediately — cooldown would block auto, but manual wins.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /reload suggestions/i }));
    });
    await tick(10);

    expect(suggestCalls(fetchMock)).toBe(2);
  });
});
