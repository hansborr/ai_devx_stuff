# 16 — `generate-hook-wiring` atomic writer should create output directories

Status: Ready
Track: T (tooling) · Priority: P2 · Size: XS

## Evidence (verified 2026-07-03; re-verify before implementing)

- `scripts/harness/generate-hook-wiring.ts:279` — `writeFileAtomic` writes
  without ensuring the parent directory exists.
- `scripts/harness/generate-hook-wiring.ts:312` — only the Copilot output dir
  is explicitly created; `.claude`/`.codex` targets rely on the directory
  pre-existing, so bootstrap fixtures (or fresh checkouts of derived repos)
  fail inconsistently depending on which outputs are enabled.

## Do

Create the parent directory (recursive mkdir) inside `writeFileAtomic`,
remove the now-redundant Copilot-specific mkdir, and add a generator test
that writes into a bare temp root with no pre-created dirs.

## Verify

```
bun run test:scripts:file -- scripts/harness/generate-hook-wiring.test.ts
```

## Acceptance

Generation succeeds from a bare temp root for every configured output; no
behavior change when directories already exist.
