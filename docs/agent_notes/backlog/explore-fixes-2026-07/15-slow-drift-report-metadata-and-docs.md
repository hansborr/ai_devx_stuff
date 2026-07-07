# 15 — Stamp slow-drift artifacts with run metadata; document staleness

Status: Ready
Track: T (tooling) · Priority: P1 · Size: S

## Evidence (verified 2026-07-03; re-verify before implementing)

- `scripts/slow-drift-audit.sh:40` — producers capture no run metadata
  (generated-at, HEAD, command, Bun version).
- `.gitignore` ignores `reports/`, so artifacts are local-only; the checked
  workspace currently holds producer output from 2026-06-05 citing paths that
  have since moved — stale reports masquerade as current findings
  (`reports/slow-drift/producers/drift-ai.txt`).
- `docs/ai-harness.md:277` — documents the `reports/slow-drift/*` outputs
  without warning that they are gitignored, local, and possibly stale.

(The stale, undated `reports/mutation/TRIAGE.md` is the same failure mode; a
mutation-summarizer rework is already tracked in
`../ai-harness-prioritized-backlog.md` — do not expand this leaf into it.)

## Do

Write a small metadata header (generated-at, HEAD SHA, command line, Bun
version) into each slow-drift envelope/producer/fused artifact, plus a
stale-HEAD warning when a consumer reads a report whose recorded SHA is not
an ancestor of HEAD — the cheap version is a header line the human/agent
sees on open. Add one short "local artifacts may be stale — rerun or use the
CI artifact" note at the `docs/ai-harness.md` slow-drift section.

## Risk note

Keep verification cheap: test the header via fixtures, do not run real
producers in the test.

## Verify

```
bash scripts/tests/test-slow-drift-audit.sh
```

## Acceptance

Fresh artifacts carry the metadata header; the docs section carries the
staleness warning; tests pin the header format.
