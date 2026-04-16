import { ChatMessage, SuggestionBatch, TranscriptChunk } from "./types";

export function buildExport(args: {
  sessionStartedAt: number;
  chunks: TranscriptChunk[];
  batches: SuggestionBatch[];
  chat: ChatMessage[];
}) {
  const { sessionStartedAt, chunks, batches, chat } = args;
  return {
    session: {
      startedAt: new Date(sessionStartedAt).toISOString(),
      exportedAt: new Date().toISOString(),
    },
    transcript: chunks.map((c) => ({
      startedAt: new Date(c.startedAt).toISOString(),
      endedAt: new Date(c.endedAt).toISOString(),
      text: c.text,
    })),
    suggestionBatches: batches
      .slice()
      .reverse()
      .map((b) => ({
        createdAt: new Date(b.createdAt).toISOString(),
        suggestions: b.suggestions.map((s) => ({
          type: s.type,
          title: s.title,
          preview: s.preview,
        })),
      })),
    chat: chat.map((m) => ({
      createdAt: new Date(m.createdAt).toISOString(),
      role: m.role,
      content: m.content,
      fromSuggestion: m.fromSuggestion,
    })),
  };
}

export function downloadJSON(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
