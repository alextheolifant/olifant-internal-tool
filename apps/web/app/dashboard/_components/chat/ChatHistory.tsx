"use client";

import { useEffect, useRef, useState } from "react";
import {
  getCopilotConversationMessages,
  listCopilotConversations,
  type CopilotConversationSummary,
} from "../../_lib/copilot-api";
import type { ChatMessage } from "../../_lib/chat-types";
import { IconHistory } from "./icons";

interface ChatHistoryProps {
  accountId: string;
  activeConversationId: string | undefined;
  onLoad: (conversationId: string, messages: ChatMessage[]) => void;
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function ChatHistory({ accountId, activeConversationId, onLoad }: ChatHistoryProps) {
  const [open, setOpen] = useState(false);
  const [isLoading, setLoading] = useState(false);
  const [conversations, setConversations] = useState<CopilotConversationSummary[]>([]);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, []);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (!next) return;

    setLoading(true);
    try {
      setConversations(await listCopilotConversations(accountId));
    } catch {
      setConversations([]);
    } finally {
      setLoading(false);
    }
  }

  async function selectConversation(id: string) {
    setLoadingId(id);
    try {
      const rows = await getCopilotConversationMessages(id);
      onLoad(
        id,
        rows.map((r) => ({ id: r.id, role: r.role, content: r.content })),
      );
      setOpen(false);
    } catch {
      // leave the panel open — user can retry or pick another conversation
    } finally {
      setLoadingId(null);
    }
  }

  return (
    <div className="relative" ref={wrapRef}>
      <button
        onClick={toggle}
        className="flex items-center gap-1.5 rounded-lg border border-neutral-200 px-2.5 py-1 text-[11px] font-semibold text-neutral-500 transition-colors hover:border-neutral-300 hover:text-ink"
      >
        <IconHistory className="h-3.25 w-3.25" />
        History
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-1.5 max-h-80 w-72 overflow-y-auto rounded-lg border border-neutral-200 bg-white py-1 shadow-lg">
          {isLoading && <div className="px-3 py-2 text-[11.5px] text-neutral-400">Loading…</div>}

          {!isLoading && conversations.length === 0 && (
            <div className="px-3 py-2 text-[11.5px] text-neutral-400">No past conversations for this account</div>
          )}

          {!isLoading &&
            conversations.map((c) => (
              <button
                key={c.id}
                onClick={() => selectConversation(c.id)}
                disabled={loadingId !== null}
                className={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left transition-colors hover:bg-neutral-50 disabled:opacity-50 ${
                  c.id === activeConversationId ? "bg-brand/15" : ""
                }`}
              >
                <span className="line-clamp-1 w-full truncate text-[12px] font-medium text-ink">
                  {c.preview || "New conversation"}
                </span>
                <span className="text-[10.5px] text-neutral-400">
                  {loadingId === c.id ? "Loading…" : relativeTime(c.updatedAt)}
                </span>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
