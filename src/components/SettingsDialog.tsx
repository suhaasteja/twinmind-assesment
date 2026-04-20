"use client";

import { useEffect, useState } from "react";
import { X, RotateCcw } from "lucide-react";
import { useSettings } from "@/lib/store";
import { MEETING_KIND_LABELS } from "@/lib/prompts";
import { MeetingKind, Settings } from "@/lib/types";
import { Button } from "./ui";

export function SettingsDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const settings = useSettings((s) => s.settings);
  const setSettings = useSettings((s) => s.setSettings);
  const resetPrompts = useSettings((s) => s.resetPrompts);

  const [draft, setDraft] = useState<Settings>(settings);

  useEffect(() => {
    if (open) setDraft(settings);
  }, [open, settings]);

  if (!open) return null;

  const save = () => {
    setSettings(draft);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div
        className="flex h-[90vh] w-full max-w-3xl flex-col rounded-xl border bg-[var(--panel)] shadow-2xl"
        style={{ borderColor: "var(--border-strong)" }}
      >
        <div
          className="flex items-center justify-between border-b px-5 py-3"
          style={{ borderColor: "var(--border)" }}
        >
          <div className="text-[14px] font-semibold">Settings</div>
          <button
            onClick={onClose}
            className="rounded p-1 text-[var(--muted)] hover:bg-white/5 hover:text-white"
          >
            <X size={16} />
          </button>
        </div>

        <div className="scrollbar min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-4">
          <Field
            label="Groq API Key"
            hint="Stored only in your browser's localStorage. Get one from console.groq.com."
          >
            <input
              type="password"
              value={draft.apiKey}
              onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
              placeholder="gsk_..."
              className={inputCls}
            />
          </Field>

          <Field
            label="Meeting kind"
            hint="Tunes the suggestion type mix and tone to the situation. Takes effect on the next refresh."
          >
            <select
              value={draft.meetingKind}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  meetingKind: e.target.value as MeetingKind,
                })
              }
              className={inputCls}
            >
              {(Object.keys(MEETING_KIND_LABELS) as MeetingKind[]).map((k) => (
                <option key={k} value={k}>
                  {MEETING_KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="STT model">
              <input
                value={draft.sttModel}
                onChange={(e) => setDraft({ ...draft, sttModel: e.target.value })}
                className={inputCls}
              />
            </Field>
            <Field label="LLM model">
              <input
                value={draft.llmModel}
                onChange={(e) => setDraft({ ...draft, llmModel: e.target.value })}
                className={inputCls}
              />
            </Field>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <Field label="Chunk seconds" hint="Audio slice length">
              <input
                type="number"
                min={10}
                max={60}
                value={draft.chunkSeconds}
                onChange={(e) =>
                  setDraft({ ...draft, chunkSeconds: Number(e.target.value) })
                }
                className={inputCls}
              />
            </Field>
            <Field label="Auto-refresh sec" hint="Suggestions interval">
              <input
                type="number"
                min={10}
                max={120}
                value={draft.autoRefreshSeconds}
                onChange={(e) =>
                  setDraft({ ...draft, autoRefreshSeconds: Number(e.target.value) })
                }
                className={inputCls}
              />
            </Field>
            <Field
              label="Suggestions context (min)"
              hint="Recent transcript window for live suggestions"
            >
              <input
                type="number"
                min={1}
                max={30}
                value={draft.suggestionsContextMinutes}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    suggestionsContextMinutes: Number(e.target.value),
                  })
                }
                className={inputCls}
              />
            </Field>
          </div>

          <Field
            label="Detailed-answer context (min)"
            hint="Window sent when expanding a suggestion. 0 = full transcript."
          >
            <input
              type="number"
              min={0}
              max={120}
              value={draft.detailedContextMinutes}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  detailedContextMinutes: Number(e.target.value),
                })
              }
              className={inputCls}
            />
          </Field>

          <div>
            <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-[var(--muted)]">
              Adaptive cadence
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field
                label="Min refresh interval (ms)"
                hint="Cooldown between auto/interrupt /api/suggest calls. Manual reload bypasses."
              >
                <input
                  type="number"
                  min={0}
                  max={60_000}
                  step={1000}
                  value={draft.minRefreshIntervalMs}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      minRefreshIntervalMs: Number(e.target.value),
                    })
                  }
                  className={inputCls}
                />
              </Field>
              <Field
                label="In-flight defer (ms)"
                hint="Max wait for a running transcribe before firing anyway."
              >
                <input
                  type="number"
                  min={0}
                  max={30_000}
                  step={500}
                  value={draft.inflightDeferMs}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      inflightDeferMs: Number(e.target.value),
                    })
                  }
                  className={inputCls}
                />
              </Field>
              <Field
                label="Dedup similarity threshold"
                hint="Skip refresh when window Jaccard similarity exceeds this (0–1)."
              >
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={draft.dedupJaccardThreshold}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      dedupJaccardThreshold: Number(e.target.value),
                    })
                  }
                  className={inputCls}
                />
              </Field>
              <Field
                label="Transcribe error circuit breaker"
                hint="Consecutive transcribe errors that pause auto-refresh (0 = disabled)."
              >
                <input
                  type="number"
                  min={0}
                  max={20}
                  value={draft.transcribeErrorCircuitBreaker}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      transcribeErrorCircuitBreaker: Number(e.target.value),
                    })
                  }
                  className={inputCls}
                />
              </Field>
            </div>
          </div>

          <Field label="Live suggestions prompt">
            <textarea
              rows={10}
              value={draft.suggestionsPrompt}
              onChange={(e) =>
                setDraft({ ...draft, suggestionsPrompt: e.target.value })
              }
              className={textareaCls}
            />
          </Field>

          <Field label="Detailed answer (on click) prompt">
            <textarea
              rows={8}
              value={draft.detailedAnswerPrompt}
              onChange={(e) =>
                setDraft({ ...draft, detailedAnswerPrompt: e.target.value })
              }
              className={textareaCls}
            />
          </Field>

          <Field label="Chat prompt (typed questions)">
            <textarea
              rows={6}
              value={draft.chatPrompt}
              onChange={(e) =>
                setDraft({ ...draft, chatPrompt: e.target.value })
              }
              className={textareaCls}
            />
          </Field>
        </div>

        <div
          className="flex items-center justify-between border-t px-5 py-3"
          style={{ borderColor: "var(--border)" }}
        >
          <Button
            variant="ghost"
            onClick={() => {
              resetPrompts();
              setDraft((d) => ({
                ...d,
                suggestionsPrompt: useSettings.getState().settings.suggestionsPrompt,
                detailedAnswerPrompt:
                  useSettings.getState().settings.detailedAnswerPrompt,
                chatPrompt: useSettings.getState().settings.chatPrompt,
              }));
            }}
          >
            <RotateCcw size={14} /> Reset prompts
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" onClick={save}>
              Save
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

const inputCls =
  "w-full rounded-md border bg-[var(--panel-2)] px-3 py-2 text-[13px] outline-none focus:border-[var(--border-strong)]";
const textareaCls =
  "w-full rounded-md border bg-[var(--panel-2)] px-3 py-2 font-mono text-[12px] leading-relaxed outline-none focus:border-[var(--border-strong)]";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-[12px] font-medium text-[var(--fg)]">
        {label}
      </label>
      {hint && (
        <div className="mb-1.5 text-[11px] text-[var(--muted-2)]">{hint}</div>
      )}
      {children}
    </div>
  );
}
