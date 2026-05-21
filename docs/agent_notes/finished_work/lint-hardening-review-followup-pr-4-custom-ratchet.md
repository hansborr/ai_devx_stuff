# Lint-Hardening Review Follow-Up PR 4 - Custom Ratchet

Date: 2026-05-19

Implemented the repo-native lint ratchet path for
`local/type-assertion-boundary`.

## Shipped

- Added `lint-ratchet.baseline.json` with one ratchet:
  `ratchet/local-type-assertion-boundary`.
- Added the ratchet registry, baseline comparator/update helpers, CLI runner,
  Vitest coverage, and shell smoke:
  - `scripts/lint-ratchet-config.ts`
  - `scripts/lint-ratchet-baseline.ts`
  - `scripts/lint-ratchet.ts`
  - `scripts/test-lint-ratchet.sh`
- `bun run lint:ratchet` emits the shared `harness-diagnostics` envelope and
  blocks only per-path count regressions.
- `bun run lint:ratchet:update` rewrites the baseline only when generated counts
  are equal/better, unless `--allow-worse --reason "<why>"` is supplied.
- `bun run lint:ratchet:check-baseline` validates deterministic baseline/config
  identity and allows improvement-only drift with a stderr note.
- Wired the ratchet into package scripts, CI, `verify.sh`, pre-commit,
  harness manifest/docs, changed-file relevance, and `test:scripts`.
- Added `docs/guides/lint-ratchet.md`.

## Baseline

The first baseline has 370 current `local/type-assertion-boundary` findings
across the configured package, script, and e2e TypeScript surfaces. Clean
ratchet runs emit zero findings.

## Runtime Budget (Leaf 04)

Measured on this devcontainer (Bun 1.3.12, Linux 7.0.8-200.fc44.x86_64,
otherwise-idle worktree) after Leaf 01 landed the rule-source hash. The
ESLint cache directory is keyed by `configHash + ruleSourceHash`, so a "cold"
run means the matching cache dir under
`node_modules/.cache/eslint-ratchet/ratchet-<safe-id>-<hash>/` has been
removed.

Three passes each:

- Cold (`rm -rf node_modules/.cache/eslint-ratchet/ratchet-*` then run):
  6.81s, 6.93s, 7.26s.
- Warm (immediately after the cold run): 1.40s, 1.42s, 1.55s.
- `lint:ratchet:check-baseline` warm: 1.43s.

The pre-commit hook fans out lint/typecheck/test in parallel; warm ratchet
runs ride that parallelism and finish before lint/typecheck dominate. Cold
runs add ~5–6s when an editor edits an `eslint-rules/<name>.js` source.

### Hook-budget decision

Pre-commit's soft budget is 210s, hard 240s (`.husky/pre-commit:167–168`).
Even back-to-back cold ratchet runs would sit comfortably under the budget.

Going into the next ratchet:

- Keep sequential ESLint runs. Parallelizing ratchets is unnecessary until
  warm runtime is >2s or two ratchets share files (which forces them into
  one ESLint pass anyway).
- Do not combine ratchets into a single ESLint invocation yet — the per-
  ratchet config/cache identity is what makes Leaf 01's cache invalidation
  work; a combined run would have to re-derive per-ratchet results from one
  shared cache.
- The local gate stays in pre-commit (warm). Cold runs only happen when a
  rule file changes, which is rare and human-noticed.

The next ratchet leaf can assume an additional 1–2s warm and 6–8s cold
overhead per ratchet at current findings density, and should re-measure if
its `files` glob expands the matched-files surface meaningfully.

## Re-measurement after Leaves 22/23 (2026-05-19)

Branch `feature/lint-hardening-review-followup` at `264fad98`, Bun `1.3.12`.
Three ratchets now active: `local/type-assertion-boundary` (existing),
`local/max-lines` (Leaf 08), `strict-boolean-expressions-shared` (Leaf 23,
first type-aware third-party ratchet).

- Cold `bun run lint:ratchet`: **9.975s** (was 6–8s with one ratchet)
- Warm samples: 3.071s, 3.086s, 3.086s → **median 3.086s** (was 1.40–1.55s)

The warm median now exceeds the original 1–2s budget by ~1.5s. The type-aware
strict-boolean entry contributes most of the new cost — its cache is disabled
by design (see `dfc7ec49 fix(lint): bypass eslint cache for type-aware ratchet`)
because the per-file cache can't track imported-type-dependency changes.

**Verdict:** the warm budget is breached. Pre-commit is still tolerable
(`verify:changed` parallelizes ratchet alongside lint/typecheck/test), but
the next type-aware ratchet would push warm runtime to ~4–5s, which starts
to be noticeable. Decisions to make before adding the next ratchet:

1. Parallelize ratchet runs within `lint:ratchet`. Each ratchet calls ESLint
   independently; they could be fan-out via `Promise.all`. Saves the most
   for warm runs where I/O dominates startup. Estimated effort: small
   (single helper change).
2. Combine ratchets into one ESLint invocation per parser profile. Would
   share ESLint startup but require cache-identity bookkeeping across
   multiple rule outputs. Larger surgery.
3. Move the type-aware ratchet to CI-only. Rejected after 2026-05-20 human
   clarification: external CI is not currently reliable enough to be the only
   enforcement point, so ratchets must remain in local/pre-commit verification.

Recommendation: option 1 first; revisit option 2 if warm stays > 4s after
parallelization. CI-only ratchets are not an acceptable fallback for this
project at present. Tracked as the next-ratchet-infra follow-up.

## Verification

- `bun run lint:ratchet`
- `bun run lint:ratchet:check-baseline`
- `bun run harness:check`
- `bun run docs:harness-controls:check`
- `bun run typecheck`
- `bun run lint`
- `bun run test:changed`
- `bun run test:scripts:changed` (full smoke fallback on this branch)
- `bash scripts/test-lint-ratchet.sh`
- `bash scripts/test-generate-harness-controls.sh`
- `bash scripts/test-harness-check.sh`
- `bash scripts/test-verify.sh`
- `bash scripts/test-dependency-freshness.sh`
- `git diff --check`

`bun run verify:changed` itself was not run from the unstaged edit worktree
because its changed gate requires source-relevant work to be staged first; its
component gates above were run directly.
