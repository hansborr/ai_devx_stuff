# Lint Review Follow-ups 2026-07 — Task Pack

Status: Task index
Created: 2026-07-15

Source: a 2026-07-15 three-model cross-review (Opus, GPT/codex, Grok 4.5) of
`feat/lint-adoption-2026-07` plus a codex forensic investigation of why the
leaf-10 near-duplicate gate missed duplication on its own branch, adjudicated
by a Fable 5 pass that re-verified every finding against the live tree. The
DO NOW items (helper drain, `--check-baseline` in full verify, rule polish,
envelope/trace cleanups, branch collapse) were fixed on the branch itself;
this pack carries only the deferred remainder.

Caveat: Evidence line numbers were verified 2026-07-15 against
`feat/lint-adoption-2026-07` **pre-land** — the same-day DO NOW commits touch
several cited files. Re-verify every citation at HEAD before implementing.

## Task List

Tracks: **S** sensors/gates · **T** tooling/config · **C** client.

| # | Task | Track | Size | Priority | Status |
| --- | --- | --- | --- | --- | --- |
| 01 | [Baseline truth checks at integration boundaries](./01-integration-boundary-baseline-truth-checks.md) | S | M | P1 | Done — `99fe7815`/`164191b6`/`0cec8cd5`/`2e586eff` |
| 02 | [Near-duplicates detector v2: exact-clone tier + block detection](./02-near-duplicates-detector-v2.md) | S | L | P2 | Ready |
| 03 | [Baseline admission artifact + rename migration](./03-baseline-admission-and-rename-migration.md) | S | M | P2 | Done — `4a260e12` |
| 04 | [lint-message-eval: paired iteration delta](./04-lint-message-eval-paired-delta.md) | T | S | P3 | Done — `952d67eb` |
| 05 | [combat-map-bridges test fixture builder](./05-combat-map-bridges-fixture-builder.md) | C | S | P3 | Ready |
| 06 | [Compose structural ignore lists in shared-policy](./06-compose-structural-ignore-lists.md) | T | M | P3 | Done — `3f2ca4d2` |
| 07 | [Near-duplicates gate honors configured thresholds](./07-gate-honors-configured-thresholds.md) | S | S | P2 | Done — `065266c4` |

## Recommended Order

1. 01 first — it closes the proven-live failure mode (a stale baseline
   surviving parallel-lane integration) that the review actually caught.
   07 (split out of 02 on 2026-07-15) is small and unconditional; do it
   with or right after 01.
2. 03 next if renames or new admissions start hurting; 02 only if the gate
   keeps earning its verify slot.
3. 04, 05, 06 are independent; 05 is opportunistic (next movement-test
   change), 06 depends on the `*test-helper*` glob widening landed with the
   DO NOW set.

## Ruled out 2026-07-15 (do not re-file)

- Dialog `withOpenResetKey` wrapper for the ~15 keyed-remount export shells —
  documentation-by-example of the client-effects guide beats the abstraction
  while the dialog count is static (Grok anti-recommended its own finding).
- Symmetric path analysis in `no-swallowed-errors-paths.js` — the narrow
  syntax-proven posture is documented in-file, misses conservatively, and a
  second reviewer endorsed the current analysis as sound.
- Receiver-provenance machinery for `fetchQuery`/`prefetchQuery`/
  `ensureQueryData` in `no-effect-misuse.js` — TanStack-distinctive names,
  fires only inside effects; the deliberate asymmetry is now documented in
  the rule instead.
- `bad-comparison-sequence` AST-shape boolean check for untyped contexts —
  real false positive, zero exposure (typed lint covers all packages; the
  pattern appears nowhere in-repo).
- Deleting the demo `diagnostics.ts` copy (demo-sync requires it) and any
  pre-built shared baseline-CLI abstraction for a hypothetical fifth sensor
  (YAGNI).

## Promotion Rules

1. Promote one leaf at a time; read its Evidence block and re-verify every
   citation at HEAD before editing — line numbers drift, and this pack's
   citations predate the branch's own DO NOW commits.
2. Keep each leaf to one commit unless the leaf says otherwise; update this
   index's Status column in the same commit that finishes a leaf.
