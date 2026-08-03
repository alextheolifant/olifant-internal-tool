// ─── PPC Engine: resolved target (fallback logic) ───────────────────────────
// Intentional, disclosed fallback — not the "silent fallback" pattern this
// codebase avoids elsewhere. Every consumer (this response now; later rule
// evaluation and task evidence) gets the resolved number AND whether it came
// from the account default together, never just the number alone, so
// nothing downstream can lose that distinction.

export interface ResolvedTarget {
  value: number | null;
  isFallback: boolean;
}

export function resolveTarget(productValue: number | null, accountDefault: number | null): ResolvedTarget {
  if (productValue !== null) return { value: productValue, isFallback: false };
  if (accountDefault !== null) return { value: accountDefault, isFallback: true };
  return { value: null, isFallback: false };
}
