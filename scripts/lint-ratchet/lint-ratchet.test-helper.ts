import {
  LINT_RATCHET_CONFIG_HASH_PREFIX,
  type LintRatchetCurrentById,
  type LintRatchetCurrentItem,
} from "./baseline.js";

// Shared lint-ratchet test fixtures. lint-ratchet is load-bearing tooling and
// its baseline/current shape (LintRatchetCurrentById, the rule-source-hash
// prefix) is exactly the contract that changes when a ratchet metric is added,
// so the fixture rule-source-hash const and the entries -> LintRatchetCurrentById
// builder live in one place. A stale or mistyped copy in a single test file can
// no longer silently weaken that file's guard.

// The fixture rule-source-hash: the real config-hash prefix joined with a
// placeholder digest of the SHA-256 hex length. Used by every lint-ratchet
// test that seeds a baseline rule-source-hash map.
const SHA256_HEX_LENGTH = 64;
export const FIXTURE_HASH = `${LINT_RATCHET_CONFIG_HASH_PREFIX}${"a".repeat(SHA256_HEX_LENGTH)}`;

// Builds a LintRatchetCurrentById (Map<ratchetId, Map<key, item>>) from nested
// readonly entries — the entries-taking builder shared verbatim by the summary
// and zero-baseline suites. (check-registry's nullary currentById() is a
// distinct single-entry helper and intentionally stays local there.)
export function currentById(
  entries: readonly [string, readonly [string, LintRatchetCurrentItem][]][],
): LintRatchetCurrentById {
  const current = new Map<string, ReadonlyMap<string, LintRatchetCurrentItem>>();
  for (const [ratchetId, items] of entries) {
    current.set(ratchetId, new Map(items));
  }
  return current;
}
