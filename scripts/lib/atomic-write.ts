// Scripts-local indirection over the lint-ratchet kernel's atomic
// replacement writer. Every `scripts/` consumer imports from here, not
// from `@musi/lint-ratchet/kernel/atomic-write.js` directly, so the
// eventual utility-contract relocation decided by lint-arch-review
// leaf 14 (`docs/agent_notes/backlog/lint-arch-review-2026-07/`
// `14-enumerated-subpath-exports.md`) touches this one file instead of
// every call site.
//
// Scope: reader-atomic POSIX replacement (same-directory temp +
// rename), not crash durability — no fsync. The kernel is consumed,
// never modified.
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { writeFileAtomicallySync } from "@musi/lint-ratchet/kernel/atomic-write.js";

export { writeFileAtomicallySync };

/**
 * Atomic replacement write that first creates the parent directory.
 * The kernel deliberately does not create directories; directory
 * creation is not atomic anyway, so this is a convenience for call
 * sites whose output directory may not exist yet.
 */
export function ensureDirWriteFileAtomicallySync(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileAtomicallySync(path, content);
}
