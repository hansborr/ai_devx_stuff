# 31 — Max-lines checker silently ignores unknown options

Status: Done
Track: T (tooling) · Priority: P3 · Size: XS

> **Amended — 2026-07-13 adversarial triage.** P2 was deflated to P3 and the window was narrowed. A misspelled `--update` exits 2 when normalization is needed; silent success occurs on clean baselines and with informational flags such as `--help`.

## Evidence (verified 2026-07-13; re-verify before implementing)

- `scripts/max-lines-exceptions.ts:233` — mode selection is only `argv.includes("--update")`.
- `scripts/max-lines-exceptions.ts:260-261` — a dirty baseline can make accidental check mode fail loudly, limiting the silent case.
- `scripts/max-lines-exceptions.ts:274-276` — raw arguments reach the entry point without strict parsing.

Failure: On a clean baseline, an unknown option or help request can exit 0 with ordinary check output, making callers believe a requested mode ran.

## Do

Add a strict parser for default mode, `--update`, and `--help`; reject unknown or conflicting arguments with exit 2 and concise usage.

## Verify

```
bun run test:scripts:file -- scripts/max-lines-exceptions.test.ts
```

## Acceptance

- Unknown and conflicting options exit 2.
- `--help` prints usage without running the baseline check.
