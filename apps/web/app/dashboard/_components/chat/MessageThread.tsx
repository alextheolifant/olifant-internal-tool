"use client";

import { useEffect, useRef } from "react";
import type { ChatMessage } from "../../_lib/chat-types";
import { IconSparkle } from "./icons";

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
        const isStreamingPlaceholder =
          !isUser && isLoading && idx === messages.length - 1 && m.content.length === 0;
        return (
          <div key={m.id} className="mb-4">
            {!isUser && <ChatLabel suffix={accountLabel} />}
            <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[80%] whitespace-pre-wrap rounded-xl px-3.75 py-2.75 text-[13.5px] leading-relaxed ${
                  isUser ? "bg-ink text-neutral-50" : "border border-neutral-200 bg-surface text-neutral-700"
                } ${isStreamingPlaceholder ? "text-neutral-400" : ""}`}
              >
                {isStreamingPlaceholder ? `Analyzing ${accountLabel} data…` : m.content}
              </div>
            </div>
          </div>
        );
      })}

      <div ref={bottomRef} />
    </div>
  );
}
