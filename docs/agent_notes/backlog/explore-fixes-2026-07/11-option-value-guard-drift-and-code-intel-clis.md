# 11 — Apply the option-value guard to drift-ai / code-intel / drift CLIs

Status: Ready
Track: T (tooling) · Priority: P1 · Size: M
Depends on: 10 (use the same shared helper)

## Evidence (verified 2026-07-03; re-verify before implementing)

- `scripts/drift-ai/arg-readers.ts:15` — option readers accept a `--*` token
  as a value.
- `scripts/code-intel/cli-options.ts:25` — same.
- `scripts/drift/locator-usage.ts:63` — same.

## Do

Adopt the shared option-value guard from leaf 10 across the three CLIs. One
commit is fine if the change stays mechanical; split per-CLI if any call site
needs semantic care. Add `--flag --other-flag` invalid cases to each CLI's
tests. Do not change accepted syntax otherwise (`--opt=value` stays valid).

## Risk note

Touches several independent CLIs — run each CLI's focused tests, and
spot-run one real invocation per CLI (`bun run drift:ai --scope current
--check ghost-files --format text`, a `code:intel` query, `drift:e2e`) to
confirm no legitimate call pattern used an option-looking value.

## Verify

```
bun run test:scripts:file -- scripts/drift-ai/arg-readers.test.ts scripts/drift-ai/subcommand-args.test.ts scripts/drift/locator-usage.test.ts
```

(plus the code-intel option tests; locate with `bun run code:intel -- tests scripts/code-intel/cli-options.ts`)

## Acceptance

All three CLIs reject `--flag --other-flag` sequences with usage errors;
focused tests cover the new cases; no legitimate invocation shape changes.
