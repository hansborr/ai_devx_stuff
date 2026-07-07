# 20. Inline doc pointers for the four rules missing them

Status: Done — appended each rule's paired guide to the four missing inline diagnostics and added focused rule tests pinning the pointers.
Lens: rules · Area: discoverability · Severity: med-high · Size: S · Confidence: med-high
Theme: doc-pointer-parity · Source: Musi lint-messaging review 2026-07-05 (5 Sonnet agents + Fable verification)

## Problem
Plain `bun run lint` / pre-commit output shows only the message string —
`meta.docs.pairedGuide` is surfaced solely by the lint-agent envelope and
the generated catalog. So a doc pointer effectively exists only when
inlined in the message, and inlining is arbitrary today: of the five rules
paired with `docs/guides/add-trpc-procedure.md`, two inline
"See docs/guides/add-trpc-procedure.md." and three don't; in the
concurrency family, `concurrency-guard` inlines a doc while
`no-outer-client-in-transaction` doesn't. An agent hitting the
pointer-less rules gets no doc trail at all.

## Evidence
- Missing inline pointer, same shared guide:
  `eslint-rules/trpc-require-output-schema.js:157-158`,
  `eslint-rules/trpc-shared-input-schema.js:50-51`,
  `eslint-rules/trpc-shared-output-schema.js:35-36`.
- Has the pointer (the convention to match):
  `eslint-rules/strict-trpc-input.js:67-68`,
  `eslint-rules/strict-shared-schemas.js:144-145`.
- Missing pointer, concurrency family:
  `eslint-rules/no-outer-client-in-transaction.js:211-212` (pairedGuide is
  `docs/CONCURRENCY.md`).

## Proposed direction
Append `See <pairedGuide>.` to the four messages, using each rule's own
`meta.docs.pairedGuide` value verbatim so message and metadata cannot
disagree (leaf 12 fixes the one existing disagreement; leaf 21 then locks
the invariant in the contract test).

## Scope / caveats
- Watch the 520-char message cap; all four have headroom but confirm.
- Update rule-test fixtures; keep `message-guidance.test.js` green;
  regenerate `docs:lint-guidance` output if messages are embedded.
- The two codemod-bearing rules (`trpc-shared-input-schema`,
  `trpc-shared-output-schema`) already name their codemod — append the
  pointer after it, don't restructure the message.
