# 03 — lint-agent uses a different, unsalted ESLint cache

Status: Done
Track: T (tooling) · Priority: P2 · Size: S

## Evidence (verified 2026-07-11; re-verified in 2026-07-11 adversarial triage; re-verify before implementing)

- `scripts/lint-agent.ts:33-34` — hardcodes `node_modules/.cache/eslint/` as
  its `--cache-location`, with the default `--cache-strategy` (metadata,
  i.e. mtime+size), and nothing ever prunes or invalidates that directory.
- `scripts/lib/eslint-main-cache.sh` — the main lanes (`scripts/lint.sh`,
  `scripts/lint-changed.sh`) source this lib and cache under
  `node_modules/.cache/eslint-main/identity-<fingerprint>/`, where the
  fingerprint hashes every input that can change diagnostics for otherwise
  unchanged files (all TS sources, `tsconfig*`, `eslint.config.*`,
  `eslint-config/*`, `eslint-rules/*.js`, `package.json`, `bun.lock`), plus
  `--cache-strategy content`. Stale `identity-*` siblings are pruned.
- The ratchet lane is separately salted: `scripts/lint-ratchet/eslint-runner.ts`
  and `eslint-config.ts` key `node_modules/.cache/eslint-ratchet/` entries by
  ratchet config + rule-source hash (`cacheKeyHashFor`). So the agent envelope
  is the **only** ESLint surface with no salt-based invalidation — not
  "everything else uses eslint-main", but everything else has an equivalent
  policy.
- Why ESLint's built-in invalidation does not save it:
  `node_modules/eslint/lib/cli-engine/lint-result-cache.js` hashes
  `stringify(config)` — an option edit in `eslint.config.*` does invalidate,
  but rule *implementations* are functions that the stable-stringify drops, and
  type-aware diagnostics depend on other files the metadata strategy never
  looks at.

Failure: edit a local rule in `eslint-rules/*.js` (or a `tsconfig`/type-graph
input), then run `lint:agent:local-rules` — the envelope serves pre-change
findings for every file whose mtime didn't change, because neither ESLint's
config hash nor the metadata cache key moved. That is exactly the
rule-development workflow this envelope exists for, and its findings then
disagree with the salted gate lanes until someone manually clears
`node_modules/.cache/eslint/`.

## Do

Give the agent envelope the same invalidation policy as the main lane —
without a second implementation of the fingerprint:

- Preferred: have `lint-agent.ts` obtain the salted cache args by shelling
  out to the existing lib (`bash -c '. scripts/lib/eslint-main-cache.sh &&
  musi_eslint_main_cache_args && printf "%s\n"
  "${MUSI_ESLINT_MAIN_CACHE_ARGS[@]}"'`) and pass them through, sharing the
  main lane's cache dir (same flat config, so entries are compatible and
  mutually warming) and inheriting `--cache-strategy content` plus pruning.
- Acceptable fallback if the shell-out is judged too fiddly: drop `--cache`
  from `lint-agent.ts` entirely; correctness beats a cache that can lie.
- Do NOT reimplement the fingerprint in TypeScript — two salt
  implementations will drift.

## Verify

```
bun run lint:agent:local-rules
bun run test:scripts:changed
# edit a local rule in eslint-rules/ → rerun lint:agent:local-rules →
# findings reflect the edit with no manual cache clear
```

## Acceptance

A change to any salt input (local rule source, eslint config, tsconfig, TS
sources) invalidates the agent envelope's cache exactly as it does the main
lint cache; no ESLint surface can serve pre-change findings, and only one
implementation of the salt exists.
