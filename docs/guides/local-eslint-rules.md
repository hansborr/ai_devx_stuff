# Local ESLint Rules

Authoring conventions for rules in `eslint-rules/`.

## Rule Catalog

Use the generated [local rule catalog](../generated/local-lint-rules.md) to
find the current `local/*` rules, their principles, paired guides, and repair
kinds. The catalog is generated from rule metadata; refresh it with
`bun run docs:lint-guidance` after changing rule docs.

## Rule Implementation Format

Local rules are intentionally plain `.js` files with `// @ts-check` and JSDoc.
This trades away some implementation type safety so ESLint can load the rules
directly before any TypeScript compilation or repository build step.

## Message Guidance

Every rule diagnostic message must follow one of two shapes, verified by
`eslint-rules/message-guidance.test.js`.

### Guidance Shape

Use when the fix requires several steps or context.

```text
Why: <one-sentence reason this is wrong>. How to fix: <one or more imperative steps>.
```

Constraints:

- Starts with `Why: ` and contains ` How to fix: `.
- Single line with no embedded `\n`.
- Length <= 520 characters.
- The "How to fix" half includes an action verb.

Examples: `concurrency-guard/noDirectWrite`,
`structured-logging/noConsole`, `no-explicit-any/noAny`.

### Policy Shape

Use when the rule states a simple policy with one-action repair.

Constraints:

- Single line.
- Length <= 180 characters.
- Includes an action verb.
- Names the sanctioned alternative or repair, such as a codemod, helper, or
  guide link.

Examples: `no-barrel/noBarrel`,
`no-llm-artifacts/leftoverEditNote`,
`trpc-require-output-schema/missingOutput`.

### Adding A New Rule

When you add a rule under `eslint-rules/`:

1. Decide whether the diagnostic is guidance or policy.
2. Add the rule's messageId to the matching array in
   `eslint-rules/message-guidance.test.js`.
3. Run `bun run vitest run --project=eslint-rules` and adjust until green.

A rule whose messageIds are not covered by the guidance test will not fail CI
today, but adding new untracked rule messages should be a reviewer flag. Bring
them into the convention test with the rule change.

When a new local rule becomes a normal-lint or ratchet responsibility, treat it
as a coverage change too. Update the affected file-family rows in the lint
coverage map and run the
[Coverage Map Gate](lint-ratchet.md#coverage-map-gate). The gate catches stale
map rows, unknown ratchet ids, unaccounted tracked files, and full-mode ESLint
reach gaps before reviewers rely on a `local/*` rule for files ESLint does not
actually reach.
