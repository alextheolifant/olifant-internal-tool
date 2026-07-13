"use client";

import { useEffect, useRef, useState } from "react";
import {
  deleteCopilotConversation,
  getCopilotConversationMessages,
  listCopilotConversations,
  type CopilotConversationSummary,
} from "../../_lib/copilot-api";
import type { ChatMessage } from "../../_lib/chat-types";
import type { ClientRow } from "../../_lib/types";
import { IconHistory, IconTrash } from "./icons";

interface ChatHistoryProps {
  clients: ClientRow[];
  activeConversationId: string | undefined;
  onLoad: (conversationId: string, accountId: string, accountLabel: string, messages: ChatMessage[]) => void;
  onDelete?: (conversationId: string) => void;
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

export function ChatHistory({ clients, activeConversationId, onLoad, onDelete }: ChatHistoryProps) {
  const [open, setOpen] = useState(false);
  const [isLoading, setLoading] = useState(false);
  const [conversations, setConversations] = useState<CopilotConversationSummary[]>([]);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, []);

  function accountLabelFor(accId: string): string {
    if (accId === "all") return "All Clients";
    return clients.find((c) => c.id === accId)?.name ?? "Unknown account";
  }

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (!next) return;

    setLoading(true);
    try {
      // Every conversation the user has, across all accounts — not just the
      // currently selected one, so history never silently hides entries.
      setConversations(await listCopilotConversations());
    } catch {
      setConversations([]);
    } finally {
      setLoading(false);
    }
  }

  async function selectConversation(c: CopilotConversationSummary) {
    setLoadingId(c.id);
    try {
      const rows = await getCopilotConversationMessages(c.id);
      onLoad(
        c.id,
        c.accountId,
        accountLabelFor(c.accountId),
        rows.map((r) => ({ id: r.id, role: r.role, content: r.content })),
      );
      setOpen(false);
    } catch {
      // leave the panel open — user can retry or pick another conversation
    } finally {
      setLoadingId(null);
    }
  }

  async function handleDelete(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    setDeletingId(id);
    try {
      await deleteCopilotConversation(id);
      setConversations((prev) => prev.filter((c) => c.id !== id));
      onDelete?.(id);
    } catch {
      // leave the row in place — user can retry
    } finally {
      setDeletingId(null);
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
            <div className="px-3 py-2 text-[11.5px] text-neutral-400">No past conversations yet</div>
          )}

          {!isLoading &&
            conversations.map((c) => (
              <div
                key={c.id}
                role="button"
                tabIndex={0}
                onClick={() => selectConversation(c)}
                onKeyDown={(e) => e.key === "Enter" && selectConversation(c)}
                className={`group flex w-full cursor-pointer items-center gap-1.5 px-3 py-2 text-left transition-colors hover:bg-neutral-50 ${
                  c.id === activeConversationId ? "bg-brand/15" : ""
                } ${deletingId === c.id ? "opacity-50" : ""}`}
              >
                <div className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
                  <span className="line-clamp-1 w-full truncate text-[12px] font-medium text-ink">
                    {c.preview || "New conversation"}
                  </span>
                  <span className="flex items-center gap-1.25 text-[10.5px] text-neutral-400">
                    <span className="max-w-30 truncate rounded bg-neutral-100 px-1 py-px font-medium text-neutral-500">
                      {accountLabelFor(c.accountId)}
                    </span>
                    {loadingId === c.id ? "Loading…" : relativeTime(c.updatedAt)}
                  </span>
                </div>
                <button
                  onClick={(e) => handleDelete(c.id, e)}
                  disabled={deletingId !== null}
                  aria-label="Delete conversation"
                  className="shrink-0 rounded p-1 text-neutral-300 opacity-0 transition-colors hover:bg-neutral-100 hover:text-red-600 group-hover:opacity-100 disabled:opacity-50"
                >
                  <IconTrash className="h-3.25 w-3.25" />
                </button>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
