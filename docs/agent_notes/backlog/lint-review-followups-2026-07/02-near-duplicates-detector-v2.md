# 02 — Near-duplicates detector v2: exact-clone tier + block detection

Status: Implemented, promotion blocked on an owner call — **both tiers landed on
main 2026-07-20** (merge `86ee756e`: jscpd block advisory `ee8b9946`, exact-clone
tier `635b49c6`/`c9cdd221`). The exact tier is report-only; promoting it to the
gate is the only remaining scope, and it is blocked on the corpus question below.
Track: S (sensors/gates) · Priority: P2 · Size: decision, then S

> **2026-07-25 re-verification.** The `Do` list below reads as unstarted work
> and will mislead a delegate into re-implementing shipped code. What exists at
> HEAD: exact tier in `scripts/drift-ai/near-duplicates-exact.ts` (3 lines / 15
> tokens, scoped to `eslint-rules/` + `scripts/`), jscpd advisory calibrated at
> `scripts/drift-ai/duplicates.ts:159-161` and registered as `duplicatesCheck`.
> The verify-slot precondition holds: `near-duplicates` is in all four consumer
> arrays at `scripts/verify/steps.generated.sh:12-15`, 1.5 s per run.
>
> Open owner question: the exact tier surfaces **589 identities above the
> 27-identity gated baseline** (the 535 figure below is stale), and the
> admission contract is strictly one-reasoned-identity-at-a-time. Hand-drain
> the corpus, or build a bulk migration path?
>
> **Sized 2026-07-25.** 616 findings = 616 identities (exactly 1:1), of which
> 589 are new. Those 589 come from only **74 equality groups** — a clique of
> *n* copies mints *n(n-1)/2* pair identities, so the top 10 groups are 495 of
> the 589. Buckets: 489 identities / 59 groups genuine extractable duplication;
> 100 / 15 structural coincidence; **0 test fixtures, 0 generated** (already
> handled by `EXACT_EXCLUDE_GLOBS`, so tightening scope wins nothing).
>
> Recommended path: **extract first, promote at the current floor.** Four
> refactors remove 429/589 (73%), three destinations already existing —
> `eslint-rules/ast-helpers.js` already exports byte-identical `unwrapChain`
> and a near-drop-in `staticPropertyName` and is already imported by 8 sibling
> rules (-84); shared `isRecord` (-201); `isCliEntrypoint` (-91);
> `errorMessage` (-53). Then fix bucket B in the detector: 85 of its 100
> identities are `valueOptions` property-value callbacks forced by
> `parseSubcommandArgs`. Residual ~75 identities / 44 groups.
>
> **Do not raise the line floor** — it is anti-correlated with value.
> `minLines: 4` cuts 589 to 164 but deletes `isRecord` x18 and `unwrapChain`
> x10 (both 3 lines, the most extractable groups) while keeping 4-line
> boilerplate. `minTokens` is dead below 30. Measured sensitivity:
> 3/20 = 446, 3/30 = 310, 4/15 = 164, 5/15 = 57, 6/15 = 17.
>
> If refactors are declined, the right bulk primitive is group-level
> (`--admit-group <equality-hash>`, 74 judgments), not count-level —
> `equalityGroups()` is already the detector's internal unit. Hand-draining
> all 589 means 589 serialized whole-repo rescans (~15-20 min, unparallelizable),
> 74 distinct reasons across 589 pastes, a ~330 KB baseline, and a rename tax
> of ~27 re-admissions per renamed file.
>
> Drifted citations: `near-duplicates.ts:55` → fingerprinting moved to
> `near-duplicates-fingerprint.ts`; `:154` → `candidateBuckets` /
> `statementBucketKey` at `near-duplicates.ts:158-165`; `:238` →
> `DEFAULT_NEAR_DUPLICATE_SIMILARITY` in `near-duplicates-config-values.ts:6`.
> The verify command `bun run test:scripts:file -- scripts/sensor-near-duplicates.test.ts`
> names a file that has never existed; the real covering tests are
> `sensor-near-duplicates-cli-options.test.ts`,
> `sensor-near-duplicates-merge-cli.test.ts`, `drift-ai/near-duplicates.test.ts`,
> `drift-ai/near-duplicates-exact.test.ts`, and
> `drift-ai/duplicate-blocks-advisory.test.ts`.

