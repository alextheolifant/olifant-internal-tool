import { apiFetch } from "@/lib/api";

type CopilotStreamEvent =
  | { type: "delta"; text: string }
  | { type: "done" }
  | { type: "error"; message: string };

export interface StreamCopilotMessageArgs {
  accountId: string;
  message: string;
  conversationId: string | undefined;
  signal?: AbortSignal;
  onDelta: (text: string) => void;
}

export async function streamCopilotMessage({
  accountId,
  message,
  conversationId,
  signal,
  onDelta,
}: StreamCopilotMessageArgs): Promise<{ conversationId: string }> {
  const res = await apiFetch("/api/ai/copilot/message", {
    method: "POST",
    body: JSON.stringify({ accountId, message, conversationId }),
    signal,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const newConversationId = res.headers.get("X-Conversation-Id");
  if (!newConversationId) throw new Error("Missing conversation id in streaming response");

  const reader = res.body?.getReader();
  if (!reader) throw new Error("Streaming is not supported in this environment");

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newlineIndex: number;
    while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      if (!line.trim()) continue;

      const event = JSON.parse(line) as CopilotStreamEvent;
      if (event.type === "delta") onDelta(event.text);
      else if (event.type === "error") throw new Error(event.message);
    }
  }

  return { conversationId: newConversationId };
}

export interface CopilotConversationSummary {
  id: string;
  accountId: string;
  createdAt: string;
  updatedAt: string;
  preview: string;
}

export async function listCopilotConversations(accountId?: string): Promise<CopilotConversationSummary[]> {
  const qs = accountId ? `?accountId=${encodeURIComponent(accountId)}` : "";
  const res = await apiFetch(`/api/ai/copilot/conversations${qs}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export interface CopilotConversationMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export async function getCopilotConversationMessages(
  conversationId: string,
): Promise<CopilotConversationMessage[]> {
  const res = await apiFetch(`/api/ai/copilot/conversations/${conversationId}/messages`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function deleteCopilotConversation(conversationId: string): Promise<void> {
  const res = await apiFetch(`/api/ai/copilot/conversations/${conversationId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}
