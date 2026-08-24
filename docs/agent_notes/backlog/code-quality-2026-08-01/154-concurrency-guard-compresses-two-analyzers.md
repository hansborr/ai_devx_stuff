# 154. Split the concurrency guard's direct and nested write analyzers behind one registered rule

Status: Landed on fix/cq-154
Theme: separate lint analyzers · Area: harness · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

`local/concurrency-guard` contains two materially different analyzers in one
562-line rule. The direct branch recognizes calls to gated delegates and is a
diagnostic backed by branded client types. The nested branch performs a
model-aware walk over Prisma-shaped object literals and is explicitly
non-authoritative because helper calls and spreads can escape its syntax-based
analysis.

Despite those different guarantees, alias models, result shapes, and regression
corpora, both detectors are interleaved with file exemptions and reporting in
one `create()` function. A contributor changing either branch must understand
the other branch's state, traversal, exemptions, and report ordering. The cost
is especially high in this race-sensitive guard, where a seemingly mechanical
cleanup can suppress nested checks in mutation helpers or change which
diagnostic is emitted first.

## Evidence

- `eslint-rules/concurrency-guard.js:15-47` documents two branches with different
  authority: direct writes are backed by branded delegate types, while the
  nested name-matching walk is explicitly escapable and remains active in
  mutation-helper files.
- `eslint-rules/concurrency-guard.js:130-157` implements the direct detector's
  delegate resolution and `{ delegate, method }` result.
- `eslint-rules/concurrency-guard.js:257-273` resolves Prisma mutation roots,
  while `:307-423` implements the nested branch's model-aware
  `ambiguous`/`data`/`wrapper` payload state machine and relation traversal.
- `eslint-rules/concurrency-guard.js:467-517` puts direct and model alias maps in
  the rule's `create()` and populates both through one `VariableDeclarator`
  visitor.
- `eslint-rules/concurrency-guard.js:519-558` reports a direct finding first and
  then performs and reports the nested walk from the same `CallExpression`
  visitor.
- `eslint-rules/concurrency-guard.js:470-474,519-545` shows the mutation-helper
  exemption's precise scope: `skipDirect` suppresses only direct reporting;
  alias collection and nested analysis remain active.
- The file measures 562 physical lines at the audit pin. Counting the
  `kind: lint-rule` sources registered in `harness.controls.json` makes it the
  largest production local rule; the next largest is
  `eslint-rules/no-effect-misuse.js` at 360 lines.
- `eslint-rules/concurrency-guard-direct-corpus.json:2-10` identifies the direct
  corpus as shared with the ts-morph detector; it contains 11 cases at the pin.
  `scripts/codemods/concurrency-guard/concurrency-guard-drift.test.ts:39-50`
  loads that exact filename.
- `eslint-rules/concurrency-guard-nested-corpus.json:2-11` identifies the nested
  corpus as a lint-only regression floor after retirement of the former
  ts-morph nested detector; it contains 45 cases.
  `eslint-rules/concurrency-guard.test.js:543-573` pins the count and executes
  every case.
- `eslint-rules/local-plugin-registry.test.js:13-27` imports every non-test
  JavaScript module in the directory, and `eslint-rules/all-local-rules.js:19-40`
  classifies a default export carrying `meta` and `create` as a rule.

## Proposed direction

1. Keep `eslint-rules/concurrency-guard.js` as the only registered rule and the
   owner of `meta`, both message IDs, the schema,
   `DIRECT_WRITE_SUGGESTIONS`, `isTypeTestPath`, `isMutationHelperPath`, and the
   cross-branch orchestration policy. Split its header so it retains only the
   shared orchestration and file-exclusion contract.

2. Extract `eslint-rules/concurrency-guard-direct.js` with a narrow
   `createDirectAnalyzer(sourceCode)` factory. It should own `delegateName`,
   `directGatedWrite`, delegate-alias state, and the direct branch's explanation
   that lint is a diagnostic backed by branded types. Return an interface such
   as `{ recordAliases(variableDeclarator), findWrites(callExpression) }`, with
   `findWrites` producing the current `{ delegate, method }` shape.

3. Extract `eslint-rules/concurrency-guard-nested.js` with a corresponding
   `createNestedAnalyzer(sourceCode)` factory. It should own model-alias state,
   `receiverModelName`, `prismaMutationArgument`, and the full payload walk:
   relation lookup, gated-delegate recognition, envelope classification,
   seen-state tracking, relation and envelope traversal, ambiguous-data rules,
   and collection of `{ node, delegate, method, relation }` results. Its header
   must retain the warning that this name-matching analysis is an
   author-time diagnostic, not an authoritative closure mechanism.

4. Reduce the rule's `create()` to one `VariableDeclarator` visitor that always
   calls both analyzers' alias recorders and one `CallExpression` visitor that
   maps their results to the existing reports. Preserve direct-before-nested
   ordering and make `skipDirect` suppress only the direct result lookup, never
   alias recording or nested analysis. Move `recordDestructuredAliases` and
   `knownPropertyName` to the single analyzer that uses each; use
   `ast-helpers.js` only if a helper is genuinely shared after the split.

5. Freeze behavior during extraction. Keep both corpus filenames and all 11
   direct plus 45 nested cases unchanged; keep message text, report nodes, data
   fields, suggestions, and ordering byte-for-byte compatible. The focused
   checks are
   `bun run test:eslint-rules -- eslint-rules/concurrency-guard.test.js` and
   `bun run test:scripts:file -- scripts/codemods/concurrency-guard/concurrency-guard-drift.test.ts`.
   The new analyzer modules must export plain named factories/functions, not a
   default rule-shaped object, so filesystem registry discovery continues to
   classify only `concurrency-guard.js` as the rule.

## Scope / caveats

- Land this before
  [71-nested-write-walker-parity.md](../code-quality-2026-07-25/71-nested-write-walker-parity.md)
  begins, or fold the extraction into that work if it is already in flight.
  That leaf should operate on the extracted nested analyzer; parallel rewrites
  of the current `concurrency-guard.js:307-423` walk would conflict.
- This leaf is intra-lint decomposition only. Do not change walker semantics,
  edit corpus cases, alter the ts-morph direct detector in
  `scripts/codemods/concurrency-guard/ast.ts`, or touch
  `packages/server/src/prisma/nested-write-guard.ts`.
- The prior pack's leaf 71 keeps the runtime guard authoritative and requires
  the 45-case lint floor until an equivalent replacement exists. Do not
  restructure the nested analyzer merely to resemble the runtime walker or
  broaden policy to create/delete/connect-style operators.
- Do not combine the analyzers behind a generic analysis framework. Their
  concrete factories and distinct result types are the reusable seams.
- Do not move or rename either JSON corpus. The direct corpus has a second
  consumer by filename; the nested corpus is the pinned lint regression floor.
- New sibling modules are imported by the registry-completeness test. Plain
  named exports are binding: a default object with `meta` and `create` would be
  interpreted as an unregistered rule.
