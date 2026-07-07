# 19 — `chmod +x .husky/post-commit` for hook-file consistency

Status: Ready
Track: T (tooling) · Priority: P2 · Size: XS

## Evidence (verified 2026-07-03)

- `.husky/post-commit` is mode `644`; every sibling (`commit-msg`,
  `pre-commit`, `pre-push`, `post-checkout`, `post-merge`) is `755`.

**This is cosmetic, not functional** — fact-checked during pack triage:
`core.hooksPath` points at `.husky/_`, whose executable shims invoke the
user hook via `sh -e "$s"` (`.husky/_/h:17`), so Git never consults this
file's exec bit and the hook DOES run today. (An earlier triage pass claimed
Git skips it; that claim is wrong — do not use it as the rationale.)

## Do

`chmod +x .husky/post-commit`, commit the mode change. Nothing else.

## Verify

```
test -x .husky/post-commit && git diff --summary HEAD~1 | grep 'mode change'
```

## Acceptance

All `.husky/*` hook files share mode 755; no behavior change.
