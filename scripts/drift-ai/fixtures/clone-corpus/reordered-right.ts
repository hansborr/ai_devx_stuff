// Corpus family: reordered-statement clones (right side; pairs with reordered-left.ts).
// Same independent statements as buildDispatchPayload, emitted in a different order
// and with renamed bindings. See reordered-left.ts for the family description.
// Labeled pair: buildDispatchPayload <-> makeDispatchPayload (category: reordered).

type Order = {
  destination: { country: string };
  status: string;
  items: readonly { weight: number }[];
};
type Payload = Record<string, unknown>;

export function makeDispatchPayload(shipment: Order): Payload {
  const canShip = shipment.status === "paid" && shipment.items.length > 0;
  const destinationCountry = shipment.destination.country.toUpperCase();
  const totalWeight = shipment.items.reduce((sum, item) => sum + item.weight, 0);
  const carrier = destinationCountry === "CA" ? "post" : "ups";
  if (!canShip) {
    return { carrier: "hold", totalWeight: 0, destinationCountry };
  }
  const priority = totalWeight > 50 ? "freight" : "standard";
  return { carrier, totalWeight, destinationCountry, priority };
}
