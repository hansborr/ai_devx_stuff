# 21. The main ESLint lane is the only uncached ESLint in the harness — add `--cache` and measure

Status: Done — implemented on 2026-07-04 with `--cache --cache-strategy content` plus a type-graph, lint-policy, and dependency cache-location salt for the main lint lane.
Lens: pipeline · Area: lint performance · Severity: med-high · Size: S-M · Confidence: high
Theme: performance · Source: Musi lint deep-dive 2026-07-04 (3 parallel Codex xhigh lanes + Claude verification agents)

## Problem
`lint.sh` and `lint-changed.sh` run plain `eslint . --max-warnings=0` /
`eslint --max-warnings=0 <files>` with no `--cache`, while the ratchet runner
caches per-ratchet (minimal-ts profiles) and lint-agent caches under
`node_modules/.cache/eslint/`. Full-scan lint is the single most expensive
lane in the gate and reruns from scratch every time — including the
config-triggered full-scan escalations inside pre-commit.

## Evidence
- `scripts/lint.sh:32`, `scripts/lint-changed.sh:47,69` — no cache flags. Verified 2026-07-04 (Explore trace).
- `scripts/lint-ratchet/eslint-runner.ts:131-148`, `scripts/lint-agent.ts:28-36` — the sibling invocations that do cache.

## Proposed direction
Add `--cache --cache-location node_modules/.cache/eslint-main/ --cache-strategy content`
to both entry points, then measure warm/cold full-scan wall time before
declaring victory. Two correctness cautions to test explicitly:
1. Type-aware rules: projectService diagnostics can change when *other*
   files change; content strategy keys on the linted file only. ESLint
   invalidates on config change but not on cross-file type drift. Verified
   2026-07-04: the main config applies `strictTypeChecked` to all
   `**/*.{ts,tsx,mts,cts}` (`eslint-config/base-configs.js:78-80`), so this
   caution is load-bearing, not theoretical. The implemented hardening folds a
   working-tree type-graph fingerprint into the cache location so cross-file
   type drift busts the whole cache without relying on generated declarations
   being fresh before lint starts.
2. `--max-warnings=0` interacts with cached warning entries — confirm cached
   files re-report warnings.

## Scope / caveats
- If (1) proves unsafe even with the fingerprint salt, the fallback is
  caching only in local/changed loops and keeping CI uncached — but note
  that recreates the local-green/CI-red late-failure shape leaf 13 exists
  to eliminate; prefer the salt.
- One commit: flags + a measurement note in the commit body + doc line in
  the lint guide family.

## Implementation notes
- `scripts/lib/eslint-main-cache.sh` computes the cache args used by
  `scripts/lint.sh` and `scripts/lint-changed.sh`.
- Cache location is
  `node_modules/.cache/eslint-main/identity-<fingerprint>/.eslintcache`, where
  `<fingerprint>` hashes working-tree type-graph inputs (`*.ts`, `*.tsx`,
  `*.mts`, `*.cts`, `tsconfig*.json/jsonc`, and `tsconfig.tsbuildinfo`) plus
  lint-policy inputs (`eslint.config.*`, `eslint-config/**`, and
  `eslint-rules/**/*.js`) plus dependency identity (`package.json` and
  `bun.lock`), excluding tool/cache dirs and `node_modules` at any depth.
  Source type edits therefore move to a fresh cache even when generated
  declarations are stale, local rule/config edits cannot reuse old per-file
  findings, and package/plugin/dependency edits invalidate diagnostics that
  read installed or declared dependency state.
- The salt is NUL-delimited and hashed in one Node process, with
  `missing:<path>` semantics for files that disappear between discovery and
  hashing. `--cache-location` is repo-absolute, and stale
  `identity-*` cache directories are pruned when the current identity is
  selected.
- Focused coverage: `scripts/tests/test-lint-changed.sh` asserts cache args
  on changed-file and full-scan paths, proves source type-graph edits,
  declaration edits, tsbuildinfo edits, lint-policy edits, dependency edits,
  and `bun.lock` edits change the salt; it also covers nested `node_modules`
  pruning, newline-containing paths, missing-path hashing, absolute cache
  locations, and stale identity cache pruning. The existing selection tests
  keep config/rule-change full-scan triggers covered.
  `scripts/tests/test-lint-dist-preflight.sh` covers wrapper sourcing after
  dist repair.
