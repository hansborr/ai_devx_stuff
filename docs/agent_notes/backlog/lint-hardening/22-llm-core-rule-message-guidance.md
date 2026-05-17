# Leaf 22: Local-Rule Message Guidance Tests

Status: Landed (2026-05-16); all local rule messages classified and tested.
Source: `docs/agent_notes/in_progress/eslint-llm-core-evaluation.md` —
"Rule message guidance tests" section.

## Problem

Several `local/*` ESLint rules already treat their diagnostic as an
agent-facing repair prompt with a `Why:` / `How to fix:` shape. Others use
a one-line policy message. There is no convention check, so newly added
local rules can drift into terse "X is not allowed" diagnostics that fail
AI/contributor repair-from-message.

## Decision

Make rule-message guidance a rule-authoring convention enforced by a test
suite over `eslint-rules/`, not by another ESLint rule.

## Rollout

1. Inventory `eslint-rules/*.js` diagnostics. Classify each rule as:
   - "guidance" — diagnostic is meant to direct a contributor or agent
     to a specific fix (e.g., `local/structured-logging` pointing at the
     codemod).
   - "policy" — diagnostic is a one-line statement of policy where a
     before/after repair would feel artificial (e.g., `local/no-barrel`).
2. Write a test in `eslint-rules/message-guidance.test.js` (file already
   exists per `eslint-rules/` listing) that:
   - For each rule classified as "guidance", asserts the diagnostic
     contains both a `Why:` and a `How to fix:` line, or the equivalent.
   - For each rule classified as "policy", asserts the diagnostic is a
     single line that names the policy and links to a guide.
3. Add a rule-authoring section in `docs/ai-harness.md` (or a new
   `docs/guides/local-eslint-rules.md`) documenting both shapes.
4. Reference the upstream `docs/guides/lint-message-template.md` from
   `eslint-plugin-llm-core` as inspiration only.

## Implementation Result

`eslint-rules/message-guidance.test.js` now covers all 27 local
rule/messageId pairs in `eslint-rules/`: 11 guidance diagnostics and 16
policy diagnostics.

Guidance additions:

- `structured-logging/noTemplate`
- `structured-logging/noConcat`
- `structured-logging/noDynamic`
- `structured-logging/noConsole`
- `structured-logging/noScriptLoggerImport`

Policy additions:

- `e2e-prefer-role-selectors/preferRoleSelectors`
- `no-barrel/noBarrel`
- `strict-shared-schemas/needsExplicit`
- `strict-trpc-input/needsStrict`
- `test-file-location/wrongNaming`
- `test-file-location/missingTests`
- `trpc-require-output-schema/missingOutput`

Rule messages updated to meet the convention:

- `structured-logging/*` messages now use the guidance `Why:` /
  `How to fix:` shape.
- `no-barrel/noBarrel`, `strict-shared-schemas/needsExplicit`,
  `strict-trpc-input/needsStrict`, and `test-file-location/missingTests`
  were tightened as policy diagnostics with explicit action verbs.

The authoring convention is documented in
`docs/guides/local-eslint-rules.md`.

## Adaptation Policy

When a rule diagnostic surface needs updating because the test fails,
update the diagnostic; do not weaken the test. The cost of a good
diagnostic is paid once and recovered every time the rule fires.

## Verification

- `bun run vitest run --project=eslint-rules`
- `bun run lint -- --max-warnings=0`

## References

- `docs/agent_notes/in_progress/eslint-llm-core-evaluation.md`
- `eslint-rules/message-guidance.test.js` (existing scaffold)
