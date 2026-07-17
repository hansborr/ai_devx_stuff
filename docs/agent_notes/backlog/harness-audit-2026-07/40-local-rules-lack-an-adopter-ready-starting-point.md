# 40 — Local rules lack an adopter-ready starting point

Status: Done
Track: T (tooling) · Priority: P2 · Size: M

> **Confirmed — 2026-07-13 adversarial triage.** The guide, 23-rule registration surface, and examples tree were re-read. Existing material teaches Musi’s internal conventions or the ratchet, not a minimal external local-rule setup.

## Evidence (verified 2026-07-13; re-verify before implementing)

- `docs/guides/local-eslint-rules.md:3-10` — the guide is framed around internal authoring conventions.
- `docs/guides/local-eslint-rules.md:125-143` — “Adding A New Rule” requires Musi-specific registration, documentation, and test surfaces.
- `eslint-config/local-plugin.js:27-52` — all 23 production rules are registered together.
- `examples/` contains a ratchet demo but no neutral local-rule starter.

Failure: Adopters must reverse-engineer the minimum metadata contract, flat-config plugin registration, RuleTester setup, dependencies, and message guidance from production code.

## Do

Add a compact external-adoption section or `examples/local-eslint-rule-starter/` with one neutral rule, plugin registration, focused tests, metadata/message conventions, dependencies, and commands. Mark generic pieces separately from Musi integration.

## Verify

```
bun run docs:lint-guidance:check && bun run lint:eslint-rules
```

## Acceptance

- A reader can copy one minimal rule and run its tests without Musi-only paths.
- The starter explains which files are portable and which are repository integration.
