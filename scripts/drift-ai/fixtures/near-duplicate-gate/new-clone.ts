type ShipmentLine = { active: boolean; priceCents: number; quantity: number };

export function totalForShipment(items: readonly ShipmentLine[]): number {
  let amount = 0;
  for (const item of items) {
    if (!item.active) {
      continue;
    }
    const itemAmount = item.priceCents * item.quantity;
    amount += itemAmount;
  }
  const reduction = amount > 10_000 ? Math.round(amount * 0.1) : 0;
  const levy = Math.round((amount - reduction) * 0.0825);
  return amount - reduction + levy;
}
