# 69. Ten ESLint-config suites each rebuild the same real-repository lint harness instead of importing it once

Status: Landed on fix/cq-069
Theme: lint-config test plumbing · Area: tests · Severity: medium · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

Every suite in `eslint-rules/` that asserts repository lint *policy* — which
rules are enabled where, at what severity, with which options — starts by
reconstructing the same harness: derive `repoRoot`, build an `ESLint` instance
pinned to the real `eslint.config.js`, then define small query helpers
(`configFor`, `severityOf`, `lintTextFor`, a message filter) over it. Ten
suites carry this block, in two `repoRoot`-derivation flavors, and six carry
near-identical copies of the query helpers. Any change to how the repository
config is resolved — a config-file rename, an `ESLint` constructor option, a
flat-config API change — is a ten-file lockstep edit where a missed file
silently tests something else. The corpus already learned this lesson once:
`rule-tester.js` was created precisely because 17 byte-identical `RuleTester`
blocks made a parser-baseline move a 17-file edit. The config-suite half of the
harness never got the same treatment, and each new policy suite copies the
plumbing again, burying its actual policy assertion under ~30 lines of setup.

## Evidence

- Ten suites construct `new ESLint({ cwd: repoRoot, overrideConfigFile: resolve(repoRoot, "eslint.config.js") })`:
  `eslint-rules/e2e-selector-config.test.js:12`, `eslint-comments-config.test.js:14`,
  `eslint-config-plugin-declarations.test.js:12`, `max-lines-policy.test.js:16`,
  `no-retired-parse-success-import.test.js:18` (inside a test body),
  `no-shared-schemas-barrel.test.js:24`, `no-unbounded-promise-all-config.test.js:12`,
  `restricted-syntax-and-globals-config.test.js:38`,
  `restricted-syntax-resolution-snapshot.test.js:42`, `security-primitives-config.test.js:12`.
  The eleventh constructor at `restricted-syntax-builder.test.js:96` is synthetic
  (`overrideConfigFile: true, overrideConfig`) and is not part of this pattern.
- `repoRoot` is derived two ways across those ten: seven via
  `dirname(fileURLToPath(import.meta.url))` (e.g. `e2e-selector-config.test.js:10`),
  three via `import.meta.dirname` (`max-lines-policy.test.js:15`,
  `eslint-config-plugin-declarations.test.js:11`, `no-retired-parse-success-import.test.js:19`).
- Six suites define a local `configFor`; five are the same `{ rules: config.rules }`
  projection (`e2e-selector-config.test.js:18`, `eslint-comments-config.test.js:20`,
  `no-unbounded-promise-all-config.test.js:24`, `restricted-syntax-and-globals-config.test.js:44`,
  `security-primitives-config.test.js:18`), one returns the raw resolved config
  (`no-shared-schemas-barrel.test.js:30`).
- Five suites define `severityOf`; four are byte-similar two-arg copies
  (`e2e-selector-config.test.js:24`, `eslint-comments-config.test.js:26`,
  `restricted-syntax-and-globals-config.test.js:50`, `security-primitives-config.test.js:24`),
  one is a one-arg variant closed over its rule id (`no-unbounded-promise-all-config.test.js:30`).
- Lint-message plumbing recurs across four suites: `lintTextFor` is byte-identical
  in three (`eslint-comments-config.test.js:39-41`, `restricted-syntax-and-globals-config.test.js:122-124`,
  `security-primitives-config.test.js:30-32`), and the flatMap-and-filter-by-ruleId
  message helper appears three times (`security-primitives-config.test.js:38-42`,
  `restricted-syntax-and-globals-config.test.js:130-134`,
  `no-unbounded-promise-all-config.test.js:36-43`, the last fused with the lint call).
- The precedent for fixing this is in the same directory: `eslint-rules/rule-tester.js:3-15`
  centralized the RuleTester half of the harness after "17 of the 19 RuleTester
  instances re-declared a byte-identical `languageOptions` block", and its header
  documents the non-`*.test.js` naming convention that keeps a helper out of the
  vitest project's `include: ["*.test.js"]` (`eslint-rules/vitest.config.ts:18`).
  All ten suites already import a second shared harness module,
  `eslint-rules/eslint-config-resolution-timeout.js:20`.

## Proposed direction

Extract a shared eslint-rules test helper exporting the repo-root ESLint
construction plus `configFor`/`severityOf` (and the common lint-message
plumbing), and import it from the suites that currently clone it, leaving every
suite file and its assertions in place per CQ25-112 (no new Vitest project).

Mechanics: model the helper on `eslint-rules/rule-tester.js` — a plain `.js`
module (not `*.test.js`, so the project's `include: ["*.test.js"]` does not
collect it) exporting `repoRoot`, the constructed `ESLint` instance, `configFor`
(both the `{ rules }` projection and a raw-config accessor, so
`no-shared-schemas-barrel.test.js` can drop its variant too), the two-arg
`severityOf`, `lintTextFor`, and a `messagesFor(results, ruleId)` filter.
Swap the ten suites' local copies for imports; the one-arg `severityOf` in
`no-unbounded-promise-all-config.test.js:30` becomes a trivial partial
application of the shared two-arg form. Verify per suite with
`bun run test -- eslint-rules/<suite>.test.js`.

## Scope / caveats

- **Binding prior-pack ruling (CQ25-112, from
  [38-eslint-rule-helpers.md](../code-quality-2026-07-25/38-eslint-rule-helpers.md)):**
  do not create a separate `eslint-config/` Vitest project or move suites —
  leaf 38 implemented exactly that split and removed it after review. This leaf
  centralizes plumbing only; every suite file stays where it is and every
  assertion stays as it is.
- `restricted-syntax-builder.test.js:96` stays untouched: its constructor is
  synthetic-config, not the repository harness.
- Suite-specific helpers stay in their suites: `patternsOf`
  (`no-shared-schemas-barrel.test.js:35`), `restrictedGlobalsOf` and the
  selector fingerprinting in `restricted-syntax-and-globals-config.test.js` /
  `restricted-syntax-resolution-snapshot.test.js`. Only the harness block and
  the four common queries move.
- This is not a performance change: vitest isolates modules per suite file, so
  each suite still constructs its own `ESLint` instance and pays the ~0.9s
  flat-config normalization documented in
  `eslint-rules/eslint-config-resolution-timeout.js:6-8`. The win is the
  single point of edit, not runtime.
- Optional adjacent fix while touching the timeout module: its header comment
  (`eslint-config-resolution-timeout.js:5-6`) names only four consuming suites;
  all ten import it.
- Out of scope: changing any policy assertion, timeout value, or the
  `rule-tester.js` factories themselves.
