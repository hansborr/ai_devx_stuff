# Leaf 1: Ratchet Cache Invalidation

Status: Resolved (2026-05-19, commit `74ada44c`)
Source: `docs/agent_notes/backlog/lint-ratchet-followups.md`

## Resolution (2026-05-19)

Implemented in `74ada44c feat(lint): bind ratchet cache to local rule source`
(plus follow-ups `18823fb4` for third-party identity, `dfc7ec49` for the
type-aware cache bypass).

- `computeLintRatchetRuleSourceHash` in `scripts/lint-ratchet.ts:214` hashes
  the local rule implementation content (third-party ratchets use a synthetic
  identity from `pluginModule` + `pluginVersion` + namespace).
- `cacheKeyHashFor` mixes the ratchet config hash with the rule source hash,
  and `eslintConfigPathFor` / `eslintCachePathFor` namespace the on-disk
  cache by that combined identity.
- `validateBaselineAgainstRegistry` in
  `scripts/lint-ratchet-baseline.ts:664` rejects stale `ruleSourceHash`
  values, so a baseline cannot bind to a rule whose implementation has
  drifted.
- Smoke fixture "rule source change invalidates cached findings" lives in
  `scripts/test-lint-ratchet.sh:560` and proves a rule-implementation edit
  forces a re-run.
- Vitest coverage: "lint ratchet rule source hash binding" describe block in
  `scripts/lint-ratchet-baseline.test.ts:467`.

See also: [[02-ratchet-update-stale-metadata]], [[26-ratchet-rename-count-protection]].

## Problem

`lint:ratchet` caches ESLint results under a key derived from ratchet config.
If a ratcheted local rule implementation changes under `eslint-rules/*.js`,
unchanged source files can reuse stale cached findings.

## Scope

Include the content hash of each ratcheted local rule implementation in the
generated ESLint config/cache key. Disabling ESLint cache is acceptable only if
runtime measurements show it still fits the pre-commit and changed-verify
budget.

Likely files:

- `scripts/lint-ratchet-config.ts`
- `scripts/lint-ratchet.ts`
- `scripts/lint-ratchet-baseline.ts`
- `scripts/test-lint-ratchet.sh`

## Candidate Work

- Resolve the `local/*` rule module path for each ratcheted rule.
- Hash the local rule implementation content and include it in the ratchet
  config identity used by ESLint cache location or generated config.
- Keep third-party rule handling explicit. If only local rules are supported
  for this invalidation path, fail loudly for an unsupported ratcheted rule
  namespace rather than silently omitting it from the key.
- Add smoke or fixture coverage proving that changing a local ratcheted rule
  invalidates the cached result for otherwise unchanged source.

## Exit Criteria

- A changed ratcheted rule implementation cannot reuse stale cached results.
- Cache identity remains deterministic and reflected in baseline validation
  where needed.
- Existing `lint:ratchet` and `lint:ratchet:check-baseline` behavior remains
  stable on a clean tree.

## Verification

- `bun run lint:ratchet`
- `bun run lint:ratchet:check-baseline`
- `bash scripts/test-lint-ratchet.sh`
- `bun run test:scripts:changed`
- `bun run lint`
