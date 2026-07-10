"use client";

import { useCallback, useState } from "react";
import { useClientRoster } from "../../_lib/use-client-roster";
import { sendCopilotMessage } from "../../_lib/copilot-api";
import type { ChatMessage } from "../../_lib/chat-types";
import UserMenu from "../user-menu";
import { AccountSelector } from "./AccountSelector";
import { QuickActions } from "./QuickActions";
import { MessageThread } from "./MessageThread";
import { ChatInput } from "./ChatInput";

let messageSeq = 0;
function newMessageId() {
  messageSeq += 1;
  return `msg-${Date.now()}-${messageSeq}`;
}

export function ChatView() {
  const { clients, isLoading: rosterLoading } = useClientRoster();

  const [selectedId, setSelectedId] = useState<string>("all");
  const [accountLabel, setAccountLabel] = useState<string>("All Clients");
  const accountName = selectedId === "all" ? "the agency (all clients)" : accountLabel;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isSending, setSending] = useState(false);
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);

  const handleSelectAccount = useCallback((id: string, name: string) => {
    setSelectedId(id);
    setAccountLabel(name);
  }, []);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isSending) return;

      setMessages((prev) => [...prev, { id: newMessageId(), role: "user", content: trimmed }]);
      setInput("");
      setSending(true);

      try {
        const response = await sendCopilotMessage(selectedId, trimmed, conversationId);
        setConversationId(response.conversationId);
        setMessages((prev) => [
          ...prev,
          { id: newMessageId(), role: "assistant", content: response.reply },
        ]);
      } catch {
        setMessages((prev) => [
          ...prev,
          {
            id: newMessageId(),
            role: "assistant",
            content: "Sorry, the co-pilot is temporarily unavailable. Please try again in a moment.",
          },
        ]);
      } finally {
        setSending(false);
      }
    },
    [selectedId, conversationId, isSending],
  );

  const handleNewChat = useCallback(() => {
    setMessages([]);
    setInput("");
    setConversationId(undefined);
  }, []);

  const hasMessages = messages.length > 0;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-canvas">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center justify-between border-b border-neutral-200 bg-surface px-5 py-2.5">
        <div className="flex items-baseline gap-2">
          <span className="text-[14px] font-bold text-ink">Chat</span>
          <span className="text-[12px] text-neutral-400">connected to live client data</span>
        </div>
        <div className="flex items-center gap-2">
          {hasMessages && (
            <button
              onClick={handleNewChat}
              className="rounded-lg border border-neutral-200 px-2.5 py-1 text-[11px] font-semibold text-neutral-500 transition-colors hover:border-neutral-300 hover:text-ink"
            >
              New chat
            </button>
          )}
          <AccountSelector
            accountLabel={accountLabel}
            clients={clients}
            isLoading={rosterLoading}
            selectedId={selectedId}
            onSelect={handleSelectAccount}
          />
          <UserMenu />
        </div>
      </div>

      {!hasMessages ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-6 py-8">
          <p className="mb-2 text-center font-serif text-[34px] font-bold tracking-tight text-ink">
            What are we working on?
          </p>
          <p className="mb-5 max-w-140 text-center text-[14px] text-neutral-400">
            Your AI co-pilot, wired to the dashboard&rsquo;s live numbers. Choose a client to focus, then plan,
            analyze, or draft — it answers with the real data.
          </p>
          <div className="mb-4.5 flex items-center gap-2.5">
            <AccountSelector
              accountLabel={accountLabel}
              clients={clients}
              isLoading={rosterLoading}
              selectedId={selectedId}
              onSelect={handleSelectAccount}
              size="lg"
            />
            <span className="text-[11.5px] text-neutral-300">optional — defaults to all clients</span>
          </div>
          <ChatInput value={input} onChange={setInput} onSend={() => send(input)} disabled={isSending} accountLabel={accountLabel} />
          <div className="mt-3.5">
            <QuickActions accountName={accountName} disabled={isSending} onSelect={send} size="lg" />
          </div>
        </div>
      ) : (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
            <MessageThread messages={messages} isLoading={isSending} accountLabel={accountLabel} />
          </div>
          <div className="flex shrink-0 flex-col items-center gap-2.25 border-t border-neutral-200 bg-canvas px-5 py-3">
            <ChatInput value={input} onChange={setInput} onSend={() => send(input)} disabled={isSending} accountLabel={accountLabel} />
            <QuickActions accountName={accountName} disabled={isSending} onSelect={send} size="sm" />
          </div>
        </>
      )}
    </div>
  );
}
