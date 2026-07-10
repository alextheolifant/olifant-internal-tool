import { apiFetch } from "@/lib/api";

export interface CopilotMessageResponse {
  conversationId: string;
  reply: string;
}

export async function sendCopilotMessage(
  accountId: string,
  message: string,
  conversationId: string | undefined,
): Promise<CopilotMessageResponse> {
  const res = await apiFetch("/api/ai/copilot/message", {
    method: "POST",
    body: JSON.stringify({ accountId, message, conversationId }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
