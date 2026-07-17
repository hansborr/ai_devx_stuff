# 53 — README describes the wrong normal verification workflow

Status: Done
Track: DOC (docs) · Priority: P2 · Size: XS

> **Confirmed — 2026-07-13 adversarial triage.** The verifier strengthened the finding: pre-push is only a fast-commit provenance backstop and never runs `verify:changed`, while the README omits both the 12-slot generated set and the unstaged-work abort.

## Evidence (verified 2026-07-13; re-verify before implementing)

- `README.md:81` — `verify:changed` is called the default pre-push gate and summarized too narrowly.
- `README.md:99-102` — contributors are told to run it before every push without staging or dirty-worktree constraints.
- `AGENTS.md:46` — pre-commit is the normal verification gate; direct changed verification is for non-commit checks or troubleshooting.
- `scripts/verify/steps.generated.sh:13` — changed mode has twelve generated slots.
- `scripts/lib/verify-metadata.sh:428-451` — source-relevant unstaged or untracked work aborts changed verification.
- `.husky/pre-push` is a fast-commit provenance backstop and does not invoke `verify:changed`.

Failure: New contributors can invoke the command in an invalid state, rerun a broad gate unnecessarily after commit, or be surprised by checks absent from the README summary.

## Do

Align README with AGENTS: pre-commit is normal, `verify:changed` is the staged manual fallback, the generated slot set is authoritative, and source-relevant unstaged work aborts.

## Verify

```
bun run docs:harness-controls:check && rg -n "verify:changed|pre-commit|pre-push" README.md
```

## Acceptance

- README and AGENTS name the same normal gate and manual fallback.
- README points to the generated slot authority and states the staging constraint.
