improvements:
- [x] add Zod (TS equivalent of Pydantic) for structured LLM output — `/api/suggest` now uses Groq `json_schema` strict mode + Zod validate, with a feedback retry and permissive salvage so JSON parse errors don't surface to the UI.
- [ ] improve cold start time

- [x] parse chat UI into markdown — assistant messages now render through `react-markdown` + `remark-gfm` (lists, tables, task-list checkboxes, code fences, links). User bubbles stay plain text.