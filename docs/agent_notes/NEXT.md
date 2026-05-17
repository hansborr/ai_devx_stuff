# Next Up

Promotion pointer for the next human-requested leaf. This file is not a FIFO
queue, and backlog numbering/order is advisory, not permission to keep pulling
work. Parked work stays in `backlog/` unless this file names it or a human
asks for re-triage.

## Ready now

No promoted lint-hardening leaf is ready now. The `chore/codebase_audit`
workstream landed and its iteration index was deleted with the per-leaf notes.
Leaf 2, Leaf 3's Vitest first slice, Leaf 4, and Leaf 19 Pass 2 were completed
when explicitly requested; do not promote another lint-hardening leaf unless a
human asks for that specific next cycle.

Even when this section is empty or idle, do not pull from a backlog's
suggested order without a human asking for that specific next cycle. When a
human does ask, re-run the audit tools below from a fresh checkout and promote
exactly one leaf:

```bash
bun run drift:ai --scope current
bun run test:coverage
bun run test:mutation
```
