# Ratchet Local-Rule Message Parity

Status: Done (2026-06-12, landed in "fix(lint): carry ratchet local rule guidance")
Order: 09
Source: Change F from the historical lint message-improvements plan, carried
forward during the 2026-06-11 lint backlog cleanup.

## Context

The `lint:agent` envelope now uses `scripts/lint-agent-fix-text.ts` to surface
the resolved local-rule repair text. `lint:ratchet` still builds local-rule
regression `howToFix` strings from `meta.docs` plus generic ratchet repair
text only.

That means a message-count ratchet regression for a local rule cannot yet
surface the rule's concrete `How to fix:` tail, such as
`local/no-explicit-any`'s line-scoped suppression syntax. The useful message is
available while ESLint results are collected, but it is not carried through the
metric item or comparison model.

## Scope

- Extend the current ratchet data path for message-count findings only:
  `LintRatchetCurrentItem` (`scripts/lint-ratchet/lint-ratchet-baseline.ts`),
  `itemsFromResults` (`scripts/lint-ratchet/current-collector.ts`), comparison
  (`scripts/lint-ratchet/lint-ratchet-baseline-compare.ts`), and diagnostics
  (`scripts/lint-ratchet/diagnostics.ts`).
- Capture the first matching ESLint message text and `messageId` for each
  path/rule while keeping the existing aggregate count behavior.
- Copy that context onto message-count regressions when available. Do not store
  diagnostic text in `lint-ratchet.baseline.json`; it is current-run guidance,
  not committed baseline identity.
- Reuse the existing `How to fix:` extraction behavior from
  `scripts/lint-agent-fix-text.ts` for local-rule regressions:
  - codemod/autofix/suggestion repairs stay command-first;
  - manual local rules include the message-derived repair text before the
    ratchet baseline repair instruction.
- Keep effective-line-count, complexity, core-rule, and third-party ratchets on
  their existing metric-specific guidance unless a separate evidence-backed
  rule-guidance registry is added.

## Definition Of Done

Local-rule message-count ratchet regressions include the same concrete repair
guidance agents would see from raw ESLint or `lint:agent`, while ratchet
diagnostics still make clear that the finding is a path-level aggregate and the
baseline count must also be restored or intentionally updated.

## Verification

- Add a baseline comparison test proving a message-count regression carries
  `firstMessage` / `firstMessageId` (or the final chosen field names).
- Add a `buildEnvelope` test for a local manual-rule regression whose first
  message is `Why: ... How to fix: <tail>`, asserting the envelope includes the
  tail and the ratchet baseline repair instruction.
- Add a no-message fallback test so older fixtures still produce the generic
  local-rule ratchet guidance.
- `bash scripts/tests/test-lint-ratchet.sh`
- `bash scripts/vitest.sh run scripts/lint-ratchet/lint-ratchet-baseline.test.ts`
- `bun run lint:ratchet`
- `bun run verify:changed`

## Notes

- Added live-only `firstMessage` / `firstMessageId` context to message-count
  current items and regressions. Baseline formatting still serializes only the
  metric identity fields; a regression test now guards that message text and
  message ids do not enter `lint-ratchet.baseline.json`.
- Moved the existing local-rule message-to-fix extraction into the portable
  ratchet runtime as `scripts/lint-ratchet/local-rule-fix-text.ts`, with
  `scripts/lint-agent-fix-text.ts` re-exporting the same API. This kept the
  lint-ratchet smoke import boundary unchanged while letting ratchet
  diagnostics reuse lint-agent guidance.
- Manual local-rule ratchet regressions now prepend the message-derived
  `How to fix:` tail and paired guide before the aggregate baseline repair
  instruction. Codemod/autofix local rules keep their command-first ratchet
  guidance, and generic core/third-party ratchets keep their existing
  guidance.
- Accepted-worse debt-log entries strip the live message context before
  append validation so committed debt logs continue recording only accepted
  count/metric deltas.
