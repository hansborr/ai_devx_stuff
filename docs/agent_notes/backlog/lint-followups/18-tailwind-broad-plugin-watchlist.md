# Leaf 18: Tailwind And Broad Plugin Watchlist

Status: Informational
Sources:

- `docs/agent_notes/backlog/lint-hardening/26-tailwind-v4-status.md`
- `docs/agent_notes/backlog/lint-hardening/27-broad-plugin-evaluations.md`
- `docs/agent_notes/backlog/lint-hardening/evaluation-verdicts.md`

## Problem

Two categories should stay visible without becoming accidental work queues:

- Tailwind v4 lint plugins are still maturing.
- Broad plugins such as Unicorn, SonarJS, and Promise are too noisy to adopt
  wholesale.

## Scope

This leaf is a watchlist, not a promotion target unless new evidence appears.

Tailwind revisit triggers:

- upstream `eslint-plugin-tailwindcss` ships stable v4 support, or
- a community alternative has clear adoption signals and low issue churn, or
- a concrete Tailwind class bug postmortem names a rule or sensor that would
  have caught it.

Broad-plugin revisit triggers:

- a specific postmortem, code review, or AI-output audit names a rule
  candidate,
- existing core/typescript-eslint/local rules do not cover it, and
- the candidate has a clean diagnostic and sanctioned fix path.

## Candidate Work

- For Tailwind, prefer no-regret formatting or a tiny repo-owned typo sensor
  only if there is concrete evidence.
- For broad plugins, evaluate one rule at a time in a throwaway config.
- Record reject/defer/subset outcomes in the verdict register.

## Exit Criteria

- Usually none. Keep parked unless there is new evidence.
- If a specific rule is trialed, split it into its own leaf with inventory and
  verification.

## Verification

- N/A for watchlist status.
- Any trial leaf should run `bun run lint -- --max-warnings=0`,
  targeted tests for fixes, and `bun run verify:changed`.
