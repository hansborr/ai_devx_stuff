# 23 — `no-commented-out-code`, calibrated to operative multi-line regions

Status: Done — merged via `ab318d05` / `4528e972` (lint-adoption pack).
Track: L (lint rules) · Priority: P1 · Size: S
Created: 2026-07-15

> 06 said P0, 07 said P2 with a calibration warning, 08 said P1. Adjudicated
> P1 with codex's calibration adopted: the heuristic is noise-prone, so scope
> it tightly.

## Evidence

- Abandoned alternatives left in comments poison the *next* agent's context —
  a compounding harness problem, not just hygiene: the next model treats the
  dead branch as a live option or resurrects it.
- Musi has no rule in this space today; the natural sibling
  `local/no-llm-artifacts` (`eslint-rules/no-llm-artifacts.js`) catches diff
  placeholders and stubs but not commented-out code blocks.

Failure: agents (and humans) leave `// const old = ...` blocks behind; nothing
flags them; later agents read them as context.

## Do

1. Add a local rule (or adopt+wrap an existing plugin implementation) that
   flags **only multi-line comment regions that parse as operative code** —
   ratchet those; leave single-line snippets, protocol examples, and doc
   comments advisory or untouched.
2. Position it as a sibling of `no-llm-artifacts`: same message conventions,
   same restricted-disable consideration.
3. Full-scan probe first to size the debt; expect a ratchet entry rather than
   hard-error.

## Verify

```
bun run lint:probe-rule
bun run lint:eslint-rules
bun run lint:ratchet:check-baseline
```

## Acceptance

- A multi-line commented-out code block in changed files fails at commit
  time; existing regions are frozen in the ratchet.
- JSDoc examples, single-line snippets, and prose comments produce zero
  findings across the current tree (the calibration requirement).
