import { LINT_RATCHET_CONFIG_HASH_PREFIX } from "@musi/lint-ratchet/kernel/baseline.js";

// Shared lint-ratchet adapter-test fixture. lint-ratchet is load-bearing
// tooling and the rule-source-hash prefix is exactly the contract that changes
// when a ratchet metric is added, so the fixture rule-source-hash const lives
// in one place. The entries -> LintRatchetCurrentById builder moved with the
// governance suites to tools/lint-ratchet/test/support (leaf 12); the
// remaining adapter consumer (check-registry) only needs the hash.

// The fixture rule-source-hash: the real config-hash prefix joined with a
// placeholder digest of the SHA-256 hex length. Used by every lint-ratchet
// test that seeds a baseline rule-source-hash map.
const SHA256_HEX_LENGTH = 64;
export const FIXTURE_HASH = `${LINT_RATCHET_CONFIG_HASH_PREFIX}${"a".repeat(SHA256_HEX_LENGTH)}`;
