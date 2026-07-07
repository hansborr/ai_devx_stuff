# 12 — Enforce commit scope in commitlint

Status: Ready
Track: T (tooling) · Priority: P2 · Size: XS

## Evidence (verified 2026-07-03; re-verify before implementing)

- `AGENTS.md:42` — documents the enforced contract as
  `<type>(<scope>): <subject>` with subject ≥ 20 chars and body ≥ 40.
- `commitlint.config.js:42-54` — extends config-conventional and enforces
  `subject-min-length` 20 / `body-min-length` 40 / `body-empty` never,
  but sets no `scope-empty` rule; config-conventional leaves scope
  optional. `feat: a sufficiently long subject line` with a 40-char body
  passes the hook today despite the documented shape.

Adversarial-triage resolution: tighten commitlint rather than soften
AGENTS.md — recent history is consistently scoped and the documented
workflow already treats `(scope)` as mandatory.

## Do

Add `"scope-empty": [2, "never"]` to `commitlint.config.js` (consider
`"scope-case": [2, "always", "kebab-case"]` if history conforms). Before
committing, sweep recent history for scopeless subjects
(`git log --format=%s -200 | grep -vE '^\w+\(.+\): |^Merge '`) to confirm
the rule matches practice; commitlint's default ignores already exempt
merge/revert messages.

## Verify

```
printf 'feat: subject with no scope but plenty long\n\nbody long enough to satisfy the forty character minimum rule\n' | bunx commitlint && echo UNEXPECTED-PASS || echo expected-fail
printf 'feat(scope): subject with a scope and plenty long\n\nbody long enough to satisfy the forty character minimum rule\n' | bunx commitlint
```

## Acceptance

Scopeless conventional commits are rejected by the `commit-msg` hook;
scoped commits and merge commits still pass; AGENTS.md needs no change.
