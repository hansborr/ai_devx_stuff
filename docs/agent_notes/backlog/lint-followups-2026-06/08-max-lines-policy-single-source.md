# Single-Source The Max-Lines Policy

Status: Done (2026-06-12, landed in "feat(lint): add lifecycle labels to the
single-source max-lines policy")
Order: 08
Source: promoted from the lint-review-2026-06 watchlist ("Max-lines
policy and lifecycle ... 03l has landed, so this is now promotion-ready"),
2026-06-12 re-triage.

## Context

`docs/agent_notes/eslint-max-lines-policy.md` is the active policy
reference, but the machine-readable pieces live scattered: large-file
caps and ignores in the ESLint config layers, reasons in comments, and no
lifecycle labels. The watchlist asks for single-sourcing caps, ratchet
ignores, reasons, and lifecycle labels (`temporary`, `permanent`,
`candidate-for-split`) before any reporting is built on top. The
complexity and max-lines ratchet families are fully drained, so this is a
config-shape refactor, not a debt drain.

## Scope

- Inventory every place a max-lines cap, exemption, or reason currently
  lives (`rg "max-lines" eslint-config/ eslint-rules/ scripts/ docs/`).
- Design one declarative source (likely a single policy module under
  `eslint-config/` consumed by the rule config and any sensor) carrying:
  path/glob, cap, reason, lifecycle label.
- Migrate existing entries with their current reasons; anything without a
  recoverable reason gets `candidate-for-split` and a TODO-free,
  dated reason string.
- Update `eslint-max-lines-policy.md` to describe the new single source;
  the existing `eslint-rules/max-lines-policy.test.js` and
  `scripts/lint-ratchet/max-lines-policy.ts` surfaces must consume, not
  duplicate, it.
- Reporting on top of the labels is explicitly out of scope (watchlist
  keeps that gated on this landing first).

## Definition Of Done

One module is the only place a max-lines exemption can be declared;
policy doc, rule config, and tests all read from it; lint and policy
tests pass unchanged in behavior.

## Verification

- `bun run lint -- --max-warnings=0` with identical findings before/after
  (capture both runs).
- Max-lines policy tests pass; coverage-map check passes.
- `bun run verify:changed`.

## Notes (2026-06-12)

- Surprise: the "scattered config" premise was already stale. A prior leaf
  had centralized caps/ignores/reasons into one object
  (`eslint-config/shared-policy.js::maxLinesPolicy`), and the ratchet script
  + policy test already consume it without duplication. The only genuine gap
  was the **`lifecycle` label**, so this leaf reduced to adding that field
  (and its type + test wiring), not a de-scatter refactor.
- Added `lifecycle` ∈ {`temporary`,`permanent`,`candidate-for-split`} to all
  22 exceptions, the ambient `.d.ts` type, and a validating assertion in
  `max-lines-policy.test.js`. Classification rule: explicit future
  split/extraction/refactor language → `candidate-for-split` (13 entries);
  data tables / schema mirrors / canonical fixtures / harnesses / bounded
  glue → `permanent` (9 entries); no entry warranted `temporary`.
- All 22 reasons were already present and recoverable, so the leaf's
  "synthetic dated reason for unrecoverable entries" clause was a no-op.
- Byte-identical ESLint behavior: the only behavioral consumer
  (`code-quality-configs.js`) destructures `{path, cap, severity}` and
  ignores the new field; `max-lines-policy.ts` never reads `.exceptions`.
- Out of scope (still gated): reporting/dashboards on the lifecycle labels.
