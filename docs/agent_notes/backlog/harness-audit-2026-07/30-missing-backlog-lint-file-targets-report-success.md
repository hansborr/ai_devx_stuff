# 30 — Missing `backlog:lint --file` targets report success

Status: Done
Track: T (tooling) · Priority: P3 · Size: XS

> **Amended — 2026-07-13 adversarial triage.** P2 was deflated to P3 because the tool is advisory and wired into no gate. The reproduced exit 0 still misleads task triage when a target is mistyped.

## Evidence (verified 2026-07-13; re-verify before implementing)

- `scripts/backlog-lint.ts:89-99` — missing, non-file, and non-Markdown explicit paths are silently mapped to an empty file set.
- `scripts/backlog-lint-format.ts:50-51` — zero checked files are formatted as a successful `OK` result.
- A missing `--file` target reproduced exit 0 with `OK - 0 note(s) checked`.

Failure: A typo looks like successful validation of the intended backlog note even though nothing was inspected.

## Do

Validate every explicit `--file` operand before linting. Report missing, non-file, and wrong-extension paths and exit 2.

## Verify

```
bun run test:scripts:file -- scripts/backlog-lint.test.ts
```

## Acceptance

- Every invalid explicit target exits 2 and identifies the operand.
- An explicitly selected valid Markdown file retains current lint behavior.
