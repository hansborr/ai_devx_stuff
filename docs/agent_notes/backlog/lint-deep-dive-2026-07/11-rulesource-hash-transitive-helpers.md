# 11. Local-rule `ruleSourceHash` ignores transitive helper imports — stale-cache false negatives once a ratcheted rule gains a helper

Status: Done — implemented on fix/lint-ratchet-correctness-lane.
Lens: ratchet · Area: rule-source hashing · Severity: med (latent high) · Size: M · Confidence: high
Theme: cache-correctness · Source: Musi lint deep-dive 2026-07-04 (3 parallel Codex xhigh lanes + Claude verification agents)

## Problem
`ruleSourceHash` for `local/*` ratchets hashes exactly one file: the rule's own
`eslint-rules/<rule>.js`. Minimal-ts ratchets also key their persistent ESLint
cache off that hash. A local rule that imports a helper module (the established
pattern — e.g. `trpc-shared-input-schema.js` imports
`trpc-shared-schema-import-collector.js`) can change behavior via a
helper-only edit: the hash stays identical, baseline validation sees no
rule-source drift, and cached per-file results are reused — newly detectable
violations are silently missed until an unrelated cache invalidation.

## Evidence
- `scripts/lint-ratchet/rule-source.ts:80-87` — `computeLocalLintRatchetRuleSourceHash` reads only `localRulePath(ratchet)`. Verified 2026-07-04.
- `scripts/lint-ratchet/eslint-config.ts:42-44` + `scripts/lint-ratchet/eslint-runner.ts:131-148` — minimal-ts profiles run ESLint with `--cache` under a config-hash-derived cache dir.
- `eslint-rules/trpc-shared-input-schema.js:9` — helper-import pattern exists in the local-rule family today.
- Latency check: the two *currently ratcheted* local rules (`no-arbitrary-tailwind-value`, `type-assertion-boundary`) have zero import statements — the gap is real but not currently load-bearing. Verified.

## Proposed direction
Hash the transitive relative-import closure for local rules: parse the rule
file for `./`-relative static imports (the local-rule format is plain JS with
static imports, so a small regex/AST walk suffices), recurse, and fold every
file into the hash in deterministic path order. Add a fixture test where
editing only the helper changes the hash and invalidates the ESLint cache.
Sequencing (2026-07-04 review): land the preflight guard first — refuse to
ratchet a local rule whose source contains relative imports — as its own
tiny commit; that is the piece that prevents silent wrongness. Closure
hashing then lifts the restriction at leisure.

## Scope / caveats
- Latent today; becomes live the moment a helper-using rule (the trpc-shared
  family, e2e selector rules) is ratcheted again. Cheap to fix before that.
- Keep hashing byte-based over the closure — no need to normalize whitespace;
  false invalidation is harmless, false reuse is not.
- Two commits: (1) preflight guard + test; (2) closure hashing + fixture
  tests, lifting the guard's restriction.
