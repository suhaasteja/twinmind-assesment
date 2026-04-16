// Server-side helpers for calling Groq. The API key arrives per-request from
// the client via the `x-groq-key` header (stored only in localStorage on the
// client). Never read from env — the spec requires users to paste their own key.

const GROQ_BASE = "https://api.groq.com/openai/v1";

export function getKey(req: Request): string | null {
  const h = req.headers.get("x-groq-key");
  return h && h.trim().length > 0 ? h.trim() : null;
}

export async function groqChat(
  apiKey: string,
  body: Record<string, unknown>,
  signal?: AbortSignal
): Promise<Response> {
  return fetch(`${GROQ_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal,
  });
}

export async function groqTranscribe(
  apiKey: string,
  file: File | Blob,
  filename: string,
  model: string
): Promise<Response> {
  const fd = new FormData();
  fd.append("file", file, filename);
  fd.append("model", model);
  fd.append("response_format", "json");
  fd.append("temperature", "0");
  return fetch(`${GROQ_BASE}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: fd,
  });
}
