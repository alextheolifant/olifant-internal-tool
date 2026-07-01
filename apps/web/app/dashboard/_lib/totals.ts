import type { ClientRow, Totals, RawInputs } from "./types";
import { derive, sumRaw, ZERO_RAW } from "./derive";

/**
 * Compute portfolio-level totals from a list of client rows.
 *
 * RULE: Sum ALL raw inputs first, then call derive() ONCE.
 * Never average ratios (ACoS, TACoS, ROAS, etc.) — that is incorrect.
 */
export function computeTotals(clients: ClientRow[]): Totals {
  let activeCount = 0;

  // Sum raw inputs across all clients
  const summed = clients.reduce<RawInputs>((acc, c) => {
    if (c.status === "Active") activeCount++;
    return sumRaw(acc, c);
  }, { ...ZERO_RAW });

  // Derive metrics ONCE from the summed raws
  const derived = derive(summed);

  return {
    ...summed,
    ...derived,
    activeCount,
    totalCount: clients.length,
  };
}
