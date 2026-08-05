"use client";

import { useEffect, useRef } from "react";
import type { ChatMessage } from "../../_lib/chat-types";
import { IconSparkle } from "./icons";
import { MarkdownContent } from "./MarkdownContent";
import { StepStack } from "./StepStack";

interface MessageThreadProps {
  messages: ChatMessage[];
  isLoading: boolean;
  accountLabel: string;
}

function ChatLabel({ suffix }: { suffix?: string }) {
  return (
    <div className="mb-1 flex items-center gap-1.5 font-mono text-[10.5px] font-bold uppercase tracking-wide text-neutral-400">
      <IconSparkle className="h-3 w-3 text-green-700" />
      Chat{suffix ? ` · ${suffix}` : ""}
    </div>
  );
}

export function MessageThread({ messages, isLoading, accountLabel }: MessageThreadProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  return (
    <div className="mx-auto w-full max-w-195">
      {messages.map((m, idx) => {
        const isUser = m.role === "user";
        // True for the whole time this assistant message is actively being
        // generated (empty placeholder AND mid-reveal). Markdown renders the
        // whole time now (via Streamdown, which tolerates incomplete syntax
        // mid-stream) — isStreamingNow just tells MarkdownContent which mode
        // to parse in, and gates the empty-content placeholder text.
        const isStreamingNow = !isUser && isLoading && idx === messages.length - 1;
        const isStreamingPlaceholder = isStreamingNow && m.content.length === 0;
        return (
          <div key={m.id} className="mb-4">
            {!isUser && <ChatLabel suffix={accountLabel} />}
            {!isUser && m.steps && m.steps.length > 0 && <StepStack steps={m.steps} />}
            <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
              {isUser ? (
                <div className="max-w-[80%] whitespace-pre-wrap rounded-xl bg-ink px-3.75 py-2.75 text-[13.5px] leading-relaxed text-neutral-50">
                  {m.content}
                </div>
              ) : isStreamingPlaceholder ? (
                <div className="w-full text-[13.5px] leading-relaxed text-neutral-400">
                  Analyzing {accountLabel} data…
                </div>
              ) : (
                <MarkdownContent content={m.content} isStreaming={isStreamingNow} />
              )}
            </div>
          </div>
        );
      })}

      <div ref={bottomRef} />
    </div>
  );
}
