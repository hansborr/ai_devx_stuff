# 48a - class construction evidence inventory

Status: Done
Track: P
Size: small-medium
Depends on: 40b
Blocks: 48

## Goal

Build the class inventory and construction/reference evidence helper for the
never-instantiated classes prototype, without emitting user-facing rows.

## Background

Never-instantiated classes are a high-FP signal. The useful first slice is not a
report; it is an evidence model that counts construction and caveat signals
separately so later advisory output cannot collapse "no `new` expression" into a
dead-code verdict.

## Seams to touch

- `scripts/drift-ai/parsed-source-cache.ts`
- TypeScript AST helpers under `scripts/drift-ai/`
- dead-code FP-trap corpus from task 40b
- focused tests under `scripts/drift-ai/`

## What to do

1. Inventory class declarations and class expressions with file/range, export
   status, decorators, inheritance, and static factory methods.
2. Count value references separately from type-only references, `new`
   expressions, subclassing, JSX/custom-element hints, decorator metadata, and
   string-keyed references where practical.
3. Return caveat labels rather than suppressing risky contexts silently:
   DI/decorators, ORM-like entities, React class components, custom elements,
   factory/static construction, reflection, and test/fixture usage.
4. Calibrate against the dead-code FP-trap corpus so trap labels are preserved.
5. Keep this library/test-only. Do not register a check id, subcommand, or
   advisory output in this task.

## Testing

- Fixtures for direct construction, factory construction, DI/decorators, ORM-like
  entities, React class components, custom elements, type-only references, and
  reflection/string-keyed references.
- Corpus tests proving trap labels are preserved.
- Deterministic ordering tests.

## Out of scope

- User-facing output; use task 48.
- Framework-specific host APIs.
- Default-on findings or gates.
- Full type-checker reachability.

## Implementation notes (done 2026-06-04)

What landed (library/test-only; no `DriftCheckId`, subcommand, or advisory row —
task 48 owns user-facing output):

- `scripts/drift-ai/class-construction.ts` is the public facade. `inventoryClasses`
  parses a set of in-memory `{ filePath, source }` inputs, inventories every class,
  attributes name-based reference evidence across the whole input set, derives
  caveats, and returns a deterministically ordered `ClassConstructionInventory`.
  Split helpers: `class-construction-types.ts` (types + heuristic vocabulary +
  standing/risky-context caveat constants), `class-construction-declarations.ts`
  (class declaration/expression collector: name, `displayName`, kind, export
  status, range, decorators, `extends`/`implements` heritage, static factory
  methods), and `class-construction-references.ts` (single-pass reference-bucket
  classifier).
- Evidence counts are kept **separate** (point 2): `newExpressions`,
  `subclassings`, `jsxReferences`, `customElementRegistrations`,
  `decoratorReferences`, `valueReferences`, `typeOnlyReferences`,
  `stringKeyedReferences`. Each reference is classified into exactly one bucket so
  a single use is never double-counted. `typeof Foo` stays a value reference;
  import/export specifier names and member names are excluded; JSX closing tags do
  not double-count their opening tag.
- Caveats are returned, never used to suppress (point 3). Every record carries
  `CLASS_CONSTRUCTION_STANDING_CAVEAT` (zero `new` is a lead, never a verdict) plus
  `risky-context:` labels for `di-or-decorator`, `orm-entity`,
  `react-class-component`, `custom-element`, `factory-static-construction`,
  `reflection-string-keyed`, `instantiated-via-subclass`,
  `test-or-fixture-only-construction`, `anonymous-untrackable`, and
  `ambiguous-name-shared-evidence` (the name-based-matching disclosure). An
  injectable `caveatLabeler` carries evidence a single-file scan cannot show.
- Calibration against the task-40b corpus (point 4): the lone corpus class
  (`LegacyInitiativeAdapter`) is inventoried as zero-construction and cross-checked
  against its `known-unused` label (a genuine candidate, never a verdict); a class
  placed in the `framework/routes/campaign-route.tsx` trap path preserves the
  injected `true-trap` label so it can never read as "delete the dead class".
- `scripts/drift-ai/class-construction.test.ts` covers declaration shape, each
  evidence bucket, every risky-context caveat (incl. production-vs-test-only
  construction and the injected labeler), deterministic ordering, and the corpus
  calibration. `scripts/drift-ai/README.md` documents the helper as prototype
  calibration infrastructure, and the lint-coverage-map accounts for the new files.

Post-review hardening (a subagent review caught attribution false-zeros that
would have masked exactly the dead-code FP this task guards against):

- A named class expression (`const Outer = class Inner {}`) now attributes
  cross-file evidence to the binding name `Outer`, not the inner name `Inner`.
- A namespace-import alias that collides with a class name
  (`import * as Foo from './other'`) and a re-export source name
  (`export { Foo as Bar }`) are no longer counted as value references.
- `customElements.define` registration is detected through
  `window.customElements.define` too.

Validation:

- `FORCE_VERIFY=1 bun run test -- scripts/drift-ai/class-construction.test.ts` (26 passed)
- `bun run verify:changed` (lint, ratchet, zero-baseline, coverage-map, format-check, typecheck, test, scripts)

Follow-up for task 48: bucket inputs by package/scope and feed
`inventoryClasses` through the task-39 prototype advisory contract; keep the
standing caveat and every `risky-context:`/injected label on each row; treat
`anonymous-untrackable` / `ambiguous-name-shared-evidence` as recall limits to
disclose, not to hide.
