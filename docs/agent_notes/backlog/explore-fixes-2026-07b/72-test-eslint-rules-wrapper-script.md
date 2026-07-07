# 72 — Route rule-guide test commands through the repo Vitest wrapper

Status: Ready
Track: T (tooling) · Priority: P2 · Size: S

## Evidence (verified 2026-07-03; re-verify before implementing)

- `docs/guides/change-rules-logic.md:48` and
  `docs/guides/local-eslint-rules.md:117` — both recommend raw
  `bun run vitest run ...` invocations.
- `scripts/vitest.sh:1-6` — the repo-owned wrapper exists precisely so
  runs get output filtering and the stale-dist preflight; package scripts
  route through it.
- `README.md:89` — documents focused wrapper usage.

Guide-followers bypass the wrapper and lose the stale-dist preflight —
the exact phantom-failure class the preflight was added to catch.

## Do

Add a `test:eslint-rules` package script that routes through
`scripts/vitest.sh` (mirror the existing focused-test scripts), then
update both guides to use it (or plain `bun run test -- <file>` where a
focused file run is what's wanted). Adding a package script can trip the
bun-run-quiet allowlist drift check — classify the new script there
deliberately if flagged. Run the full changed-mode gate since this
touches package.json wiring.

## Verify

```
bun run test:eslint-rules -- eslint-rules/no-barrel.test.js && bun run verify:changed
```

(Stage intended changes before `verify:changed`.)

## Acceptance

Both guides route rule-test runs through repo wrappers; the new script
behaves like the other `scripts/vitest.sh`-backed test scripts; no guide
recommends bare `bun run vitest` anymore.
