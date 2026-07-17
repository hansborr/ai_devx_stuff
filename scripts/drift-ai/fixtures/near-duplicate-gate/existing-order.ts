type Line = { active: boolean; priceCents: number; quantity: number };

export function totalForOrder(lines: readonly Line[]): number {
  let subtotal = 0;
  for (const line of lines) {
    if (!line.active) {
      continue;
    }
    const lineTotal = line.priceCents * line.quantity;
    subtotal += lineTotal;
  }
  const discount = subtotal > 10_000 ? Math.round(subtotal * 0.1) : 0;
  const tax = Math.round((subtotal - discount) * 0.0825);
  return subtotal - discount + tax;
}
