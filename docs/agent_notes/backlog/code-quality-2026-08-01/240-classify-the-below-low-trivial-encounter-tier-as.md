# 240. Classify the below-Low Trivial encounter tier as Musi policy

Status: Not started
Theme: Classify the below-Low "trivial" encounter tier as Musi policy · Area: shared · Severity: low · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The encounter calculator attributes its XP-budget system to the 2024 Dungeon
Master's Guide and describes the sourced Low, Moderate, and High thresholds,
then adds an unqualified fourth result below Low. Because `trivial` appears
beside the sourced vocabulary in the exported type and user interface,
maintainers and users can reasonably infer that it is also DMG terminology.

The behavior is protected by shared tests, but their names call the result
simply trivial rather than identifying it as Musi application policy. The
implementation therefore misses the repository's explicit provenance rule for
non-SRD rules behavior.

## Evidence

- `packages/shared/src/rules/encounter-difficulty.ts:2-8` — the module
  attributes the calculator to the 2024 DMG and describes Low, Moderate, and
  High as the sourced XP-budget thresholds.
- `packages/shared/src/rules/encounter-difficulty.ts:14,93-97` — the exported
  rating vocabulary places `trivial` beside those three names, and the
  calculator assigns it to every XP total below the Low threshold.
- `packages/shared/src/rules/encounter-difficulty.test.ts:22-35,161-169` —
  two shared tests directly protect trivial results for below-Low XP and for
  an encounter with no monsters, but neither test name identifies the result
  as Musi policy. Re-derived at the pin: `rg -c
  'expect\(result\.rating\)\.toBe\("trivial"\)'
  packages/shared/src/rules/encounter-difficulty.test.ts` returns 2.
- `packages/client/src/components/campaign/encounters/difficulty-styles.ts:10-14`
  — the client renders “Trivial” directly beside Low, Moderate, and High.
- `docs/guides/change-rules-logic.md:7-10,38-40` — rules behavior must be
  classified as SRD, a named non-SRD source, or Musi policy, and a
  policy-protecting test name must state the policy it protects.

## Proposed direction

Amend the encounter-difficulty rule comment to distinguish the sources
explicitly: Low, Moderate, and High and their XP budgets come from the 2024
DMG, while assigning the below-Low range the `trivial` result is Musi
application policy. Place that qualification beside the calculator's existing
provenance explanation so a reader does not need to infer it from a distant
guide.

Rename both shared tests that directly protect a `trivial` result so their full
names identify the classification—for example, below-Low XP is rated trivial
under Musi policy, including the zero-monster case. Keep their fixtures and
assertions unchanged.

Treat this as a provenance-only change: review should show only rule-comment
and shared test-name edits. The exported union, threshold table, fallback
branch, client labels/styles, and client presentation tests remain untouched.

## Scope / caveats

- Do not label the Trivial tier as SRD or DMG content. The explicit
  classification is Musi application policy.
- Do not change thresholds, calculations, result vocabulary, capitalization,
  styles, or the user-facing “Trivial” label.
- Do not rewrite the DMG attribution for the three sourced thresholds or add
  copied rules prose. The change is a concise source boundary.
- The prior-pack residual is `CQ25-95` in
  [code-quality-2026-07-25/CONSTRAINTS.md](../code-quality-2026-07-25/CONSTRAINTS.md):
  line 30 already establishes the standing provenance and test-naming rule.
  This leaf supplies the missing classification for this live tier; it does
  not reopen or revise that general rule.
- [100-shared-local-documentation-carries-stale.md](./100-shared-local-documentation-carries-stale.md)
  corrects three different shared documentation claims, including an
  `xp.ts` source label. It does not classify this encounter tier, and no
  ordering is required.
