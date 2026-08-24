# 155. Share transaction-callback discovery and lifecycle tracking between the two transaction lint rules

Status: Landed on fix/cq-154
Theme: shared transaction callback state · Area: harness · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

Two race-sensitive local rules independently decide whether a call is a Prisma
interactive transaction, discover its inline callback, and maintain lexical
function state while traversing that callback. The broadcast rule uses a
`WeakSet` plus a boolean stack; the outer-client rule uses callback maps and
richer frames carrying transaction-client names and resolved variables.

Those state machines must agree on callback syntax and transaction inheritance,
but their visitor registrations already differ: only the outer-client rule
pushes frames for `FunctionDeclaration`. The broadcast rule currently reports
inside a nested function declaration because it leaves the surrounding
transaction frame on top, while the outer-client rule reaches the same behavior
through explicit inherited state. Extending callback or function syntax
therefore requires parallel edits whose semantic equivalence is difficult to
see.

The outer-client rule also has a separate outer-Prisma alias model, but that
logic is not duplicated and should not be generalized into the shared tracker.
The shared seam is transaction recognition, callback identity, and function
lifecycle—not socket recognition or outer-client resolution.

## Evidence

- `eslint-rules/no-broadcast-in-transaction.js:24-29` and
  `eslint-rules/no-outer-client-in-transaction.js:39-44` contain byte-identical
  `isTransactionCall` predicates.
- `eslint-rules/no-broadcast-in-transaction.js:110-123` owns a callback
  `WeakSet`, boolean function stack, and inherited transaction-state entry and
  exit operations; the state does not begin at its predicate on line 24.
- `eslint-rules/no-broadcast-in-transaction.js:125-146` separately discovers an
  inline callback from the first `$transaction` argument and registers
  lifecycle visitors for arrow and function expressions, but not function
  declarations.
- `eslint-rules/no-broadcast-in-transaction.js:131-140,142-146` means calls
  inside a nested function declaration currently observe the surrounding
  transaction frame because no declaration visitor pushes a replacement
  frame.
- `eslint-rules/no-outer-client-in-transaction.js:105-127` derives the
  transaction-client name and resolved scope variable from the callback's first
  parameter.
- `eslint-rules/no-outer-client-in-transaction.js:157-177,260-273` independently
  constructs inherited function frames carrying transaction state and
  transaction-client identity.
- `eslint-rules/no-outer-client-in-transaction.js:199-207` stores callback
  names, callback variables, outer-Prisma bindings, and a frame stack;
  `:275-303` performs callback discovery and registers lifecycle visitors,
  including `FunctionDeclaration`.
- `eslint-rules/no-outer-client-in-transaction.js:204-205,227-235` shows that
  only the outer-client rule owns `outerPrismaVariables` and
  `recordOuterPrismaAlias`; this rule-specific alias resolution is not a shared
  transaction-callback concern.
- `eslint-rules/no-outer-client-in-transaction.test.js:36-43,131-150` already
  exercises nested function declarations with local and outer Prisma clients,
  while `eslint-rules/no-broadcast-in-transaction.test.js:14-180` has no
  corresponding declaration cases.
- `eslint-rules/binding-resolution.js:3-21` provides the existing
  scope-variable resolution idiom the shared callback tracker can reuse.

## Proposed direction

1. First pin the semantic alignment in both existing rule suites. Add explicit
   nested-`FunctionDeclaration` cases inside and outside a transaction callback
   to `no-broadcast-in-transaction.test.js` and
   `no-outer-client-in-transaction.test.js`. These cases must pass against the
   current rules before extraction so the refactor cannot redefine inheritance
   accidentally.

2. Add a focused
   `eslint-rules/transaction-callback-tracker.js` helper with a beside
   `transaction-callback-tracker.test.js`. Keep it as its own helper home rather
   than folding it into `ast-helpers.js`. Export the shared
   `isTransactionCall` predicate and a per-rule tracker factory that owns:
   inline-callback registration from the first `$transaction` argument,
   function entry and exit, inherited `inTransaction` state, and callback
   identity as the first parameter's name plus resolved scope variable.

3. Expose minimal queries such as `inTransaction()` and `currentFrame()`, plus
   an optional per-frame state callback receiving the parent frame and callback
   information and returning an opaque payload. The broadcast rule should use
   the tracker with no extra payload, replacing its `WeakSet` and boolean stack.
   The outer-client rule should keep
   `namesForFunctionFrame`/`variablesForFunctionFrame` behavior as its own
   payload construction rather than moving that policy into the tracker.

4. Have both rules register the tracker's function visitors for arrow
   expressions, function expressions, and function declarations. Preserve the
   broadcast rule's current reports inside nested declarations through explicit
   inheritance, and preserve outside-transaction non-reporting. Keep
   `outerPrismaVariables`, `recordOuterPrismaAlias`, outer-client argument
   inspection, and socket/broadcast recognition in their current rule modules.

5. Validate the helper directly and then re-run both rule suites with
   `bun run test:eslint-rules -- eslint-rules/transaction-callback-tracker.test.js eslint-rules/no-broadcast-in-transaction.test.js eslint-rules/no-outer-client-in-transaction.test.js`.
   The tracker is a helper, not a rule: do not add it to `all-local-rules.js`,
   the local plugin registry, or `harness.controls.json` as a lint-rule source.
   `eslint-config/config-surface-manifest.json:3-129` inventories actual config
   files and requires no helper entry. Export plain named functions without a
   rule-shaped default so `local-plugin-registry.test.js:13-27` continues to
   classify it as a helper.

## Scope / caveats

- The binding ruling from
  [70-eslint-helper-collision-coverage.md](../code-quality-2026-07-25/70-eslint-helper-collision-coverage.md)
  remains in force: do not create a general module-classification framework and
  do not merge every focused helper into `ast-helpers.js`. A dedicated
  transaction tracker for two consumers is consistent with that ruling.
- Do not move outer-Prisma alias resolution or socket-emit recognition into the
  tracker. Neither concern is duplicated.
- Do not turn the optional frame-payload callback into a plugin API. It exists
  only to let the outer-client rule retain its richer names/variables merge
  policy while sharing lifecycle mechanics.
- Do not change what either rule reports, add a new lint rule, or broaden the
  accepted `$transaction` callback syntax as part of the extraction.
- Function-declaration handling is the highest-risk seam. The current broadcast
  behavior arises by omission while the outer-client behavior uses explicit
  inheritance; the pre-extraction inside/outside cases are a binding behavior
  floor.
- There is no additional cross-leaf sequencing requirement.
