# 01 — Baseline truth checks at integration boundaries

Status: Done — `99fe7815`/`164191b6`/`0cec8cd5`/`2e586eff` (blocking pre-push near-duplicates boundary gate; env-failures surface but don't block; truth-up exit-code attribution; `scripts/git/baseline-drivers.sh` registry)
Track: S (sensors/gates) · Priority: P1 · Size: M

## Evidence (verified 2026-07-15 on feat/lint-adoption-2026-07 pre-land; re-verify before implementing)

- Proven live miss: `bun scripts/sensor-near-duplicates.ts --check-baseline`
  failed on the assembled branch with 3 unbaselined
  `eslint-rules/no-unbounded-promise-all.js#staticPropertyName` pairs. One
  lane introduced the rule while the gate lane generated its baseline from a
  different parent; merge commits skip pre-commit; the post-merge truth-up
  only fires on the semantic merge-driver marker — so no boundary check ever
  ran whole-tree.
- `scripts/git/near-duplicates-post-merge-baseline-truth-up.sh:31-37` —
  discards the check's output (`>/dev/null 2>&1`) and reports every non-zero
  exit as "stale baseline" with the `--restore-merge-truth` recipe, so an
  infra/env failure gets the wrong recovery instructions (the knip/ratchet
  truth-up scripts surface their output).
- `.husky/post-commit:86-90` and `.husky/post-merge:2-11` — the baseline
  driver/marker names are hand-maintained as parallel lists in three-plus
  places; the nearby "three stats" comment was already stale when the
  near-duplicates driver made the lists four wide.
- Partial fix already on the branch: full verify's near-duplicates slot was
  switched to `--check-baseline` (DO NOW commit B). What this leaf carries is
  the unconditional boundary check outside full verify, the truth-up
  error-attribution fix, and the driver registry.

Failure: parallel-lane integration can assemble a branch whose committed
baseline is stale without any blocking signal until land-time full verify —
and before commit B, not even then; wrong truth-up advice then sends the
operator down the restore path for what may be an environment failure.

## Do

1. Make **pre-push** the blocking boundary: an unconditional whole-tree
   baseline truth check that fires whenever scanned source or the baseline
   changed — not conditional on the merge-driver marker. Pre-push over
   post-merge is deliberate (decided 2026-07-15): post-merge hooks cannot
   block anyway, and a whole-tree scan on every routine `main` pull into a
   lane would tax exactly the multi-lane flow this protects; pre-push runs
   rarely and is the last exit before integration. Post-merge keeps the
   existing advisory truth-up, with item 2's error attribution fixed.
2. Make `near-duplicates-post-merge-baseline-truth-up.sh` surface the
   check's actual output and exit code, recommending `--restore-merge-truth`
   only on a genuine baseline mismatch.
3. Replace the hand-maintained hook lists with one sourced registry of
   baseline driver names that checkout/merge/commit hooks loop over; delete
   the stale count comment. Model on how the existing
   `install/check-baseline-merge-driver.sh` shims are shared.

## Verify

```
bun scripts/sensor-near-duplicates.ts --check-baseline
bun run harness:check
bun run verify:changed
```

## Acceptance

A synthetic two-lane merge that adds an unbaselined duplicate on one lane
fails the pre-push check, not land-time full verify; a routine merge with no
scanned-source or baseline changes pays no whole-tree scan; a truth-up run
against a broken environment prints the underlying error instead of the
restore recipe; adding a fifth baseline driver means editing one registry
entry, and a test pins that the hooks consume the registry.

Sources: codex gate-miss investigation 2026-07-15; Grok cross-review P2;
Fable 5 adjudication (integration-boundary hardening leaf).