> **2026-07-25 — extraction steps 1-4 done** on `refactor/near-duplicate-extractions`
> (`b08f5f6f`, `8973351b`, `10dd8706`, `ed43a999`). Step 5 (detector fix for the
> `valueOptions` bucket, hand-drain of the residual, and the `includeExactTokens`
> flip) is untouched and still held by the orchestrator.
>
> Measured exact-tier identities, whole-repo `--scope current`: **589 -> 168
> (-421)**; fuzzy/gated baseline unchanged at 27 throughout. Per step, against
> the predictions above: ast-helpers **-81** (predicted -84; the group was
> `unwrapChain` x10 = 45 plus `staticPropertyName` x5 + `propertyName` x4 = 36,
> so 81 was all that existed); `isRecord` **-196** (predicted -201);
> `isCliEntrypoint` **-91** (exact); `errorMessage` **-53** (exact). Zero
> residual `isCliEntrypoint` or `errorMessage` groups remain.
>
> The `isRecord` 5-identity gap is fully accounted: 1 residual pair from
> deliberately skipping `sensor-knip-unused-exports-baseline.ts` and
> `sensor-near-duplicates-baseline.ts` (owned by `feat/suppression-identity-ledger`),
> and **+4 newly surfaced**: `hasErrorCode` was two separate 2-member groups and
> merged into one 4-member group once two of the four stopped calling `isObject`
> and started calling `isRecord`. Renaming a helper to a single spelling can
> *reveal* clone groups, because the exact tier keys on literal token text.
>
> **Step-5 input.** Residual is 168 identities / 65 groups. The largest is
> `--top` x12 (66); together the CLI option-name callbacks
> (`--top`, `--max-files`, `--since`, `--max-commits`, `--max-output-bytes`,
> `--timeout-ms`) are ~84 of the 168 — that is the `valueOptions` bucket the
> detector fix targets, so step 5's detector work plus this drain leaves ~84.
> New extraction candidates surfaced: `hasErrorCode` x4 (6),
> `round2`/`roundScore` x4 (6), the four `run*MergeCli` wrappers (6).

## Evidence (verified 2026-07-15 on feat/lint-adoption-2026-07 pre-land; re-verify before implementing)

- Size floors exclude small exact clones: `minLines = 8` / `minTokens = 45`
  defaults at `scripts/drift-ai/near-duplicates-config-values.ts:4`; the
  byte-identical `unwrapChain` trio in the effect-misuse rules (3 lines /
  18 tokens, similarity 1.000 when force-compared) was filtered out before
  comparison at `scripts/drift-ai/near-duplicates.ts:55` and never reached
  scoring. (The trio itself was drained on the branch; the class of miss
  remains.)
- (Moved out 2026-07-15: the config-vs-gate threshold disagreement became
  leaf 07, which landed `065266c4` and was removed at the 2026-07-19 triage
  — it was cheap and unconditional, and did not belong behind this leaf's
  earn-its-slot condition.)
- Whole-function granularity misses block duplication: candidates must share
  a sorted multiset of top-level statement hashes
  (`scripts/drift-ai/near-duplicates.ts:154`) before AST-feature Dice
  scoring against a 0.85 threshold (`near-duplicates.ts:238`). The three
  `lint-agent-envelope.ts` finding builders (29/25/21 lines, all eligible)
  were never compared; forced comparisons scored 0.51-0.76. A verbatim
  repeated assembly block inside otherwise-different functions is invisible
  even if introduced today.

Failure: the gate's blind spots are exactly the duplication agents produce
most — small copy-pasted helpers and repeated statement blocks — so the
detection-with-enforcement story has a hole a reviewer will keep finding by
hand.

## Do

Only if the gate keeps earning its verify slot; do NOT lower the global
near-clone floor (noise) or the 0.85 threshold (useless while the
statement-bucket prefilter stands).

1. Exact-clone tier: normalized AST/token equality with a small floor
   (~3 lines / 15 tokens), possibly scoped to `eslint-rules`/`scripts` where
   helper copy-paste concentrates.
2. Block/subtree detection for repeated statement sequences: start with a
   calibrated same-file-capable jscpd pass as a separate advisory sensor —
   only build in-house AST statement-window fingerprints if the advisory
   sensor proves block duplication recurs enough to justify the L-sized
   lift. (Threshold-config honoring split out to leaf 07.)

## Verify

```
bun scripts/sensor-near-duplicates.ts --check-baseline
bun run test:scripts:file -- scripts/sensor-near-duplicates.test.ts
bun run verify:changed
```

## Acceptance

A 3-line byte-identical helper pasted into two eslint-rules files is
detected; a verbatim 8-statement block repeated inside two different
functions is at least advisory-flagged; baseline stays shrink-only
throughout.

Sources: codex gate-miss investigation 2026-07-15 (recs 2-3);
Fable 5 adjudication (detector v2 leaf).

## 2026-07-20 implementation gate result (remeasured after review)

The jscpd repeated-block advisory landed at 8 lines / 60 tokens / mild mode,
and the parser-token exact tier landed in the opt-in `drift:ai
--check near-duplicates` report. The review-corrected implementation gates
extraction to eligible production scripts/ESLint files, collects terminal
tokens in one source walk, includes signature syntax, and reuses one canonical
sequence for hashing and grouping. The committed `bun
scripts/benchmark-near-duplicates.ts --samples 5` harness reproduces the exact
path at HEAD. Its warm median was 1.875 s versus fuzzy-only 2.282 s, and warm
median peak RSS was 449,404 versus 359,236 KiB, so the timing limits pass.
Blocking promotion remains open because the exact tier still adds 535
identities absent from the fuzzy baseline. That corpus cannot be
bulk-grandfathered under the required one-at-a-time admission contract; reduce
and review it before landing the conditional baseline-header and unique
count-admission migration.
