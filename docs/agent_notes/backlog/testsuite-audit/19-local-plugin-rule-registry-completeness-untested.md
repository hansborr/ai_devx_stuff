# 19. No test asserts the local-plugin rule registry stays complete; `ALL_LOCAL_RULES` and `localPlugin.rules` drift independently

Status: Proposed — read-only finding from the test-suite audit; NOT implemented. Re-verify file:line before acting.
Lens: defect-catching · Area: eslint-rules · Severity: med · Size: S · Confidence: high
Theme: guard-the-guards registry drift · Source: Musi test-suite audit 2026-06-13 (multi-agent, adversarially verified)

## Problem
The local ESLint plugin is the repo's own dogfooded enforcement layer — the rules that catch barrels, swallowed errors, broadcast-in-transaction, and the tRPC/shared-schema contracts. Whether each of those rules actually runs, and whether each one is held to the meta-contract the suite enforces, depends on three hand-maintained registries of the same 18 rules staying in perfect lockstep, and **no test cross-checks them**:

1. `eslint-config/local-plugin.js` `localPlugin.rules` — the registry that actually wires rules into the lint run. If a rule is not a key here, it never executes against the codebase.
2. `eslint-rules/message-guidance.test.js` `ALL_LOCAL_RULES` — the parallel list the entire meta-contract suite iterates over (Why/How message shape, action-word presence, length, `pairedGuide` existence, `category`/`repairKind` validity). This array is built from its own explicit `import` block; it never imports `localPlugin`, so it is a hand-copied duplicate of the same set.
3. The implicit set of `eslint-rules/*.js` rule files on disk.

Two silent drift modes follow, both the exact omission class lint exists to catch:

(A) **Dead rule.** A new rule file is added with its own colocated test but forgotten in `localPlugin.rules`. `loadLintRuleDocs` (`scripts/lib/lint-rule-docs.ts:211`) enumerates *strictly* from `Object.entries(localPlugin.rules)` with no `readdir` and no filesystem awareness, so the rule is invisible to the lint run, to the doc generator, **and** to the ratchet registry check. Its colocated unit test passes in isolation while the rule enforces nothing in CI — zero coverage on the actual codebase, with a green suite that hides it.

(B) **Unguarded rule.** A rule is registered in `localPlugin.rules` but omitted from `ALL_LOCAL_RULES`. It runs in the lint, but it silently skips every meta-contract check — its messages could violate the Why/How shape, lack a paired guide, or carry an invalid `category`/`repairKind` and the suite would never notice, because the suite only iterates the hand-copied array.

Nothing guards the guards. The three registries are aligned 18/18/18 today purely by manual discipline, and the next rule addition is one forgotten paste away from either failure.

## Evidence
- `eslint-config/local-plugin.js:23-41` — `localPlugin.rules` object opens with `rules: {` at :23; the 18 rule entries span :24-41. This is the registry that actually wires rules into the lint run and it has no completeness test.
- `eslint-rules/message-guidance.test.js:40-58` — `ALL_LOCAL_RULES` hard-codes a parallel 18-entry list (`]` closes at :59) built from its own explicit imports with no link to `localPlugin`. Verified: `rg 'localPlugin|local-plugin'` across `*.test.*` returns no match, and `eslint-config/` contains zero `*.test.*` files — the plugin registry is never imported by any test.
- `scripts/lib/lint-rule-docs.ts:211` — `for (const [ruleName, rule] of Object.entries(localPlugin.rules))` enumerates **only** the plugin object with no `readdir`, so a rule omitted from `localPlugin.rules` is invisible to the lint run, the doc generator, and the ratchet registry check (proves the dead-rule consequence in mode A).
- `scripts/lint-ratchet/lint-ratchet-check-registry.test.ts:75-79` — `localRuleIds()` is the only test touching `loadLintRuleDocs`; it consumes the `localPlugin`-derived ids as trusted input (`new Set(entries.map((entry) => entry.id))`) and does **not** assert completeness against disk or against `ALL_LOCAL_RULES`, so it is not an existing guard.
- Counts align 18/18/18 today only by manual discipline: 18 plugin keys == 18 `ALL_LOCAL_RULES` ids == 18 rule files. The 19th non-test `.js` in `eslint-rules/`, `trpc-shared-schema-import-collector.js`, exports `createSharedSchemaImportCollector()` (:32) and is correctly not a rule.

## Proposed direction
Add one small test (under `eslint-rules/` or `eslint-config/`) that imports `localPlugin` and derives the rule set from the filesystem, then asserts the three registries agree:

1. `readdirSync` the `eslint-rules/` directory, keep `*.js`, drop `*.test.js`, and drop the one import-collector helper (`trpc-shared-schema-import-collector.js`) — this is the only file the readdir must special-case, and it is identifiable because it is not imported by `local-plugin.js`.
2. Assert every remaining rule file is registered in `localPlugin.rules` (closes drift mode A — the dead rule).
3. Assert `Object.keys(localPlugin.rules)` equals the set of `ALL_LOCAL_RULES` ids (closes drift mode B — the unguarded rule). The cleanest form imports `ALL_LOCAL_RULES` from `message-guidance.test.js`, or hoists it into a tiny shared module both can import; either keeps a single source of truth.

`eslint-rules/socket-registry-broadcasts.test.js:37` (`registryEventNames()`) models source-derived completeness checking — it parses a TS AST via `ts.createSourceFile` rather than `readdir`, so it is a pattern reference for "derive the canonical set from the source of truth, not a hand-copy", not an exact template.

Estimated impact: converts three silent drift modes into a hard test failure with no weakening of any existing assertion; eliminates two latent registry-drift defects (a dead unenforced rule; a rule skipping all meta-contract checks) before they can land on a future rule addition. Runtime cost is negligible — one `readdirSync` plus set comparisons, no lint invocation.

## Scope / caveats
Add one new test file under `eslint-rules` (or `eslint-config`); no source change to any rule, to `local-plugin.js`, or to `lint-rule-docs.ts`. Currently aligned 18/18/18, so this is **preventive** (no live defect today) — severity is held at med under the tooling/dogfood-weighting rule (the repo's own enforcement layer is tooling, not product code), not raised to high. Risk: low; the only subtlety is correctly excluding the `trpc-shared-schema-import-collector.js` helper from the filesystem-derived set, which the direction already specifies.

Boundary vs. adjacent findings: among the pack's 53 numbered slugs, three others touch `eslint-rules` — #14 (RuleTester placeholder substitution), #27 (eslint-rules message regex should use messageId), and #47 (eslint-rules RuleTester config no shared factory) — but they concern message *values* / RuleTester config, not registry membership, so none overlaps this finding's three-registry drift concern. Distinct from the message-guidance placeholder-substitution finding (which concerns message *values*, not registry membership) and from the codemod `runTwice` idempotence finding (which concerns codemod behavior, not rule registration). This finding pairs naturally with — but does not depend on — `message-guidance.test.js`'s existing meta-contract suite: it makes that suite's `ALL_LOCAL_RULES` input provably complete instead of trusted.
