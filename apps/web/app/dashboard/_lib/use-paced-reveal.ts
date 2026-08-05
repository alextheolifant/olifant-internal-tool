"use client";

import { useCallback, useEffect, useRef } from "react";

// Target time between word reveals — tuned to feel like natural typing, not
// a typewriter effect and not an instant dump. Named constant per the design
// brief rather than a magic number inline.
const WORD_REVEAL_INTERVAL_MS = 32;

// Catch-up: if incoming text is arriving faster than the reveal rate, the
// buffer of un-revealed words grows — reveal more words per tick to close
// the gap instead of falling further behind. Thresholds are approximate
// word counts still waiting in the buffer.
const CATCH_UP_THRESHOLDS: { minWaitingWords: number; wordsPerTick: number }[] = [
  { minWaitingWords: 30, wordsPerTick: 8 },
  { minWaitingWords: 15, wordsPerTick: 4 },
  { minWaitingWords: 6, wordsPerTick: 2 },
  { minWaitingWords: 0, wordsPerTick: 1 },
];

function wordsPerTick(pending: string): number {
  const waitingWords = pending.trim().length === 0 ? 0 : pending.trim().split(/\s+/).length;
  for (const { minWaitingWords, wordsPerTick: n } of CATCH_UP_THRESHOLDS) {
    if (waitingWords >= minWaitingWords) return n;
  }
  return 1;
}

// Pops the next "word" (a run of non-whitespace plus its trailing
// whitespace) off the front of the buffer. Returns null if the buffer
// doesn't yet contain a complete word boundary — e.g. we're mid-word,
// waiting for more streamed text — so a word is never revealed half-formed.
function takeNextWord(buffer: string): { word: string; rest: string } | null {
  const match = buffer.match(/^(\S+\s*)/);
  if (!match) return null;
  const word = match[1];
  if (word.length === buffer.length && !/\s$/.test(word)) {
    return null; // reaches the end of the buffer with no trailing whitespace — could still grow
  }
  return { word, rest: buffer.slice(word.length) };
}

// Buffers incoming text and reveals it word-by-word at a steady pace,
// decoupling "data arrived" (cheap, ref-only) from "render an update" (the
// paced tick) — this is what smooths out bursty token arrival. push() never
// triggers a render itself; only the interval tick does, at a controlled
// rate. flush() reveals everything immediately, for stream completion.
export function usePacedReveal(onReveal: (revealedText: string) => void) {
  const pendingRef = useRef("");
  const revealedRef = useRef("");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const tick = useCallback(() => {
    if (pendingRef.current.length === 0) {
      stopTimer();
      return;
    }
    const n = wordsPerTick(pendingRef.current);
    let revealedChunk = "";
    for (let i = 0; i < n; i++) {
      const next = takeNextWord(pendingRef.current);
      if (!next) break;
      revealedChunk += next.word;
      pendingRef.current = next.rest;
    }
    if (revealedChunk) {
      revealedRef.current += revealedChunk;
      onReveal(revealedRef.current);
    }
  }, [onReveal, stopTimer]);

  const push = useCallback(
    (chunk: string) => {
      pendingRef.current += chunk;
      if (timerRef.current === null) {
        timerRef.current = setInterval(tick, WORD_REVEAL_INTERVAL_MS);
      }
    },
    [tick],
  );

  // Reveals everything remaining immediately, rather than continuing the
  // paced animation — must never let the reveal trail generation completion.
  const flush = useCallback(() => {
    stopTimer();
    if (pendingRef.current.length > 0) {
      revealedRef.current += pendingRef.current;
      pendingRef.current = "";
      onReveal(revealedRef.current);
    }
  }, [onReveal, stopTimer]);

  const reset = useCallback(() => {
    stopTimer();
    pendingRef.current = "";
    revealedRef.current = "";
  }, [stopTimer]);

  useEffect(() => stopTimer, [stopTimer]);

  return { push, flush, reset };
}
