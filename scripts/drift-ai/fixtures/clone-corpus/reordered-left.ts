// Corpus family: reordered-statement clones (left side; pairs with reordered-right.ts).
// The two functions compute the same payload with independent statements emitted
// in a different order. A statement-set / structural engine should treat them as
// near-identical; a sequence-sensitive engine may score them lower.
// Labeled pair: buildDispatchPayload <-> makeDispatchPayload (category: reordered).

type Order = {
  destination: { country: string };
  status: string;
  items: readonly { weight: number }[];
};
type Payload = Record<string, unknown>;

export function buildDispatchPayload(order: Order): Payload {
  const destinationCountry = order.destination.country.toUpperCase();
  const canShip = order.status === "paid" && order.items.length > 0;
  const carrier = destinationCountry === "CA" ? "post" : "ups";
  const totalWeight = order.items.reduce((sum, item) => sum + item.weight, 0);
  if (!canShip) {
    return { carrier: "hold", totalWeight: 0, destinationCountry };
  }
  const priority = totalWeight > 50 ? "freight" : "standard";
  return { carrier, totalWeight, destinationCountry, priority };
}
