# 72. Single-rule probing requires a hand-written repo-root scratch config — ship a probe command

Status: Done — added `bun run lint:probe-rule` plus guide and smoke coverage.
Lens: docs · Area: rule-authoring DX · Severity: low · Size: S · Confidence: high
Theme: authoring-ergonomics · Source: Musi lint deep-dive 2026-07-04 (3 parallel Codex xhigh lanes + Claude verification agents)

## Problem
The documented workflow for probing one local rule under the flat config asks
the user to write an `eslint.probe.mjs` at repo root and delete it afterward.
That is friction for exactly the audience local rules target (agents
iterating on a rule), pollutes the worktree during read-only investigation,
and is easy to leave behind (it would then be an untracked config file —
tripping the changed-gate's untracked-source abort).

## Evidence
- `docs/guides/local-eslint-rules.md:124-137,177` — the scratch-file recipe. Verified 2026-07-04.

## Proposed direction
Small `bun run lint:probe-rule -- <local/rule-name> <file...>` (or
`--stdin --filename` for snippet probes) that builds the single-rule flat
config in memory — the ratchet's generated-config machinery
(`scripts/lint-ratchet/eslint-config.ts`) already knows how — and prints
findings. Update the guide to lead with the command and demote the scratch
recipe to a footnote.

## Scope / caveats
- Reuse, don't fork, the ratchet's config writer; divergent probe vs ratchet
  semantics would be worse than the scratch file.
- One commit: script + package script + guide edit + smoke test (respecting
  leaf 42's registration story).
