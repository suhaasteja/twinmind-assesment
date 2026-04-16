import { NextRequest } from "next/server";
import { getKey, groqChat } from "@/lib/groq";

export const runtime = "nodejs";
export const maxDuration = 60;

interface Body {
  systemPrompt: string;       // either chatPrompt or detailedAnswerPrompt
  transcript: string;         // full or windowed transcript
  history: { role: "user" | "assistant"; content: string }[];
  userMessage: string;        // the new user turn (or seeded suggestion)
  model: string;
}

export async function POST(req: NextRequest) {
  const apiKey = getKey(req);
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "Missing Groq API key" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const body = (await req.json()) as Body;
  const { systemPrompt, transcript, history, userMessage, model } = body;

  const system = `${systemPrompt}

LIVE MEETING TRANSCRIPT (most recent last):
${transcript || "(no transcript yet)"}`;

  const res = await groqChat(apiKey, {
    model,
    temperature: 0.5,
    max_tokens: 900,
    stream: true,
    messages: [
      { role: "system", content: system },
      ...history,
      { role: "user", content: userMessage },
    ],
  });

  if (!res.ok || !res.body) {
    const text = await res.text();
    return new Response(
      JSON.stringify({ error: `Groq chat failed: ${res.status} ${text}` }),
      { status: res.status, headers: { "Content-Type": "application/json" } }
    );
  }

  // Parse upstream SSE, forward only the text deltas as a plain text stream.
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = res.body!.getReader();
      let buffer = "";
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const payload = trimmed.slice(5).trim();
            if (payload === "[DONE]") {
              controller.close();
              return;
            }
            try {
              const json = JSON.parse(payload);
              const delta: string | undefined =
                json.choices?.[0]?.delta?.content;
              if (delta) controller.enqueue(encoder.encode(delta));
            } catch {
              // ignore malformed chunks
            }
          }
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
