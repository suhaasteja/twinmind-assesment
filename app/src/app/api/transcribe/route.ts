import { NextRequest, NextResponse } from "next/server";
import { getKey, groqTranscribe } from "@/lib/groq";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const apiKey = getKey(req);
  if (!apiKey) {
    return NextResponse.json({ error: "Missing Groq API key" }, { status: 401 });
  }

  const form = await req.formData();
  const file = form.get("file");
  const model = (form.get("model") as string) || "whisper-large-v3";

  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "Missing audio file" }, { status: 400 });
  }

  // Very short clips are likely just silence — skip to save calls.
  if (file.size < 2000) {
    return NextResponse.json({ text: "" });
  }

  const res = await groqTranscribe(apiKey, file, "chunk.webm", model);
  if (!res.ok) {
    const text = await res.text();
    return NextResponse.json(
      { error: `Groq transcription failed: ${res.status} ${text}` },
      { status: res.status }
    );
  }
  const data = (await res.json()) as { text?: string };
  return NextResponse.json({ text: (data.text ?? "").trim() });
}
