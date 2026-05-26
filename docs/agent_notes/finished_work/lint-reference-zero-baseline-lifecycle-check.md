# Lint Reference Zero-Baseline Lifecycle Check

Implemented `docs/agent_notes/backlog/lint-reference-readiness/11-zero-baseline-lifecycle-check.md`.

- `bun run lint:ratchet:zero-baseline` now exits non-zero when any zero-baseline ratchet lacks `zeroBaselineDisposition`.
- The zero-baseline audit still prints the markdown lifecycle report, and now prints a concise stderr failure list for undocumented ratchets.
- `verify`, `verify:changed`, `verify:parallel`, pre-commit, and CI now run the zero-baseline lifecycle check after `lint:ratchet`.
- `harness.controls.json`, the generated harness controls map, and harness-check fixtures include the new `zero-baseline` wrapper slot.
- The lint-ratchet guide now documents the command as a gate.
