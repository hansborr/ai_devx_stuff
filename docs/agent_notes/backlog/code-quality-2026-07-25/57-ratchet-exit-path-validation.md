# 57. Zero-baseline `exitPath` is validated as a non-empty string, and two ratchets point at a file that does not exist

Status: Proposed — not promoted
Theme: Harness pointers that go stale silently · Area: harness (`scripts/`, `tools/`) · Severity: low · Size: XS

Source: client-cluster pre-merge panel and adjudication, 2026-07-27 (surfaced
while refuting a different `exitPath` claim against slice Q3) · Confidence: high

**Evidence in this leaf is pinned to `709b27668` (`feat/cq-slice-h`); the defect
is pre-existing on `main` and unrelated to that branch.**

## Problem

When a ratchet's baseline drains to zero, `lint-ratchet` requires the config to
record a `zeroBaselineDisposition`. Two of the four disposition kinds
(`promote-to-normal-lint`, `temporary-ratchet-only`) additionally require an
`exitPath` — the document that owns the decision to promote the rule or retire
the ratchet. That pointer is what stops a drained ratchet from sitting
un-promoted forever.

`validateZeroBaselineDisposition`
(`tools/lint-ratchet/src/kernel/zero-baseline-disposition.ts`) checks only that
the string is non-empty. It never stats the path. So an `exitPath` can point at
a file that was renamed, moved, or never written, and every gate stays green
while the governance trail is broken.

**It has already happened.** `scripts/lint-ratchet/lint-ratchet-config.ts` line
50 declares:

```ts
const harnessReview202607Leaf37 =
  "docs/agent_notes/backlog/harness-review-2026-07/37-cheap-plugin-and-config-rule-adds.md";
```

used as the `exitPath` of two ratchet entries (lines 257 and 292). That file does
not exist. The directory contains `00-index.md`, `01-…`, `35-…`, `36-…` and
`40-…` — there is no leaf 37. Two drained-or-draining ratchets are therefore
pointing their exit at nothing, and nothing reports it.

## Evidence

- Validator: `tools/lint-ratchet/src/kernel/zero-baseline-disposition.ts` —
  the `exitPath` branch tests `(disposition.exitPath?.trim() ?? "").length === 0`
  and nothing else.
- Broken pointer: `scripts/lint-ratchet/lint-ratchet-config.ts:50`, consumed at
  `:257` and `:292`.
- `ls docs/agent_notes/backlog/harness-review-2026-07/` → no `37-*` file.
- The other three distinct `exitPath` values all resolve to real files
  (`finished_work/lint-followups-2026-06.md`,
  `harness-research-followups-2026-06/02-design-token-lint.md`,
  `lint-adoption-2026-07/12-broaden-error-semantics-coverage.md`), so this is a
  single rotted pointer, not a systemic mislabelling.

## Proposed direction

1. Add an existence check to `validateZeroBaselineDisposition`, failing with the
   ratchet id and the missing path. It is the same shape as the checks the
   harness already applies to other doc pointers, and it is cheap: the config is
   validated in-process during `lint:ratchet`.
2. Fix the two entries — either point them at the leaf that actually owns the
   decision or write the missing one. Deciding which is the owner's call, which
   is why this leaf does not do it.

## A weaker sibling worth noting, not fixing here

Existence is checkable; *ownership* is not. Two of the three resolving
`exitPath` targets contain no promotion decision — they are the right area but
do not record the ruling. Requiring an anchor (`file.md#section`) rather than a
bare path would narrow that gap, but it is a convention change across the pack
and should not ride along with a one-line validator fix.
