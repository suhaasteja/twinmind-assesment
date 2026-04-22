import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getKey, groqChat } from "@/lib/groq";
import { Suggestion, SuggestionType } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

interface Body {
  transcript: string;                 // recent window, timestamped lines
  previousTitles: string[];           // to avoid repeats
  prompt: string;                     // system prompt from settings
  model: string;
  meetingSummary?: string;            // rolling summary of older context
}

const VALID_TYPES: SuggestionType[] = [
  "question",
  "talking_point",
  "answer",
  "fact_check",
  "clarify",
];

// ---------------------------------------------------------------------------
// Zod schema — the TS equivalent of a Pydantic model. One source of truth
// for both the Groq `json_schema` response_format (server-enforced by the
// model) and the second-line validator we run after parse.
// ---------------------------------------------------------------------------
const SuggestionSchema = z.object({
  type: z.enum(["question", "talking_point", "answer", "fact_check", "clarify"]),
  title: z.string().min(1).max(140),
  preview: z.string().min(1).max(500),
  needsWebSearch: z.boolean().optional(),
});

const SuggestionsPayloadSchema = z.object({
  suggestions: z.array(SuggestionSchema).length(3),
});

type ValidSuggestion = z.infer<typeof SuggestionSchema>;

// JSON-Schema flavor of the same schema, with the keys Groq's strict mode
// requires: `additionalProperties: false` and every declared property in
// `required`. Kept hand-written (vs. zod-to-json-schema) to avoid a dep.
const JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["suggestions"],
  properties: {
    suggestions: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "title", "preview", "needsWebSearch"],
        properties: {
          type: { type: "string", enum: VALID_TYPES },
          title: { type: "string", maxLength: 140 },
          preview: { type: "string", maxLength: 500 },
          needsWebSearch: { type: "boolean" },
        },
      },
    },
  },
} as const;

// ---------------------------------------------------------------------------
// Calls Groq once. Returns the raw content string or an upstream-error tuple.
// ---------------------------------------------------------------------------
async function callGroq(
  apiKey: string,
  model: string,
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  useJsonSchema: boolean
): Promise<
  | { ok: true; content: string }
  | { ok: false; status: number; text: string; schemaUnsupported: boolean }
> {
  const res = await groqChat(apiKey, {
    model,
    temperature: 0.4,
    // Groq's strict json_schema mode requires the full valid document to
    // fit inside max_tokens — if the model runs out mid-JSON it returns
    // `json_validate_failed` with "max completion tokens reached before
    // generating a valid document". Worst case here is 3 items × (title
    // ≤140 + preview ≤500) ≈ ~900 tokens once you include structure and
    // escapes, so 1200 gives comfortable headroom.
    max_tokens: 1200,
    response_format: useJsonSchema
      ? {
          type: "json_schema",
          json_schema: {
            name: "suggestions",
            strict: true,
            schema: JSON_SCHEMA,
          },
        }
      : { type: "json_object" },
    messages,
  });
  if (!res.ok) {
    const text = await res.text();
    // Heuristic: if Groq refuses json_schema for this model, its 400 will
    // mention response_format. Used to trigger a one-shot fallback below.
    const schemaUnsupported =
      res.status === 400 &&
      useJsonSchema &&
      /response_format|json_schema/i.test(text);
    return { ok: false, status: res.status, text, schemaUnsupported };
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return { ok: true, content: data.choices?.[0]?.message?.content ?? "{}" };
}

// ---------------------------------------------------------------------------
// Tries to pull a Zod-valid payload out of a raw model string. On JSON-parse
// or schema failure returns the error message so the caller can decide
// whether to retry.
// ---------------------------------------------------------------------------
function tryParse(
  raw: string
):
  | { ok: true; value: z.infer<typeof SuggestionsPayloadSchema> }
  | { ok: false; reason: string } {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    return { ok: false, reason: `JSON parse error: ${(e as Error).message}` };
  }
  const parsed = SuggestionsPayloadSchema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      reason: `Schema validation failed: ${parsed.error.issues
        .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
        .join("; ")}`,
    };
  }
  return { ok: true, value: parsed.data };
}

