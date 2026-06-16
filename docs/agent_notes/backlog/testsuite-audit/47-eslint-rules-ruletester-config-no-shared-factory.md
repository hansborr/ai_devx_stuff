# 47. 17 of 19 eslint-rules RuleTester instances duplicate the identical languageOptions config with no shared factory

Status: Proposed — read-only finding from the test-suite audit; NOT implemented. Re-verify file:line before acting.
Lens: maintainability · Area: eslint-rules (tooling/dogfood) · Severity: low · Size: S · Confidence: high
Theme: shared-test-fixture-extraction · Source: Musi test-suite audit 2026-06-13 (multi-agent, adversarially verified)

## Problem
The `eslint-rules/` directory holds 19 `new RuleTester(...)` instances across 18 test files. Seventeen of them re-declare the byte-identical config block

```js
const ruleTester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: { ecmaVersion: 2022, sourceType: "module" },
  },
});
```

each preceded by the same `import { RuleTester } from "eslint"` / `import tseslint from "typescript-eslint"` pair. The three-line `languageOptions` block is not just similar — it hashes identically across all 17 files (a single md5 for the whole set), so the parser baseline is effectively a constant that has been copy-pasted seventeen times rather than named once. There is no shared test-utils module anywhere in `eslint-rules/` (no `*helper*`, `test-utils`, or `rule-tester` sibling), so nothing today lets a rule author reach for the canonical tester; the convention is "paste the block again."

The cost shows up the moment the parser baseline needs to move. Bumping `ecmaVersion`, switching off `tseslint.parser`, or adding a default `ecmaFeatures`/`parserOptions` key forces a 17-file lockstep edit, and a missed file produces a silently inconsistent baseline (one rule's tests parsing under different assumptions than the rest) rather than a build break. The two non-identical instances make the divergence risk concrete: `type-assertion-boundary.test.js` already carries a second near-duplicate `jsxTester` (the same block plus `jsx: true`), and `max-lines.test.js` runs a parser-less variant (no `parser:` key at all). Those are exactly the kinds of intentional deviation that a shared factory would make legible and an ad-hoc paste makes invisible.

This is tooling/dogfood code — the repo *is* the tool here, and per the project's drift-ai weighting that lifts it above the file-it bar — but it also sits under the repo's lowest coverage thresholds, so lowering the boilerplate friction of standing up a new RuleTester directly reduces the cost of adding the assertions called out in adjacent eslint-rules findings.

## Evidence
- `eslint-rules/concurrency-guard.test.js:8` — `new RuleTester({ languageOptions: { parser: tseslint.parser, parserOptions: { ecmaVersion: 2022, sourceType: "module" } } })`; the `languageOptions` block is byte-identical across all 17 files (a single md5 for the whole set; the exact digest is whitespace/extraction-method dependent, so no specific value is pinned). VERIFIED.
- `eslint-rules/no-explicit-any.test.js:8`, `structured-logging.test.js:8`, `strict-trpc-input.test.js:8`, `socket-registry-broadcasts.test.js:16` — the same config verbatim at the cited lines (the socket file offsets because of its extra `node:fs`/`typescript` imports). VERIFIED.
- `rg -l 'parser: tseslint.parser' eslint-rules/*.test.js` → 17 files; `rg -l 'import tseslint' eslint-rules/*.test.js` → 17 files; `rg 'new RuleTester' eslint-rules/*.test.js` → 19 instances across 18 files. VERIFIED.
- `eslint-rules/type-assertion-boundary.test.js:10` and `:17` — declares TWO testers (base `ruleTester` + a `jsxTester` adding `jsx: true`); the JSX variant is the second near-duplicate that a shared factory would also consume. VERIFIED.
- `eslint-rules/max-lines.test.js:7-11` — a parser-less variant (`languageOptions` with only `parserOptions`, no `parser:` key) that any factory must also be able to produce. VERIFIED.
- No shared helper module exists in `eslint-rules/` (`ls` finds no `*helper*`/`test-utils`/`rule-tester` file; no local helper import in any test). `eslint-rules/vitest.config.ts` pins `include: ["*.test.js"]` non-recursively with `root` set to the directory, so a sibling factory file (not matching `*.test.js`) is feasible and will not be swept up as a test. VERIFIED.

## Proposed direction
Add a tiny sibling module — `eslint-rules/rule-tester.js` (or `test-utils.js`) — that exports a small factory surface, and import it across the 17 files. The factory must cover the three observed shapes, so a single `extraParserOptions` arg is not enough:
- `makeRuleTester(extraParserOptions?)` — the base block; `extraParserOptions` merges into `parserOptions` for the common case.
- a `jsxRuleTester` (or `makeRuleTester({ jsx: true })`) for `type-assertion-boundary.test.js`.
- a parser-less variant (or a `{ parser: false }` option) for `max-lines.test.js`.

This is a pure refactor: every RuleTester `valid`/`invalid` case stays byte-for-byte unchanged, so coverage is fully preserved — only the construction of the tester is centralized. After the change, a parser-baseline move (ecmaVersion bump, parser swap, new default `ecmaFeatures`) is a one-line edit in the factory instead of a 17-file lockstep edit, and the two intentional deviations (JSX, parser-less) become named, reviewable variants instead of silent copies. Because the sibling file does not match the `*.test.js` include glob, it will not register as a vitest test.

Estimated impact: collapses 17 copies of the parser-baseline config to one factory; an ecmaVersion bump or parser switch drops from a 17-file lockstep change (with silent-divergence risk on a missed file) to a single edit. Zero coverage impact and zero added assertions — the RuleTester cases are untouched.

## Scope / caveats
TOUCH: the 17 `eslint-rules/*.test.js` files that instantiate the identical config, plus `type-assertion-boundary.test.js` (JSX variant) and `max-lines.test.js` (parser-less variant) if they adopt the factory, and a new sibling factory module. NOT-TOUCH: any RuleTester `valid`/`invalid` case, any rule source under `eslint-rules/*.js`. RISK: trivial — mechanical import substitution with no semantic change; the test run is the regression check. SEQUENCING: standalone; depends on nothing.

The factory deliberately handles three shapes (base / JSX / parser-less) — a single `extraParserOptions` arg is insufficient, so do not collapse `max-lines` into the same signature as the parser-bearing files without a parser-less escape hatch.

BOUNDARY: this is about config boilerplate (one named baseline vs. 17 pasted copies), distinct from any eslint message-regex / assertion-brittleness finding (those are about what the cases assert, not how the tester is built). It is also not a duplication/dead-code finding — nothing here is unused; the tests run today and keep running. Merged from the pass-2 observation "17 of 19 RuleTester instances duplicate the identical languageOptions config block with no shared factory"; the merge adds the explicit three-variant factory requirement and the vitest non-recursive-include feasibility note. Not covered by any other audit slug (none touch eslint-rules RuleTester config). Severity stays low: refactor-only, adds zero assertions and zero coverage, and the duplicated block is static and low-churn — tooling weighting keeps it above the file-it bar but does not promote pure boilerplate-dedup to medium.
