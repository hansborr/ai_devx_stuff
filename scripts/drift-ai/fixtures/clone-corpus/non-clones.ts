// Corpus family: unrelated non-clones.
// Two functions of comparable size that share no logic or domain. No engine should
// pair them; they exist to catch detectors that flag superficial size or keyword
// overlap.
// Labeled non-pair: availableBalance <-> summarizeTokens (category: unrelated).

type Account = { balance: number; pending: number };

export function availableBalance(account: Account): number {
  const cleared = account.balance - account.pending;
  if (cleared < 0) {
    return 0;
  }
  const buffer = Math.min(cleared, 5_000);
  const usable = cleared - buffer + Math.round(buffer * 0.5);
  return Math.max(usable, 0);
}

type Token = { kind: string; length: number };

export function summarizeTokens(tokens: readonly Token[]): string {
  const parts: string[] = [];
  for (const token of tokens) {
    if (token.length === 0) {
      continue;
    }
    parts.push(`${token.kind}:${String(token.length)}`);
  }
  const joined = parts.join(",");
  return joined.length > 0 ? joined : "empty";
}
