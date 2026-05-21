# Leaf 42: Batch 2 review deferred items

Status: Open - surfaced during Leaf 41 Batch 2 reviews (2026-05-20). Three small
items that were intentionally deferred so the Batch 2 stack could merge cleanly.
Each is independently small; they can land as a single combined commit or as
separate follow-ups depending on convenience.

## Items

### 1. `scripts/doctor.sh` missing `cd $REPO_ROOT` for two report helpers

`scripts/doctor.sh:582-585` invokes `bun run sensor:blob-size` and
`bun run harness:check` without the surrounding `cd "$REPO_ROOT"` that the
other report helpers in the same file use. When `doctor.sh` is run from a
subdirectory, these two invocations resolve relative to the caller's working
directory and either skip work or emit misleading diagnostics.

Fix: wrap the two invocations in the same `cd` pattern the surrounding helpers
already use. One-line each.

### 2. Parameterized parser shape test for `getFunctionNameWithKind` variants

Subagent #2's nit during Batch 2's multi-angle review (defensive, not a
correctness gap). `scripts/lint-ratchet-metrics.ts`'s complexity parser handles
a fixed set of function-shape strings (`Function 'foo'`, `Method 'foo'`,
`Arrow function`, etc.) by regex. The test surface in
`scripts/lint-ratchet-baseline.test.ts` doesn't enumerate them — there's no
parameterized test that walks every ESLint `getFunctionNameWithKind` output and
asserts the parser extracts the right label.

Fix: add a table-driven test that iterates a representative list of
`getFunctionNameWithKind` outputs (the upstream rule's source has the full
catalog) and asserts each parses to the expected `{nodeType, label}` pair.
Low risk because ESLint already enforces those strings; the test is insurance
against a future ESLint change reshaping any of them.

### 3. `validateLintRatchetRegistry` complexity 44

The `complexity-severity` ratchet added in
`feature/lint-hardening-lint-ratchet-runtime-complexity-coverage` (merge
`bbe35e0f`) baselined `validateLintRatchetRegistry` in
`scripts/lint-ratchet-baseline.ts` at complexity 44. The cap is 10. The
ratchet's `no-new` mode locks it in at 44 so no further growth can land, but
the existing height is above the >30 follow-up threshold called out in the
coverage commit.

Fix: refactor the registry validator into per-invariant helpers. Each
invariant check (mode allowlisted, metric implemented, source kind matches
ruleId family, scope uniqueness, etc.) becomes its own small function that
the top-level `validateLintRatchetRegistry` calls in sequence. After the
refactor, drop the baseline value via `bun run lint:ratchet:update`.

Not blocking. The ratchet protects against further growth; this is an
opportunistic cleanup to reduce existing height.

## Verification

- `bash scripts/test-verify.sh` (for #1, if the test surface covers
  `doctor.sh` — otherwise spot-check from a subdirectory)
- `bash scripts/vitest.sh run scripts/lint-ratchet-baseline.test.ts` (for #2)
- `bun run lint:ratchet` (for #3, to confirm the lowered baseline)
- `bun run lint:ratchet:check-baseline`
- `bun run typecheck`
