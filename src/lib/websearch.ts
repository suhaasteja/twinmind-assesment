// Client wrapper for the internal /api/websearch route.
//
// Kept deliberately isolated from the rest of the app so the web-search
// feature can be removed cleanly by deleting this file + src/app/api/websearch
// + WebSearchChip.tsx and dropping the one branch in ChatColumn.tsx.

export interface WebSearchResult {
  title: string;
  url: string;
  content: string;  // snippet / summary from the provider
}

export interface WebSearchResponse {
  query: string;
  answer?: string;   // provider-generated tl;dr (Tavily gives this)
  results: WebSearchResult[];
  error?: string;
}

/** POSTs to the in-app search proxy. Caller forwards the user's Tavily key. */
export async function runWebSearch(
  query: string,
  tavilyKey: string | undefined
): Promise<WebSearchResponse> {
  try {
    const res = await fetch("/api/websearch", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(tavilyKey ? { "x-tavily-key": tavilyKey } : {}),
      },
      body: JSON.stringify({ query }),
    });
    if (!res.ok) {
      const text = await res.text();
      return { query, results: [], error: `websearch ${res.status}: ${text}` };
    }
    return (await res.json()) as WebSearchResponse;
  } catch (e) {
    return {
      query,
      results: [],
      error: e instanceof Error ? e.message : "websearch error",
    };
  }
}

/**
 * Format a search response as a block injectable into the detailed-answer
 * system prompt. The header string "WEB SEARCH RESULTS:" matches the rule
 * added to DEFAULT_DETAILED_ANSWER_PROMPT so the model grounds on it.
 */
export function formatSearchForPrompt(r: WebSearchResponse): string {
  if (r.error || r.results.length === 0) {
    return `WEB SEARCH RESULTS for "${r.query}":\n(no results${r.error ? ` — ${r.error}` : ""})`;
  }
  const body = r.results
    .slice(0, 5)
    .map((x, i) => `[${i + 1}] ${x.title}\n${x.url}\n${x.content}`)
    .join("\n\n");
  const head = r.answer ? `Provider summary: ${r.answer}\n\n` : "";
  return `WEB SEARCH RESULTS for "${r.query}":\n${head}${body}`;
}