export async function POST(req: NextRequest) {
  const apiKey = getKey(req);
  if (!apiKey) {
    return NextResponse.json({ error: "Missing Groq API key" }, { status: 401 });
  }

  const body = (await req.json()) as Body;
  const { transcript, previousTitles, prompt, model, meetingSummary } = body;

  if (!transcript || transcript.trim().length < 20) {
    // Not enough signal yet — return nothing so UI can show a graceful empty state.
    return NextResponse.json({ suggestions: [] });
  }

  const userContent = [
    meetingSummary
      ? `MEETING SO FAR (background context for entity/continuity recall ONLY — use this to remember names, numbers, and decisions from earlier, but do NOT anchor new suggestions here; anchor on the MOST RECENT transcript line below):\n${meetingSummary}`
      : null,
    `RECENT TRANSCRIPT (chronological, oldest first; timestamps are YYYY-MM-DD HH:MM:SS local 24hr):\n${transcript}`,
    `IMPORTANT — RECENCY ANCHOR: Your 3 suggestions MUST address the topic being discussed at the MOST RECENT line (marked "← MOST RECENT"). Earlier transcript lines are context only. If the topic has shifted, prior topics are history — do NOT surface suggestions about them unless the speakers are explicitly revisiting those topics right now.`,
    previousTitles.length
      ? `RECENT PREVIOUS BATCH TITLES (do not repeat these):\n- ${previousTitles.join("\n- ")}`
      : null,
    `Return exactly 3 suggestions as JSON per the schema in the system prompt.`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const baseMessages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }> = [
    { role: "system", content: prompt },
    { role: "user", content: userContent },
  ];

  // ---- Attempt 1: strict `json_schema` ------------------------------------
  let attempt = await callGroq(apiKey, model, baseMessages, true);

  // If the model rejects json_schema, retry once with json_object.
  if (!attempt.ok && attempt.schemaUnsupported) {
    attempt = await callGroq(apiKey, model, baseMessages, false);
  }

  if (!attempt.ok) {
    return NextResponse.json(
      { error: `Groq suggest failed: ${attempt.status} ${attempt.text}` },
      { status: attempt.status }
    );
  }

  let raw = attempt.content;
  let parsed = tryParse(raw);

  // ---- Attempt 2: feedback retry on Zod failure ---------------------------
  // Hands the model its own malformed output plus the exact validation error
  // and asks it to correct itself. Cheap, usually succeeds, and kept single-
  // shot so we never loop.
  if (!parsed.ok) {
    const retry = await callGroq(
      apiKey,
      model,
      [
        ...baseMessages,
        { role: "assistant", content: raw },
        {
          role: "user",
          content: `Your previous response failed validation: ${parsed.reason}. Reply with ONLY corrected JSON matching the schema — no prose, no markdown, exactly 3 suggestions.`,
        },
      ],
      false // json_object mode for the retry to maximize compatibility
    );
    if (retry.ok) {
      raw = retry.content;
      parsed = tryParse(raw);
    }
  }

  // ---- Fallback: permissive salvage ---------------------------------------
  // Last-ditch attempt so the UI never gets a 502 on a near-miss. Trims to
  // the first 3 well-formed items and coerces unknown types to talking_point.
  const cleaned: Suggestion[] = parsed.ok
    ? parsed.value.suggestions.map((s, i) => finalize(s, i))
    : salvage(raw);

  if (cleaned.length !== 3) {
    return NextResponse.json(
      { error: "Model returned an unparseable payload", raw },
      { status: 502 }
    );
  }

  return NextResponse.json({ suggestions: cleaned });
}

// Schema-validated row → Suggestion. Applies the web-search flag policy:
//   - fact_check / clarify → always flagged (force-on).
//   - answer               → honor the model's boolean.
//   - question / talking_point → always false.
function finalize(s: ValidSuggestion, i: number): Suggestion {
  let flagged = false;
  if (s.type === "fact_check" || s.type === "clarify") flagged = true;
  else if (s.type === "answer") flagged = s.needsWebSearch === true;
  return {
    id: `${Date.now().toString(36)}-${i}`,
    type: s.type,
    title: s.title.slice(0, 140),
    preview: s.preview.slice(0, 500),
    needsWebSearch: flagged || undefined,
  };
}

// Permissive fallback for the case where both the strict call and the
// feedback retry failed Zod. Mirrors the pre-Zod behavior so we still return
// *something* usable rather than erroring out the UI.
function salvage(raw: string): Suggestion[] {
  let parsed: { suggestions?: Array<Partial<Suggestion>> } = {};
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  return (parsed.suggestions ?? [])
    .filter((s) => s && s.title && s.preview && s.type)
    .slice(0, 3)
    .map((s, i) => {
      const type = VALID_TYPES.includes(s.type as SuggestionType)
        ? (s.type as SuggestionType)
        : "talking_point";
      const rawFlag = (s as { needsWebSearch?: unknown }).needsWebSearch;
      const modelFlagged = rawFlag === true || rawFlag === "true";
      return finalize(
        {
          type,
          title: String(s.title),
          preview: String(s.preview),
          needsWebSearch: modelFlagged,
        },
        i
      );
    });
}
