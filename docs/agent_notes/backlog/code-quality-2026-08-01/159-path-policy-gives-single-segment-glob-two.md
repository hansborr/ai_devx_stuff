# 159. Name and validate path-policy’s two segment-pattern dialects instead of treating both as one glob language

Status: Landed on fix/cq-159
Theme: Explicit glob dialects · Area: harness · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

Two parts of `scripts/path-policy/` accept patterns described as single-segment globs but implement different languages. Changed-file selectors recognize only `*`; question marks and brackets are escaped as literals. The fixture analyzer recognizes `*`, `?`, and `[` as glob syntax, translates `?`, and lets bracket expressions flow into JavaScript `RegExp` semantics.

Those differences have defensible purposes: policy selectors need a narrow declarative vocabulary, while the fixture analyzer approximates shell expansion. The defect is that the distinction is private and silent. A contributor can add punctuation that one path treats literally and another treats as syntax or an error, affecting changed-gate scoping or fixture closure without an explicit contract.

## Evidence

- `scripts/path-policy/path-policy.ts:15-27` exposes a `single-segment-glob` selector whose `pattern` is an undocumented plain string.
- `scripts/path-policy/path-policy-query-core.ts:37-44` escapes regex-special punctuation—including `?`, `[` and `]`—and translates only `*` into `[^/]*`.
- `scripts/path-policy/fixture-copy-expressions.ts:16` defines glob-shaped input as containing `*`, `?`, or `[`.
- `scripts/path-policy/fixture-copy-expressions.ts:38-64` rejects glob syntax in directory segments, escapes a set that deliberately excludes `*?[]`, translates `*` and `?`, and passes bracket syntax directly into `RegExp`.
- `scripts/path-policy/fixture-loop-bindings.ts:22` duplicates the same glob-shape predicate, while `:39-52` separately rejects a token that remains glob-shaped after expansion fails.
- `scripts/path-policy/path-policy.test.ts:33-39` contains a third private copy of the star-only matcher to interpret selectors in policy-structure tests.
- A pinned-tree count finds 25 live `single-segment-glob` rows in `scripts/path-policy/path-policy.ts:103-231`; every pattern contains `*`, and none contains `?` or `[`. Rejecting those two unsupported characters therefore changes only failure behavior for future rows.
- ~~`scripts/lint-coverage-map-check-patterns.ts:128-152` implements a third, deliberately broader dialect with globstar and brace expansion~~ — **gone as of leaf 111**: the coverage map's private globstar/brace engine was deleted and its membership now resolves through `tools/lint-ratchet/src/kernel/ratchet-globs.ts` (minimatch, `dot: true`). Only the two path-policy segment languages below remain, so this leaf's scope is unchanged but there is no third dialect to compare against.

## Proposed direction

1. Add a small `scripts/path-policy/segment-pattern.ts` module that owns three explicitly named operations:
   - The shared glob-shape predicate currently duplicated in `fixture-copy-expressions.ts` and `fixture-loop-bindings.ts`.
   - A star-only policy matcher such as `matchStarOnlySegmentPattern`.
   - A fixture-oriented compiler such as `compileShellSegmentGlob`.

2. Make the module header the single contrast document for the two dialects. State how each treats `*`, `?`, `[`, `]`, path separators, and ordinary regex punctuation. Record that fixture bracket syntax currently uses JavaScript regular-expression character classes, which are close to—but not identical to—shell bracket expansion.

3. Make the star-only operation reject patterns containing `?` or `[`, either when constructing/validating the selector or before matching it. Do not silently escape those characters. Document on the `PathPolicySelector` variant at `path-policy.ts:24-27` that `*` is its only pattern character.

4. Move the matcher out of `path-policy-query-core.ts` and have selector evaluation call the named star-only operation. Remove the test-local matcher at `path-policy.test.ts:33-39` so policy tests cannot preserve a third private grammar.

5. Keep `expandLiteralGlob`’s directory read and expansion flow in `fixture-copy-expressions.ts`, delegating only segment compilation to the new module. Preserve its current `*`, `?`, and bracket behavior. Have `fixture-loop-bindings.ts` import the shared glob-shape predicate while retaining its current rule that a non-expandable glob-shaped token makes the loop binding incomplete.

6. Add focused `segment-pattern.test.ts` coverage for both dialects: ordinary literals, `*`, `?`, bracket expressions, slash exclusion, malformed bracket input, and explicit policy-side rejection. Keep the existing integration coverage in `path-policy-query.test.ts`, `path-policy.test.ts`, and `fixture-shell-dependencies.test.ts`.

7. Add `segment-pattern.ts` to every relevant `generatedSurface.triggerPaths` and `fixturePaths` closure in `harness.controls.json`. Refresh `scripts/path-policy/MODULE.md` so its Data Flow and Gotchas sections point contributors to the new dialect contract.

## Scope / caveats

- Do not rename the serialized `single-segment-glob` selector kind or change any live `PATH_POLICY` row.
- Do not broaden changed-file policy matching to shell semantics. The current 25 live rows establish that the policy language only needs `*`.
- Do not “fix” fixture bracket handling to exact shell semantics in this leaf. That would change analyzer resolution behavior; document its current RegExp-based approximation instead.
- Do not fold coverage-map membership into the path-policy segment language. That matcher is now `matchesAny` from `tools/lint-ratchet/src/kernel/ratchet-globs.ts` (leaf 111 deleted the private dialect at the former `lint-coverage-map-check-patterns.ts:128-152`); it is deliberately broader and deliberately identical to ESLint flat-config resolution.
- The query-core engine/adapter layering split belongs to [152-path-policy-query-core-closed-over-musis.md](./152-path-policy-query-core-closed-over-musis.md). Both leaves edit `path-policy-query-core.ts`; either may land first, but they should not run concurrently.
- The earlier [49-path-policy-fixture-analyzer.md](../code-quality-2026-07-25/49-path-policy-fixture-analyzer.md) already owns analyzer orientation and test-placement decisions. Its module documentation landed and its proposed broad test split was dropped; this leaf only refreshes the landed module pointers and adds focused tests for the new dialect boundary.
- `scripts/path-policy/MODULE.md:52-54` requires newly imported analyzer modules to appear in generated-surface trigger and fixture paths, and `:85-87` requires `bun run harness:check` after changes in this directory.
- Focused tests use the existing `bun run test:scripts:file -- <file>` command; generated closure and metadata remain covered by `bun run harness:check`.
