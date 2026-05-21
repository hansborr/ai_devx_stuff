# Leaf 19 Slice 2 Deferral: scripts/generate-harness-controls.ts

Status: Deferred - verdict in register dated 2026-05-19.
Generated 2026-05-19 against
feature/lint-hardening-leaf-19-generate-harness-controls.
Probe: temporary inclusion in `eslint.config.js` then targeted
`bunx eslint scripts/generate-harness-controls.ts` run.

Scope: candidate to extend ESLint coverage to the next sibling file
after Leaf 19 slice 1 (`scripts/lint-rule-docs.ts`). The probe was
reverted; no production code or lint config changes landed.

## Resolution

- Verdict: **defer**. Adding `scripts/generate-harness-controls.ts` to
  the linted scripts subset surfaces two findings; this autonomous slice
  was scoped to mechanical coverage adoption only, not to refactor the
  generator or to introduce a new warn-only override entry on this
  agent's judgment alone.
- The `local/max-lines` diagnostic itself offers two repair paths
  (split the module into focused helpers/types, or add a targeted
  warn-only `eslint.config.js` override just above the current line
  count with a comment explaining the exception). Either path is a
  valid local decision — this slice declined to make either decision
  unilaterally and parks the choice for a future leaf with explicit
  budget.

## Inventory probe

```bash
bunx eslint scripts/generate-harness-controls.ts --no-warn-ignored
```

Findings (2):

```text
scripts/generate-harness-controls.ts
  177:1  error  Function 'resolveNonLintControl' has a complexity of 13.
                Maximum allowed is 10                                          complexity
  339:1  error  Why: This file has 384 effective lines, above the 300 line
                limit, which makes future edits harder to localize. How to
                fix: Prefer splitting the module into focused components,
                helpers, or types. If it should stay larger for now, do not
                use eslint-disable; add or adjust a targeted
                eslint.config.js override for this exact file with
                `local/max-lines` set to `warn`, choose a modest max just
                above the current count, and keep the existing comment
                pattern explaining the exception                                local/max-lines
```

## Why defer

- `resolveNonLintControl` cyclomatic complexity is 13 vs the 10 ceiling.
  Reducing it requires extracting helpers or rewriting the dispatch — a
  judgment call about the right split, not a mechanical edit.
- File length is 384 vs the 300 `local/max-lines` ceiling. The
  diagnostic supports either a structural split or a targeted warn-only
  override. Choosing between those repair paths is the local debt
  decision this slice did not make.
- Both findings would persist unless either:
  1. The file is refactored (substantial engineering with smoke-test
     re-coverage), or
  2. A targeted warn-only override is added with an explanatory
     comment (introduces a new debt entry that this autonomous slice
     declined to take on its own).

## Revisit triggers

- A planned refactor of `scripts/generate-harness-controls.ts` lands
  on its own (e.g., as part of broader scripts maintenance), at which
  point lint coverage becomes a no-op trailing addition.
- A repo-wide decision changes the `local/max-lines` ceiling or
  complexity ceiling for generator scripts.
- A future leaf has explicit budget for a structural refactor of this
  generator and pairs the refactor with coverage adoption in one
  commit.

## Next narrow candidate

`scripts/lint-rule-docs.ts` was the sibling-of-an-already-linted file
and landed in Leaf 19 slice 1. The next narrow candidates without
architectural blockers are unknown without probing each individually;
broader script families (codemods, drift-ai, logs-audit, top-level
utilities) remain parked in Leaf 19 and Leaf 11.
