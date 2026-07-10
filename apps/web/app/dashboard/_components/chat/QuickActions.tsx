"use client";

import type { ComponentType } from "react";
import { IconClipboard, IconFileText, IconPen, IconTarget, IconTrendUp } from "./icons";

interface QuickAction {
  label: string;
  Icon: ComponentType<{ className?: string }>;
  prompt: (accountName: string) => string;
}

const QUICK_ACTIONS: QuickAction[] = [
  {
    label: "Marketing Plan",
    Icon: IconClipboard,
    prompt: (a) =>
      `Build a focused 30-day Amazon marketing plan for ${a}. Use the real numbers from the data. Structure it: a 2-line current-state read, the top 3 priorities, specific PPC actions, organic/listing actions, a budget and TACoS target, and a week-by-week sketch. Keep it tight and skimmable.`,
  },
  {
    label: "Analyze Performance",
    Icon: IconTrendUp,
    prompt: (a) =>
      `Give me a sharp performance read on ${a}: what's working, what's at risk, and the single most important thing to fix this week. Tie every point to the actual metrics.`,
  },
  {
    label: "Create Client Report",
    Icon: IconFileText,
    prompt: (a) =>
      `Create a client-facing performance report for ${a} for the latest period: headline results, what we worked on, what's working, what we're watching, and recommended next steps. Use the real metrics and make it presentation-ready.`,
  },
  {
    label: "Draft Client Update",
    Icon: IconPen,
    prompt: (a) =>
      `Draft a short, confident client update for ${a} covering this period's performance and the next steps. Use the real metrics. A few tight paragraphs.`,
  },
  {
    label: "Find Opportunities",
    Icon: IconTarget,
    prompt: (a) =>
      `Where are the biggest growth opportunities for ${a} right now? Rank them by impact vs effort and tie each one to the data.`,
  },
];

interface QuickActionsProps {
  accountName: string;
  disabled: boolean;
  onSelect: (prompt: string) => void;
  size?: "sm" | "lg";
}

export function QuickActions({ accountName, disabled, onSelect, size = "lg" }: QuickActionsProps) {
  const big = size === "lg";
  return (
    <div className="flex max-w-175 flex-wrap items-center justify-center gap-2 overflow-x-auto">
      {QUICK_ACTIONS.map(({ label, Icon, prompt }) => (
        <button
          key={label}
          disabled={disabled}
          onClick={() => onSelect(prompt(accountName))}
          className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-neutral-200 font-semibold text-ink transition-colors hover:border-neutral-300 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 ${
            big ? "bg-white px-3.5 py-1.5 text-[12.5px] shadow-sm" : "bg-transparent px-2.5 py-1 text-[11.5px] text-neutral-500"
          }`}
        >
          <Icon className="h-3.5 w-3.5" />
          {label}
        </button>
      ))}
    </div>
  );
}
