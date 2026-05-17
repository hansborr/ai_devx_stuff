# Leaf 18: Adjacent Structural Sensors

Status: Parked
Depends on: early lint leaves preferred

## Problem

Some repo-quality controls act like lint for agents but should not become
ESLint rules. They need focused scripts, report-only rollout, repair text, and
eventual narrow gates only when the baseline is low-noise.

## Candidate Sensors

- ASCII/smart-character hygiene for hot docs such as `AGENTS.md`,
  `docs/agent_notes/STATUS.md`, `docs/agent_notes/NEXT.md`,
  `docs/ai-harness.md`, architecture docs, and guide files. Provide a fix mode
  for smart quotes, non-breaking spaces, ellipses, and dash variants.
- Staged blob-size policy for accidentally committed large assets. Require a
  reasoned allowlist entry for intentional blobs; keep generated reports and
  screenshots ignored rather than allowlisted when possible.
- Spell-check for Markdown, docs, and possibly user-facing copy, using a small
  domain dictionary. Start manual or doctor-surfaced; gate staged Markdown only
  after the dictionary is low-noise.
- Harness inventory freshness: verify every `docs/guides/*.md` is referenced by
  `docs/ai-harness.md`, and every backtick-quoted repo path in the inventory
  still exists. Keep it warn-only until the inventory is clean and stable.
- Optional architecture-boundary config checks only where ESLint import rules
  cannot express a rule cleanly. Musi already has many local architecture
  lints, so do not add a second boundary system unless it removes duplication
  or covers non-TypeScript surfaces.

## Rollout

1. Add one sensor at a time as a script with shell/unit tests.
2. Surface it from `doctor` or a report-only command first.
3. Gate only narrow, low-noise subsets in pre-commit, such as staged Markdown
   spell-check or staged blob-size checks.
4. Add the sensor to `docs/ai-harness.md` with repair text before making it a
   gate.

## Best First Candidates

Start with ASCII/smart-character checks for hot docs, then blob-size. Spell
checking is useful but usually needs dictionary cleanup before it is quiet
enough to gate.

## Verification

- `bun run test:scripts:changed`
- Targeted script tests for report, JSON, output, fix mode, and checked mode as
  applicable.
- `bun run drift:ai --scope current` if the sensor is integrated with harness
  reporting.
- `bun run verify:changed`
- If a sensor is rejected, deferred after inventory, or lands with notable
  caveats/allowlists, append a row to `evaluation-verdicts.md`.
