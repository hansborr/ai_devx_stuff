# Leaf 21: eslint-plugin-regexp

Status: Pass 2a landed (2026-05-16); 3 rules deferred to Pass 2b.
Depends on: Leaf 8 for full scripts coverage, unless scoped only to the TS
files ESLint already covers.

Dependency detail: Leaf 8 is needed only for global regex coverage over
scripts. If promoted before Leaf 8, scope to already-linted TS files and record
scripts as deferred. If Leaf 1 has not landed, avoid committing
warning-severity rules such as `prefer-named-capture-group`; either leave them
out of the subset or promote them deliberately after the zero-warning gate.

## Problem

AI-generated regexes have predictable mistakes: catastrophic backtracking,
unintended character classes (`[A-z]` instead of `[A-Za-z]`),
unnecessary escapes, missing flags, and dead branches.

`eslint-plugin-regexp` adds a focused, type-aware set of rules that catch
these issues at lint time.

## Rule Goals

Enable `regexp/recommended`. Notable rules:

- `regexp/no-misleading-capturing-group`
- `regexp/no-super-linear-backtracking` (catastrophic backtracking)
- `regexp/no-useless-escape`
- `regexp/no-useless-character-class`
- `regexp/no-dupe-disjunctions`
- `regexp/prefer-named-capture-group` (warn; project preference)

## Possible Outcomes

- **Adopt recommended (expected default).** Recommended is correctness-
  focused and largely auto-fixable.
- **Adopt subset.** Drop `prefer-named-capture-group` if it has too many
  intentional sites; that rule is closer to style than correctness.
- **Reject.** Only if the inventory is empty — Musi has few regexes, so a
  zero-finding inventory is a reasonable verdict to record in
  `evaluation-verdicts.md` and park.

## Rollout

1. Install `eslint-plugin-regexp`. Add to global config only after Leaf 8
   covers scripts; otherwise scope the plugin to the package TS files ESLint
   already covers and record that scripts are deferred.
2. Run as inventory. Expect mostly auto-fixable findings.
3. Auto-fix, hand-fix the rest, land.
4. Promote to `error`.

## Verification

- `bun run lint -- --max-warnings=0`
- `bun run verify:changed`
- Targeted tests for any regex-touched code paths.
- If the plugin is rejected, deferred, subset-adopted, or fully adopted with
  caveats/scoped exceptions, append a row to `evaluation-verdicts.md` before
  closing the leaf.

## Implementation Result

Pass 1 temporarily installed `eslint-plugin-regexp@3.1.0` and probed
`regexp.configs["flat/recommended"]` on the existing `codeFiles` ESLint glob,
with `regexp/prefer-named-capture-group` explicitly overridden to `off`.

The probe command was:

```bash
bun run lint -- --max-warnings=0 2>&1 | tee /tmp/leaf21-probe.log
```

Result: 35 problems (33 errors, 2 warnings) across 20 reported regex line
sites, exceeding the leaf's `>15` stop threshold. The dominant blocker was
`regexp/no-super-linear-backtracking` with 24 findings across parser, seed,
and code-intel regexes that need semantic review and targeted tests. The
temporary dependency/config was reverted, no regex fixes were made, and the
Pass 1 inventory is recorded in
`docs/agent_notes/finished_work/lint-hardening-leaf-21-regexp-inventory.md`.

Pass 2a re-added `eslint-plugin-regexp@3.1.0` and adopted
`regexp.configs["flat/recommended"]` for code files. The upstream recommended
rules that shipped at `warn` were promoted to `error` to preserve the
zero-warning lint gate. Three semantic-review rules remain explicitly off:
`regexp/no-super-linear-backtracking`, `regexp/no-misleading-capturing-group`,
and `regexp/no-contradiction-with-assertion`.

Pass 2a cleaned the mechanical subset to zero: 5
`regexp/no-dupe-characters-character-class` auto-fixes, 2
`regexp/no-useless-flag` auto-fixes, 1 `regexp/prefer-d` auto-fix, and 1
`regexp/no-unused-capturing-group` hand-fix in
`scripts/code-intel/cli-values.ts`. `regexp/prefer-named-capture-group`
remains explicitly off as style-only.

## Followups

Pass 2b should handle the deferred backtracking cluster as a focused semantic
rewrite leaf. Cover the seed parsers, spell block extractors, glossary entry
parser, monster comma-pair parser, and graph-cache gitfile parser with targeted
tests before enabling `regexp/no-super-linear-backtracking`,
`regexp/no-misleading-capturing-group`, and
`regexp/no-contradiction-with-assertion`.

## References

- [eslint-plugin-regexp](https://github.com/ota-meshi/eslint-plugin-regexp)
