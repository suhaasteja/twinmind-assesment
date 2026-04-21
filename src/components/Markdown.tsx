"use client";

import ReactMarkdown, { Components } from "react-markdown";
import remarkGfm from "remark-gfm";

// Dark-theme markdown renderer for chat messages. Tailwind-classed
// components keep the output on-brand (compact spacing, muted rules,
// accent-coloured links) while `remark-gfm` adds tables, strikethrough,
// autolinks, and task-list checkboxes — the four GFM extensions the model
// actually emits in practice.
//
// Rendering is safe: react-markdown does NOT execute HTML by default and we
// don't pass `rehype-raw`, so any `<script>` in the stream is ignored.

const components: Components = {
  p: ({ children }) => <p className="my-1.5 first:mt-0 last:mb-0">{children}</p>,
  h1: ({ children }) => (
    <h1 className="mb-1 mt-3 text-[15px] font-semibold">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-1 mt-3 text-[14px] font-semibold">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-1 mt-2 text-[13px] font-semibold">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="mb-1 mt-2 text-[13px] font-semibold">{children}</h4>
  ),
  ul: ({ children }) => (
    <ul className="my-1.5 list-disc space-y-0.5 pl-5">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="my-1.5 list-decimal space-y-0.5 pl-5">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-[#7dd3fc] underline-offset-2 hover:underline"
    >
      {children}
    </a>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold text-[var(--fg)]">{children}</strong>
  ),
  em: ({ children }) => <em className="italic">{children}</em>,
  blockquote: ({ children }) => (
    <blockquote
      className="my-2 border-l-2 pl-3 text-[var(--muted)]"
      style={{ borderColor: "var(--border-strong)" }}
    >
      {children}
    </blockquote>
  ),
  code: ({ children, className }) => {
    // Inline code: no language class from remark. Block code gets one.
    const isBlock = typeof className === "string" && className.startsWith("language-");
    if (isBlock) {
      return (
        <code className="block whitespace-pre-wrap break-words font-mono text-[12.5px]">
          {children}
        </code>
      );
    }
    return (
      <code
        className="rounded border px-1 py-0.5 font-mono text-[12.5px]"
        style={{
          borderColor: "var(--border)",
          background: "var(--panel-2)",
        }}
      >
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre
      className="my-2 overflow-x-auto rounded-md border p-2"
      style={{ borderColor: "var(--border)", background: "var(--panel-2)" }}
    >
      {children}
    </pre>
  ),
  hr: () => (
    <hr className="my-3 border-0 border-t" style={{ borderColor: "var(--border)" }} />
  ),
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table
        className="w-full border-collapse text-[13px]"
        style={{ borderColor: "var(--border)" }}
      >
        {children}
      </table>
    </div>
  ),
  th: ({ children }) => (
    <th
      className="border px-2 py-1 text-left font-semibold"
      style={{ borderColor: "var(--border)" }}
    >
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border px-2 py-1" style={{ borderColor: "var(--border)" }}>
      {children}
    </td>
  ),
  input: ({ checked, disabled, type }) => {
    // GFM task-list checkboxes arrive as disabled <input type="checkbox">.
    if (type !== "checkbox") return null;
    return (
      <input
        type="checkbox"
        checked={!!checked}
        disabled={disabled}
        readOnly
        className="mr-1.5 translate-y-[1px] accent-[var(--accent)]"
      />
    );
  },
};

export function Markdown({ children }: { children: string }) {
  return (
    <div className="text-[14px] leading-relaxed text-[var(--fg)]">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
