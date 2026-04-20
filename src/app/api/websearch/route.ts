import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

// Thin proxy to Tavily's /search. We keep the API key server-side by
// preferring the x-tavily-key header the user pastes in Settings (same
// pattern as Groq), and falling back to process.env.TAVILY_API_KEY so the
// feature is usable out-of-the-box when an env var is set.
//
// If no key is configured anywhere, we return an empty result with an
// `error` field rather than 500 — the caller in ChatColumn is expected to
// pass that back to the model, which will answer without grounding and
// flag the miss per the detailed-answer prompt rule.

interface Body {
  query: string;
}

interface TavilyResult {
  title?: string;
  url?: string;
  content?: string;
}

interface TavilyResponse {
  answer?: string;
  results?: TavilyResult[];
}

function getKey(req: NextRequest): string | undefined {
  return (
    req.headers.get("x-tavily-key") ||
    process.env.TAVILY_API_KEY ||
    undefined
  );
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as Body;
  const query = (body.query ?? "").toString().trim();
  if (!query) {
    return NextResponse.json(
      { query: "", results: [], error: "empty query" },
      { status: 400 }
    );
  }

  const key = getKey(req);
  if (!key) {
    // Soft-fail: caller degrades gracefully to ungrounded answer.
    return NextResponse.json({
      query,
      results: [],
      error: "no Tavily key configured (set Settings → Tavily key, or TAVILY_API_KEY env)",
    });
  }

  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: key,
        query,
        max_results: 5,
        include_answer: true,
        search_depth: "basic",
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        { query, results: [], error: `Tavily ${res.status}: ${text.slice(0, 300)}` },
        { status: 200 } // don't propagate upstream status — caller treats this as "no results"
      );
    }
    const data = (await res.json()) as TavilyResponse;
    const results = (data.results ?? [])
      .filter((r) => r.title && r.url)
      .slice(0, 5)
      .map((r) => ({
        title: String(r.title ?? ""),
        url: String(r.url ?? ""),
        content: String(r.content ?? "").slice(0, 800),
      }));
    return NextResponse.json({
      query,
      answer: data.answer,
      results,
    });
  } catch (e) {
    return NextResponse.json({
      query,
      results: [],
      error: e instanceof Error ? e.message : "network error",
    });
  }
}
