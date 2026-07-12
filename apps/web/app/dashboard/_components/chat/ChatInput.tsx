"use client";

import { useRef, type FormEvent, type KeyboardEvent } from "react";
import { IconSend, IconStop, IconTarget } from "./icons";

const MAX_HEIGHT = 120;

interface ChatInputProps {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  disabled: boolean;
  accountLabel: string;
}

export function ChatInput({ value, onChange, onSend, onStop, disabled, accountLabel }: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function handleInput(e: FormEvent<HTMLTextAreaElement>) {
    const el = e.currentTarget;
    onChange(el.value);
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
      if (textareaRef.current) textareaRef.current.style.height = "auto";
    }
  }

  return (
    <div className="w-full max-w-175 rounded-xl border border-neutral-200 bg-surface px-3 py-2.5 shadow-sm">
      <textarea
        ref={textareaRef}
        value={value}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        rows={1}
        placeholder={`Ask anything about ${accountLabel}…`}
        style={{ maxHeight: MAX_HEIGHT }}
        className="max-h-30 min-h-6 w-full resize-none border-none bg-transparent text-[14px] text-ink placeholder:text-neutral-400 focus:outline-none disabled:opacity-60"
      />
      <div className="mt-1.5 flex items-center justify-between">
        <span className="inline-flex items-center gap-1.25 text-[11px] text-neutral-400">
          <IconTarget className="h-3.25 w-3.25 text-green-700" />
          Connected to {accountLabel}
        </span>
        {disabled ? (
          <button
            onClick={onStop}
            aria-label="Stop generating"
            className="flex h-7.5 w-7.5 shrink-0 items-center justify-center rounded-lg bg-ink text-neutral-50 transition-colors hover:bg-neutral-800"
          >
            <IconStop className="h-3.25 w-3.25" />
          </button>
        ) : (
          <button
            onClick={onSend}
            disabled={value.trim().length === 0}
            aria-label="Send message"
            className="flex h-7.5 w-7.5 shrink-0 items-center justify-center rounded-lg bg-ink text-neutral-50 transition-colors hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400"
          >
            <IconSend className="h-3.75 w-3.75" />
          </button>
        )}
      </div>
    </div>
  );
}
