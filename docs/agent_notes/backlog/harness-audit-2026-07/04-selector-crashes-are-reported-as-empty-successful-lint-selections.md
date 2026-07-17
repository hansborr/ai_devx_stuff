# 04 — Selector crashes are reported as empty, successful lint selections

Status: Done
Track: T (tooling) · Priority: P2 · Size: M

> **Confirmed — 2026-07-13 adversarial triage.** All four wrappers and the shared preflight were re-read. Process substitution hides producer failure, and `path_policy_has_match` fails toward not escalating to a full scan; the existing tri-state staged selector is the pattern to spread.

## Evidence (verified 2026-07-13; re-verify before implementing)

- `scripts/lint-changed.sh:38-43` and `scripts/lint-changed.sh:104-123` — selector output is consumed through process substitution without preserving producer status.
- `scripts/lint-agent-changed.sh:46-51` and `scripts/lint-agent-changed.sh:170-195` — the advisory envelope has the same fail-open shape.
- `scripts/lint-shell.sh:68-74`, `scripts/lint-shell.sh:92-100`, and `scripts/lint-shell.sh:124-130` — failed selection can become an empty successful shell-lint run.
- `scripts/lint-config-sensors.sh:99-104`, `scripts/lint-config-sensors.sh:138-159`, and `scripts/lint-config-sensors.sh:451-461` — sensor selection repeats the pattern.
- `scripts/lib/verify-metadata.sh:398-414` — `musi_staged_has_source_relevant_change` already distinguishes selector failure with result 2.

Failure: If Bun, an import, or `path-policy.ts` fails, standalone changed linting and advisory linting can announce no selected files and exit successfully.

## Do

Capture every selector into guarded output or a temporary file, parse only after success, and reserve a distinct nonzero result for selection failure. Reuse the tri-state convention already present in verify metadata. This complements, rather than replaces, [harness-explore leaf 08](../harness-explore-2026-07/08-shared-changed-file-collection.md).

## Verify

```
bash scripts/tests/test-lint-changed.sh && bash scripts/tests/test-lint-shell.sh && bash scripts/tests/test-lint-config-sensors.sh
```

## Acceptance

- Every changed-lint wrapper fails closed when its selector crashes.
- Empty successful selection remains distinguishable from selector failure.
