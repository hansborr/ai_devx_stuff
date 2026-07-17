# 18. Distinguish plugin-upgrade identity drift from real regressions, and surface equal-count finding swaps

Status: Done — half (a) classifies stale rule-source identity as findings-unchanged versus a real finding-set change while keeping the gate non-zero; half (b) equal-count swap visibility was already landed.
Lens: ratchet · Area: ux · Severity: low-med · Size: S · Confidence: high
Theme: ratchet-ux · Source: Musi AI-harness review 2026-07-01 (multi-agent + Codex second opinion + web research)

> **Fully landed** — default mode structurally re-parses a baseline only when stale `ruleSourceHash` failures are the sole strict-parse failure, collects and compares current findings, and classifies the still-failing gate message. `messagesFingerprint` remains the independent half (b) implementation consumed by `message-swap-info.ts`.

## Problem
Two small honesty gaps in what the gate tells you:
(a) `ruleSourceHash` deliberately embeds the installed plugin version (third-party) or ESLint version (core). A routine dependency bump therefore fails the gate even when findings are byte-identical — and it fails *before any collection runs*, as a `ConfigError` (exit 2) from baseline parsing, so the operator cannot tell "harmless identity refresh" from "the new plugin version finds different things". Correction found during verification: the current failure text already names the remediation — `"<id>.ruleSourceHash is stale (run \"bun run lint:ratchet:update\" to regenerate)"` — so the missing piece is not the command but the *classification* (counts unchanged vs. findings changed).
(b) `message-count` baseline items persist only `{ count }`. Fixing one violation and introducing another in the same file in the same change leaves the count equal, and the comparator emits nothing (regression only on `>`, improvement only on `<`), so the swap is invisible. Correction found during verification: the collector does capture `firstMessage`/`firstMessageId` on *current* items, but since the committed baseline stores no message identity there is nothing to compare against — detecting a swap requires persisting a fingerprint, not just surfacing collector data as the review originally implied.

## Evidence
- `/workspace/scripts/lint-ratchet/rule-source.ts:94-105` — third-party `sourceIdentity` includes `pluginVersion: readThirdPartyPluginVersion(...)` (`:100`); `:107` + `baseline-hash.ts:149-156` — core hash embeds `eslintVersion`. Verified.
- `/workspace/scripts/lint-ratchet/baseline-validation.ts:44-50` — the stale-hash failure and its message; `modes.ts:101-107,123` — it throws from `parseCommittedBaseline` *before* `collectCurrentById`, so no finding comparison ever happens on this path.
- `/workspace/scripts/lint-ratchet/lint-ratchet-baseline-compare.ts:130-166` — `countIncreaseRegression` fires only on `current.count > baselineCount`, `countDecreaseImprovement` only on `<`; equal count ⇒ `{}` (`:209-238`). Swap invisibility verified.
- `/workspace/scripts/lint-ratchet/current-collector.ts:120-128,42-51,71-79` — collector captures `message`/`messageId` per finding and keeps `firstMessage`/`firstMessageId` per current item; `baseline-format.ts:21-33` + committed baseline (items are `{ "count": n }` only) — none of it is persisted.

## Proposed direction
(a) On a ruleSourceHash-stale failure (and only that failure class), proceed to collect current findings for the affected ratchets, compare items against the committed baseline, and split the message: "identity drift only — findings unchanged; run `bun run lint:ratchet:update` to refresh hashes" (still non-zero, keeping the gate honest) vs. the normal regression/improvement report when the new version changed the finding set. Cheapest sequencing: catch the stale-hash `ConfigError` in `runDefault`, re-parse with `parseLintRatchetBaselineStructure` (shape-only), and run the existing comparison against it.
(b) Persist an optional, non-gating `messagesFingerprint` (sha256 of the sorted `messageId`-or-message list) on `message-count` baseline items, written by the same collector data; when counts are equal but fingerprints differ, emit an `info`-severity envelope finding ("finding set changed at equal count in <path>") — never a failure. Requires touching `metricItemForFormat`, item shape validation, and the deterministic formatter; one-time baseline churn on the next `--update`.

## Scope / caveats
- (a) and (b) are independent commits; (a) is the small high-value one. (b) is optional — if the baseline-shape churn is judged not worth an informational signal, close (b) explicitly rather than leaving it implied.
- (a) must not weaken the gate: identity drift still exits non-zero until `lint:ratchet:update` is run; the change is message classification only.
- (b)'s fingerprint must exclude line numbers (pure reformatting would otherwise flag) — hash rule message ids/texts only, and document that `message` text can itself change across plugin versions (which is fine: that IS a finding-set change under the new identity).
