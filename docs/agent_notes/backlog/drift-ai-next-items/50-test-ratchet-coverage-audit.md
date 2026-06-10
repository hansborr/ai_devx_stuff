# 50 - drift-ai test-ratchet coverage audit

Status: Done
Track: G
Size: small
Depends on: none
Blocks: none

## Goal

Audit whether newer `scripts/drift-ai/*.test.ts` files should be enrolled in the
drift-ai Vitest ratchet families or explicitly documented as intentionally out of
those families.

## Background

The old audit note names examples such as `adapter-support.test.ts`,
`knip-orphan-files.test.ts`, `finding-lines.test.ts`, and `source-walk.test.ts`.
The current lint coverage map has more drift-ai family rows, but the ratchet
baseline still includes only a selected subset in
`ratchet/vitest-expect-expect-drift-ai-tests` and
`ratchet/vitest-valid-expect-drift-ai-tests`.

## Seams to touch

- `lint-ratchet.baseline.json`
- `scripts/lint-ratchet-config.ts`
- `docs/agent_notes/backlog/lint-followups/lint-coverage-map.md`
- `docs/generated/harness-controls.md`, only through the normal generator

## What to do

1. Inventory all current `scripts/drift-ai/*.test.ts` files.
2. Compare against drift-ai Vitest ratchet family file lists.
3. Decide one of:
   - add missing files to the existing drift-ai families;
   - create a separate family for adapter/helper tests;
   - leave some files out and document why in the coverage map.
4. Regenerate/update ratchet baseline and generated controls through existing
   scripts.
5. Keep the change focused; do not broaden normal ESLint coverage in the same
   task unless it is already part of the selected lint follow-up.

## Testing

- `bun run lint:ratchet`
- generated harness controls check if the manifest changes
- any focused script smoke required by changed-file selection.

## Out of scope

- Draining unrelated lint debt.
- Reworking drift-ai tests.
- Changing ratchet policy globally.

## Completion notes

- Audited tracked drift-ai tests with `git ls-files 'scripts/drift-ai*.test.ts' 'scripts/drift-ai/**/*.test.ts'`.
- Enrolled the maintained drift-ai test family in the existing
  `ratchet/vitest-expect-expect-drift-ai-tests` and
  `ratchet/vitest-valid-expect-drift-ai-tests` controls via
  `scripts/drift-ai.test.ts` plus `scripts/drift-ai/**/*.test.ts`.
- Kept `scripts/drift-ai/fixtures/**` intentionally out of those ratchets as
  synthetic fixture data.
- Regenerated `lint-ratchet.baseline.json`; the widened drift-ai test ratchets
  stayed at zero findings.
