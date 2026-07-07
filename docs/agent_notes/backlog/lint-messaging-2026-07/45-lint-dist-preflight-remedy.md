# 45. lint-dist-preflight: dead-end remedy + divergence note

Status: Done — implemented 2026-07-05; lint-dist preflight now explains the post-typecheck missing-output remedy and documents the lint:fix reporting-only path.
Lens: gates · Area: actionability · Severity: low-med · Size: S · Confidence: med
Theme: remedy-in-message · Source: Musi lint-messaging review 2026-07-05 (5 Sonnet agents + Fable verification)

## Problem
Two gaps in the same helper:
(a) The terminal failure branch — "`bun run typecheck` completed, but
required build output is still missing" — is the one dead end in the file:
no next step at all.
(b) The same missing-dist condition behaves differently per caller:
`musi_lint_dist_preflight` (lint path) auto-runs `bun run typecheck`;
`musi_lint_dist_require_outputs` (lint-fix path) just tells you to run it
yourself. No comment explains whether the asymmetry is intentional, so a
future editor will "unify" it blind.

## Evidence
- `scripts/lib/lint-dist-preflight.sh:100-105` — the no-remedy branch.
- `scripts/lib/lint-dist-preflight.sh:60-77` vs `:79-106` — the two
  behaviors.

## Proposed direction
(a) Add a remedy hint to the dead-end branch: the plausible causes are a
tsconfig `composite`/`outDir`/references misconfiguration or a package
whose build products land elsewhere — name the check ("compare the missing
path against the owning package's tsconfig `outDir`") and/or point at the
relevant guide.
(b) Either unify the two callers' behavior or add a one-line comment
stating why lint auto-repairs and lint-fix doesn't (likely: lint-fix
mutates files, so silently running a build first is riskier — verify
before asserting).

## Scope / caveats
- Related parked note exists: `docs/agent_notes/backlog/
  lint-fix-dist-preflight-parity.md` — read it first; if it already
  records the divergence decision, (b) reduces to cross-linking it in a
  comment.
