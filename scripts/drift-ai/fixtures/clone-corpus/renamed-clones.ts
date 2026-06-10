// Corpus family: renamed-variable clones.
// Same control flow and structure, but every local and parameter is renamed.
// A structural engine that drops binding names (and keeps property names) should
// still rank this pair highly; a raw-token engine can miss it.
// Labeled pair: totalForInvoice <-> totalForLedger (category: renamed).

type Line = { active: boolean; priceCents: number; quantity: number };

export function totalForInvoice(rows: readonly Line[]): number {
  let subtotal = 0;
  for (const row of rows) {
    if (!row.active) {
      continue;
    }
    const rowTotal = row.priceCents * row.quantity;
    subtotal += rowTotal;
  }
  const discount = subtotal > 10_000 ? Math.round(subtotal * 0.1) : 0;
  const tax = Math.round((subtotal - discount) * 0.0825);
  return subtotal - discount + tax;
}

export function totalForLedger(items: readonly Line[]): number {
  let accrued = 0;
  for (const item of items) {
    if (!item.active) {
      continue;
    }
    const itemTotal = item.priceCents * item.quantity;
    accrued += itemTotal;
  }
  const rebate = accrued > 10_000 ? Math.round(accrued * 0.1) : 0;
  const levy = Math.round((accrued - rebate) * 0.0825);
  return accrued - rebate + levy;
}
