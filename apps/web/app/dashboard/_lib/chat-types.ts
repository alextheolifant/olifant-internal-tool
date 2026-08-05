import type { CopilotStep } from "./copilot-api";

export type { CopilotStep as ChatStep };

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  // Only ever populated on the live-streaming turn — not persisted, so
  // messages loaded from conversation history won't have it.
  steps?: CopilotStep[];
}
