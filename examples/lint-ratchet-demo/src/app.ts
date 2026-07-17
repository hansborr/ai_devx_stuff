// Demo source with two pre-existing `local/no-console-log` findings. The ratchet freezes
// these two as accepted debt: they do not fail the gate, but a third console
// call would. Walk README.md to see that happen, then drain these away.

export function greet(name: string): string {
  const message = `Hello, ${name}!`;
  // Pre-existing debt #1 — frozen by the baseline.
  console.log(message);
  return message;
}

export function farewell(name: string): string {
  const message = `Goodbye, ${name}.`;
  // Pre-existing debt #2 — frozen by the baseline.
  console.log(message);
  return message;
}
