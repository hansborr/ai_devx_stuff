# 48a - class construction evidence inventory

Status: Parked
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
