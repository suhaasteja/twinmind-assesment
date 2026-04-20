import { NextRequest, NextResponse } from "next/server";
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
    meetingSummary ? `MEETING SO FAR (summary):\n${meetingSummary}` : null,
    `RECENT TRANSCRIPT (most recent last):\n${transcript}`,
    previousTitles.length
      ? `RECENT PREVIOUS BATCH TITLES (do not repeat these):\n- ${previousTitles.join("\n- ")}`
      : null,
    `Return exactly 3 suggestions as JSON per the schema in the system prompt.`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const res = await groqChat(apiKey, {
    model,
    temperature: 0.4,
    max_tokens: 700,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: prompt },
      { role: "user", content: userContent },
    ],
  });

  if (!res.ok) {
    const text = await res.text();
    return NextResponse.json(
      { error: `Groq suggest failed: ${res.status} ${text}` },
      { status: res.status }
    );
  }

  const data = (await res.json()) as {
    choices: { message: { content: string } }[];
  };
  const raw = data.choices?.[0]?.message?.content ?? "{}";

  let parsed: { suggestions?: Array<Partial<Suggestion>> } = {};
  try {
    parsed = JSON.parse(raw);
  } catch {
    return NextResponse.json(
      { error: "Model returned invalid JSON", raw },
      { status: 502 }
    );
  }

  const cleaned: Suggestion[] = (parsed.suggestions ?? [])
    .filter((s) => s && s.title && s.preview && s.type)
    .slice(0, 3)
    .map((s, i) => {
      const type = VALID_TYPES.includes(s.type as SuggestionType)
        ? (s.type as SuggestionType)
        : "talking_point";
      // Web-search flag policy (mirrors the prompt):
      //   - fact_check  → default true (force-on even if the model forgot).
      //   - clarify     → default true (force-on even if the model forgot).
      //   - answer      → honor the model's choice; true only if it set it.
      //   - question / talking_point → always false, strip if the model set it.
      const rawFlag = (s as { needsWebSearch?: unknown }).needsWebSearch;
      const modelFlagged = rawFlag === true || rawFlag === "true";
      let flagged = false;
      if (type === "fact_check" || type === "clarify") flagged = true;
      else if (type === "answer") flagged = modelFlagged;
      return {
        id: `${Date.now().toString(36)}-${i}`,
        type,
        title: String(s.title).slice(0, 140),
        preview: String(s.preview).slice(0, 500),
        needsWebSearch: flagged || undefined,
      };
    });

  return NextResponse.json({ suggestions: cleaned });
}
