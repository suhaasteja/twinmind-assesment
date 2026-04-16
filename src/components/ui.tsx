"use client";

import { cn } from "@/lib/utils";
import { SuggestionType } from "@/lib/types";
import { ButtonHTMLAttributes, forwardRef, ReactNode } from "react";

export const Panel = ({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) => (
  <div
    className={cn(
      "flex min-h-0 flex-col rounded-xl border bg-[var(--panel)]",
      className
    )}
    style={{ borderColor: "var(--border)" }}
  >
    {children}
  </div>
);

export const PanelHeader = ({
  title,
  right,
}: {
  title: string;
  right?: ReactNode;
}) => (
  <div
    className="flex items-center justify-between border-b px-4 py-3"
    style={{ borderColor: "var(--border)" }}
  >
    <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">
      {title}
    </div>
    <div className="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">
      {right}
    </div>
  </div>
);

export const InfoCard = ({ children }: { children: ReactNode }) => (
  <div
    className="mx-4 mt-4 rounded-lg border bg-[var(--panel-2)] px-3 py-2 text-[13px] leading-relaxed text-[var(--muted)]"
    style={{ borderColor: "var(--border)" }}
  >
    {children}
  </div>
);

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: "primary" | "ghost" | "subtle";
  }
>(function Button({ variant = "subtle", className, ...props }, ref) {
  const base =
    "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";
  const styles: Record<string, string> = {
    primary:
      "bg-[var(--accent)] text-white hover:bg-blue-500",
    ghost:
      "text-[var(--muted)] hover:text-white hover:bg-white/5",
    subtle:
      "border bg-[var(--panel-2)] text-[var(--fg)] hover:bg-white/5",
  };
  return (
    <button
      ref={ref}
      className={cn(base, styles[variant], className)}
      style={variant === "subtle" ? { borderColor: "var(--border)" } : undefined}
      {...props}
    />
  );
});

const CHIP_COLORS: Record<SuggestionType, { bg: string; fg: string }> = {
  question:     { bg: "rgba(236,72,153,0.12)",  fg: "#f472b6" },
  talking_point:{ bg: "rgba(167,139,250,0.12)", fg: "#c4b5fd" },
  answer:       { bg: "rgba(16,185,129,0.12)",  fg: "#34d399" },
  fact_check:   { bg: "rgba(245,158,11,0.12)",  fg: "#fbbf24" },
  clarify:      { bg: "rgba(56,189,248,0.12)",  fg: "#7dd3fc" },
};

const CHIP_LABELS: Record<SuggestionType, string> = {
  question: "QUESTION TO ASK",
  talking_point: "TALKING POINT",
  answer: "ANSWER",
  fact_check: "FACT-CHECK",
  clarify: "CLARIFY",
};

export function TypeChip({ type }: { type: SuggestionType }) {
  const c = CHIP_COLORS[type];
  return (
    <span
      className="inline-flex items-center rounded px-2 py-0.5 text-[10px] font-semibold tracking-wider"
      style={{ background: c.bg, color: c.fg }}
    >
      {CHIP_LABELS[type]}
    </span>
  );
}

export function StatusDot({
  color,
  label,
  pulse,
}: {
  color: string;
  label: string;
  pulse?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="relative inline-flex h-2 w-2">
        {pulse && (
          <span
            className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75"
            style={{ background: color }}
          />
        )}
        <span
          className="relative inline-flex h-2 w-2 rounded-full"
          style={{ background: color }}
        />
      </span>
      <span className="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">
        {label}
      </span>
    </span>
  );
}
