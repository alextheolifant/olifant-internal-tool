// ─── Search term normalization ──────────────────────────────────────────────
// "Coat Defense" and "coat defense" are the same term. W1's winner
// cross-check (Guard 2) compares a failing term against targets and terms
// elsewhere in the account, and BOTH sides of that comparison must be
// normalized the same way or the guard silently misses winners — which is
// the failure mode that leads to negating a converting keyword.
//
// The transform, stated explicitly (the brief asks for this to be defined,
// not assumed):
//
//   1. Unicode NFKC — folds full-width/compatibility forms to their plain
//      equivalents, so a term pasted from a non-Latin keyboard matches.
//   2. Lowercase.
//   3. Separator punctuation (hyphen, underscore, slash) → space. Amazon
//      shoppers type "coat-defense" and "coat defense" interchangeably.
//   4. Drop apostrophes and quotes ENTIRELY rather than turning them into
//      spaces — "dog's" must become "dogs", not "dog s".
//   5. Drop remaining sentence punctuation (. , ! ? ; : etc).
//   6. Collapse runs of whitespace to one space, then trim.
//
// Deliberately NOT done: stemming, plural folding, or stop-word removal.
// "coat" and "coats" are genuinely different search terms with different
// performance, and collapsing them would make Guard 2 claim a winner that
// isn't the same term — a false negative on a real waste case is recoverable,
// a wrongly-suppressed negation is not the risk here, but a wrongly-CLAIMED
// winner would mis-scope a task's evidence. Keep the transform lossless
// enough to stay trustworthy.
//
// The verbatim term is always kept alongside for display: instructions and
// task payloads quote what the shopper actually typed, never the normalized
// form (the executor has to find this exact string in the Ads console).

const APOSTROPHES = /['’‘`´]/g;
const SEPARATORS = /[-_/\\]+/g;
const OTHER_PUNCT = /[.,!?;:"“”()[\]{}<>|@#$%^&*+=~]/g;
const WHITESPACE = /\s+/g;

export function normalizeSearchTerm(raw: string): string {
  return raw
    .normalize('NFKC')
    .toLowerCase()
    .replace(APOSTROPHES, '')
    .replace(SEPARATORS, ' ')
    .replace(OTHER_PUNCT, ' ')
    .replace(WHITESPACE, ' ')
    .trim();
}

// Composite entity id for a (campaign, term) pair.
//
// W1 evaluates a term SEPARATELY INSIDE EACH CAMPAIGN (Guard 1), so the
// rule's entity identity must carry the campaign too. Keying on the term
// alone would collapse the same term across campaigns into one
// rule_condition_state row and one dedup fingerprint — which is exactly the
// account-wide behavior Guard 1 exists to prevent.
//
// Verbatim (not normalized) term, so the id round-trips back to a real
// searchable string. Max real term length observed in this dataset is 200
// chars; campaign id + separator adds ~17, leaving the result inside
// tasks.entity_id's varchar(255).
export const ENTITY_ID_SEPARATOR = '::';

export function searchTermEntityId(campaignId: string, term: string): string {
  return `${campaignId}${ENTITY_ID_SEPARATOR}${term}`;
}

export function parseSearchTermEntityId(entityId: string): { campaignId: string; term: string } | null {
  const idx = entityId.indexOf(ENTITY_ID_SEPARATOR);
  if (idx === -1) return null;
  return {
    campaignId: entityId.slice(0, idx),
    // The term itself may contain the separator; only the first one splits.
    term: entityId.slice(idx + ENTITY_ID_SEPARATOR.length),
  };
}
