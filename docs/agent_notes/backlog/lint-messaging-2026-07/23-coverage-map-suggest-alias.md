# 23. Stable alias for coverage-map `--suggest` + reference it everywhere

Status: Done — implemented on lane/lint-msg-coverage-bridge-fix. Re-verified file:line before acting.
Lens: sensors · Area: discoverability · Severity: med · Size: S · Confidence: med
Theme: copy-pasteable-remedy · Source: Musi lint-messaging review 2026-07-05 (5 Sonnet agents + Fable verification)

## Problem
The coverage-map checker's `--suggest` mode is one of the most actionable
remedies in the repo (fully-formed, ready-to-paste table rows with derived
status columns) — but it has no `package.json` alias. The failure text
tells agents to run `bun run scripts/lint-coverage-map-check.ts --suggest`,
a raw script path, while every sibling remedy in the system is a stable
`bun run <alias>` command. Separately, the `lint-coverage-check` hook's
uncovered-file WARNING describes three manual steps (eslint.config.js,
tsconfig, coverage-map row) without mentioning `--suggest` at all.

## Evidence
- `scripts/lint-coverage-map-check-findings.ts:75-85` — failure text with
  the raw script path.
- `package.json` (~:97, `docs:lint-coverage-map:*` block) — no `:suggest`
  alias (report-sourced; confirm).
- `scripts/ai-hooks/lint-coverage-check.sh:135-142` — uncovered-tier
  advisory, three manual steps, no suggest pointer.

## Proposed direction
Add `docs:lint-coverage-map:suggest` to `package.json`, then update both
references: the checker's failure text and the hook advisory's
uncovered tier ("run `bun run docs:lint-coverage-map:suggest` for a
ready-to-paste row" — the eslint.config/tsconfig steps stay, since suggest
can't do those).

## Scope / caveats
- New package script: check whether the harness manifest / coverage-map
  rows / path-policy need a registration entry for it (see memory of
  config-registration failures — a script alias may be exempt, but
  confirm against `harness.controls.json` conventions before landing).
- Keep the alias name in the `docs:lint-coverage-map:*` family for
  discoverability in `bun run` listings.
