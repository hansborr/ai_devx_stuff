# 12. Semantic baseline merge silently drops `messagesFingerprint` on equal-count items

Status: Done — implemented on fix/lint-ratchet-correctness-lane.
Lens: ratchet · Area: merge lane · Severity: med · Size: S · Confidence: high
Theme: merge-safety · Source: Musi lint deep-dive 2026-07-04 (3 parallel Codex xhigh lanes + Claude verification agents)

## Problem
When both merge sides carry the same per-file count for a `message-count`
ratchet, the semantic merge driver returns a bare `{ count }` — discarding
`messagesFingerprint` even when both sides agree on it. The fingerprint is the
data the collector uses to detect equal-count message *swaps* (one violation
fixed, a different one introduced, net count unchanged). After any driver-level
merge, that detection is blind for the affected files until a later
`lint:ratchet:update` regenerates fingerprints. The merge tests only exercise
count-only fixtures, so nothing pins the current behavior as intentional.

## Evidence
- `scripts/lint-ratchet/baseline-merge.ts:122-135` — `mergeSameCountItem` for the message-count metric: `return { count: left.count };`. Verified 2026-07-04.
- `scripts/lint-ratchet/message-swap-info.ts:13-31` + `scripts/lint-ratchet/current-collector.ts:156-187` — fingerprint is what powers equal-count swap diagnostics.
- `scripts/lint-ratchet/baseline-merge.test.ts:17-35` — fixtures are count-only; no fingerprint-preservation case.

## Proposed direction
Preserve the fingerprint when both sides agree. When equal counts carry
*different* fingerprints, do not guess: either fail the semantic merge for that
entry (falling back to the manual recipe for just that path) or keep a
deterministic side and emit the truth-up marker from leaf 10 so the post-merge
check regenerates honestly. Add merge tests for: agreeing fingerprints
(preserved), disagreeing fingerprints (chosen policy), one-side-missing
(regenerate path).

## Scope / caveats
- Pairs naturally with leaf 10 (truth-up escalation) — the disagreeing-
  fingerprint case is precisely a "merged tree needs re-collection" signal.
- Keep the driver's output byte-deterministic (`baseline-format.ts` ordering
  rules) when adding fields back.
- One commit: merge logic + tests.
