# Future Work

Triage of the product-alignment ideas in `PRODUCT_ALIGNMENT.md` against the
assignment rubric in `assignment.md`. Each item is tagged with:

- **PA ref** — section in `PRODUCT_ALIGNMENT.md`
- **Rubric** — which evaluation criterion it targets (1=suggestion quality,
  2=chat quality, 3=prompt eng, 4=full-stack, 5=code, 6=latency, 7=UX)
- **Effort** — rough estimate

Execution plan for the **In** set lives in `LIVE_SUGGESTIONS_UPGRADE_PLAN.md`.

---

## In — will do next

Small, high-leverage, prompt- or signal-level. Zero new endpoints / stores /
deps. Each shippable independently.

1. **Prompt lifts + intent-reframe.** Reframe `DEFAULT_SUGGESTIONS_PROMPT` as
   explicit intent-prediction ("what does the user need to know *right now*"),
   plus the 4 phrases in `PRODUCT_ALIGNMENT.md §6`.
   · PA §4-A1, §6 · Rubric 1, 3 · ~30 min
2. **B2/B4 interrupt triggers.** Extend the existing B1 `endsWithQuestion`
   path to also fire on decision phrases ("let's go with…", "we'll ship…")
   and named-entity/number claims. Reuses cooldown gate.
   · PA §4-A4 · Rubric 1, 7 · ~1–2 h + tests
3. **Rolling summary (B5).** Activate the already-wired `meetingSummary`
   param in `src/app/api/suggest/route.ts:13,39`. Keep the live window tight
   while preserving earlier decisions.
   · PA §4-A3 · Rubric 1, 3 · ~2–3 h
4. **Meeting-kind presets.** Settings dropdown (lecture / 1:1 / pitch /
   standup / interview) that appends a kind-specific hint to the suggestions
   prompt. Directly addresses the rubric's "different types of meetings".
   · PA §4-B6 · Rubric 1, 3 · ~1 h

**Total:** ~half a day to a day. All reversible.

---

## Maybe — if time permits

Worth it for the live interview demo, but not strictly on the rubric.

- **Action-items button** under the chat input. Fixed prompt over full
  transcript. Closes a demo loop that matches the founder's #1 personal use
  case.
  · PA §4-A2 · Rubric 2, 7 · ~1 h
- **Speaker/listener toggle (C3).** One-bit context hint that shifts the
  suggestion mix between `answer` vs `fact_check`/`clarify`.
  · PA §4-B7 · Rubric 1 · ~30 min

---

## Out — explicitly declined

Not worth the surface area vs. the assignment's "do not over-engineer"
note (`assignment.md §Notes`).

- **Web-search tool in chat.** Adds a new dependency + server-side tool
  loop. High effort, weak rubric lift. · PA §4-C9
- **Memorable-moments extractor.** Nice product touch; doesn't move the
  rubric. · PA §4-C10
- **Shareable print view.** Export JSON already satisfies the spec.
  · PA §4-C11
- **Paste-in session-context textarea.** Competes with the rolling summary
  for the same prompt budget; rolling summary wins. · PA §4-B5
- **Post-session deliverables panel (4 buttons).** Only the single
  action-items button in Maybe earns its keep; four buttons read as UI
  sprawl during the live interview demo. · PA §4-B8
- **Persistent memory / integrations / Chrome extension / on-device STT.**
  Out-of-scope for the assignment by design. · PA §3

---

## Architectural note

None of the In/Maybe items require structural changes. They fit inside the
boundaries documented in `ARCHITECTURE.md §9` and `SYSTEM_DESIGN.md §6`:

- Prompts: single file (`src/lib/prompts.ts`).
- Signals: single pure module (`src/lib/signals.ts`) with its own tests.
- Rolling summary: uses the existing `meetingSummary` wire in the suggest
  request — protocol was designed for it.
- Presets: one `Settings` field + dispatch in `prompts.ts`.

**No new API routes. No new stores. No new dependencies.**
