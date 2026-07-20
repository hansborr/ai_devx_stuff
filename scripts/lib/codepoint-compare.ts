// Scripts-local indirection over the lint-ratchet kernel's deterministic
// codepoint comparator, mirroring `scripts/lib/atomic-write.ts`. The
// comparator is an entry of the package's utility contract (generic helpers
// exported for adapter convenience — lint-arch-review leaf 14, `docs/`
// `agent_notes/backlog/lint-arch-review-2026-07/14-enumerated-subpath-`
// `exports.md`), not part of the engine contract. Every `scripts/` consumer
// imports from here, not from
// `@musi/lint-ratchet/kernel/codepoint-compare.js` directly, so the utility
// seam stays one file wide on the adapter side.
export { compareByCodepoint } from "@musi/lint-ratchet/kernel/codepoint-compare.js";
