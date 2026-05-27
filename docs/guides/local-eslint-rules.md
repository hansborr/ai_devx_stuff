# Local ESLint Rules

Authoring conventions for rules in `eslint-rules/`.

For projects adapting the guidance pipeline to Biome, see
[Biome Lint Adoption](biome-lint-adoption.md). The portable part is the
metadata and `HarnessDiagnostics` envelope; the current discovery mechanism is
ESLint-specific.

## Rule Catalog

Use the generated [local rule catalog](../generated/local-lint-rules.md) to
find the current `local/*` rules, their principles, paired guides, and repair
kinds. The catalog is generated from rule metadata; refresh it with
`bun run docs:lint-guidance` after changing rule docs.

## Severity Semantics

Local rules can use ESLint `warn` or `error`, but the meaning depends on the
surface reading the diagnostic.

- In normal ESLint gates, `warn` is editor-advisory severity, not a non-blocking
  escape hatch. `bun run lint`, `bun run lint:changed`, `verify`, pre-commit,
  and CI run ESLint with `--max-warnings=0`, so any warning still fails the
  gate. Repair helpers such as `lint:fix` are not the authority for gate
  behavior.
- In normal ESLint gates, `error` is both an editor error and a gate-enforced
  policy. Use it for permanent policy, drained ratchets promoted into normal
  lint, and findings that must block merge until fixed.
- In the agent local-rule envelope, `bun run lint:agent:local-rules` and
  `bun run lint:agent:local-rules:changed` emit harness diagnostics for
  `local/*` findings and parser errors. `scripts/lint-agent.ts` maps ESLint
  errors to harness `block` findings and ESLint warnings to harness `warn`
  findings, then exits nonzero only when the envelope has blocking findings.
  Harness warnings are advisory and non-blocking in that envelope.

The distinction exists because normal ESLint is the enforcement floor, while
the agent envelope is a structured local-rule view for agents and hook
surfaces. It carries rule metadata, repair kind, and paired-guide context
without pretending to be full lint parity. Keep merge enforcement in normal
lint, ratchet, pre-commit, and CI. Use envelope warnings for useful agent
guidance that should not stop the local agent loop. If `lint-agent` ever becomes
a gate, add an explicit mode that fails warnings too instead of changing the
current advisory meaning silently.

## Rule Implementation Format

Local rules are intentionally plain `.js` files with `// @ts-check` and JSDoc.
This trades away some implementation type safety so ESLint can load the rules
directly before any TypeScript compilation or repository build step.

## Metadata Contract

Every local rule needs a `meta.docs` object. The guidance generator,
`lint-agent`, and local-rule ratchets all read the same fields:

- `description`: non-empty one-sentence catalog text.
- `principle`: non-empty explanation used in structured repair guidance.
- `category`: one of `maintainability`, `architecture-fitness`, or `behavior`.
- `pairedGuide`: `none` or a path that resolves to an existing file under the
  repository root.
- `repairKind`: one of `autofix`, `suggestion`, `codemod`, or `manual`.
- `repairCommand`: required only when `repairKind` is `codemod`; absent for all
  other repair kinds.

`eslint-rules/message-guidance.test.js` is the local registration point for
this contract. Add a new rule to `ALL_LOCAL_RULES` there, then add each
`messageId` to the guidance-shape or policy-shape expectations below.

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
2. Import the rule in `eslint-rules/message-guidance.test.js` and add it to
   `ALL_LOCAL_RULES`.
3. Add the rule's `messageId` to the guidance-shape expectation, or to the
   policy-shape exemption set when the terse policy shape is intentional.
4. Run `bun run vitest run --project=eslint-rules` and adjust until green.
5. Run `bun run docs:lint-guidance` if the generated local rule catalog changes.

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
