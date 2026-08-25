type Entry = { active: boolean; priceCents: number; quantity: number };

export function totalForBasket(entries: readonly Entry[]): number {
  let running = 0;
  for (const entry of entries) {
    if (!entry.active) {
      continue;
    }
    const entryTotal = entry.priceCents * entry.quantity;
    running += entryTotal;
  }
  const rebate = running > 10_000 ? Math.round(running * 0.1) : 0;
  const taxes = Math.round((running - rebate) * 0.0825);
  return running - rebate + taxes;
}
