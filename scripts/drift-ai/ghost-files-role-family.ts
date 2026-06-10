import path from "node:path";

import { normalizedTokens } from "./ghost-files-tokens.js";

// Weak filename tokens that mark a *structural role split* rather than a possible
// fork. `foo-types.ts` / `foo-schema.ts` / `foo-model.ts` are conventionally the
// types/schema/model extracted from a base module, and parallel detector families
// (e.g. `duplicate-schemas` vs `duplicate-types`) differ only by such a marker.
// `helper` / `util` / `service` / ... are deliberately NOT here: a `foo-helper.ts`
// beside `foo.ts` is the canonical ghost signal and must keep reporting.
export const DEFAULT_GHOST_FILE_ROLE_MARKER_TOKENS: readonly string[] = ["type", "schema", "model"];

// Current-scope-only honesty note: this is a naming-convention heuristic, not a
// dependency proof. A suppressed pair is treated as an intentional role family
// because its filenames look like a role split, not because drift:ai verified the
// two modules are independent.
//
// True when every token that differs between the two normalized filenames is
// either a role-marker token or a repeat of a token the two already share
// (e.g. `coldspots-coldspot` vs `coldspots`). A difference that introduces a
// genuinely new, non-marker token — the `util` in `auth-util` vs `auth` — is not a
// role split and keeps reporting. Intended for `weak-suffix-variant` matches, where
// the strong-token sets are already equal so only role/decoration tokens can differ.
export function isRoleSplitFamilyPair(
  leftPath: string,
  rightPath: string,
  roleMarkerTokens: ReadonlySet<string>,
): boolean {
  const left = normalizedTokens(path.posix.basename(leftPath));
  const right = normalizedTokens(path.posix.basename(rightPath));
  const differing = symmetricMultisetDifference(left, right);
  if (differing.length === 0) return false;
  const rightSet = new Set(right);
  const sharedTokens = new Set(left.filter((token) => rightSet.has(token)));
  return differing.every((token) => roleMarkerTokens.has(token) || sharedTokens.has(token));
}

function symmetricMultisetDifference(left: readonly string[], right: readonly string[]): string[] {
  return [...multisetDifference(left, right), ...multisetDifference(right, left)];
}

// Tokens of `from` that `other` cannot account for by multiplicity: each `from`
// token consumes one matching `other` token, and the leftovers are the difference.
// So [a, a, b] minus [a, b] is [a] (the extra `a`), not [].
function multisetDifference(from: readonly string[], other: readonly string[]): string[] {
  const remaining = new Map<string, number>();
  for (const token of other) remaining.set(token, (remaining.get(token) ?? 0) + 1);
  const out: string[] = [];
  for (const token of from) {
    const count = remaining.get(token) ?? 0;
    if (count > 0) remaining.set(token, count - 1);
    else out.push(token);
  }
  return out;
}
