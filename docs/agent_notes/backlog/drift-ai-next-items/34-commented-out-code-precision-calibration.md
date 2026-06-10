# 34 - commented-out-code precision calibration

Status: Done
Track: C
Size: S
Depends on: 32 (Done)
Blocks: none

## Goal

Tighten the opt-in `commented-out-code` check's operative-expression gate so terse
keyword-led prose trios stop being flagged, **once field data justifies the
recall trade**. Keep it deferred until then — the current behavior is acceptable
for an opt-in, report-only sensor.

## Background

Task 32 shipped the check. Its gate flags a run of `>= minLines` pure-comment lines
when the stripped snippet parses with zero `ts` parse diagnostics AND contains at
least one operative construct. Because the bar is met when *every* line is a lone
operative **expression statement**, a few keyword-noun prose trios slip through.
Validated false positives (3-line `//` runs, default `minLines: 3`):

- `delete user` / `delete post` / `delete comment` -> `delete` (most believable as
  real checklist prose)
- `await data` / `await users` / `await orders` -> `await`
- `score = wins` / `rank = score` / `tier = rank` -> `assignment`

Mitigations already in place keep this narrow: any line with a 3rd word or a stray
article breaks the parse, so realistic mixed-prose blocks stay quiet
(`First we delete the user.` and friends were verified quiet), and the check is
opt-in + report-only.

## What to consider (not a committed design)

A cheap tightening: in `operativeExpressionLabel` (`scripts/drift-ai/commented-out-code.ts`),
do **not** treat a top-level expression statement as operative when it is an
`await`/`delete`/`yield`/unary applied to a **bare identifier** (no call, member
access, element access, or further operator). Require a call / `new` / declaration /
control-flow / member-or-element-target assignment instead.

The trade is real recall: `delete this.cache`, `await flush()`, and
`config.value = next` are genuine commented-out code and must stay flagged, while
`delete user` (a lone identifier operand) would be dropped. That ambiguity is why
this is **calibration**, not a bug fix — pick the threshold from a labeled or field
run, the same evidence bar the pack uses for prototype promotion
([`01-shared-context.md`](./01-shared-context.md), "Prototype promotion criterion").

## Testing

- Extend `scripts/drift-ai/commented-out-code.test.ts` with the keyword-noun-trio
  prose cases above (assert quiet) and the genuine single-statement cases
  (`delete this.cache`, `await flush()`, member/element-target assignment) (assert
  flagged), so the precision and recall edges are both pinned.

## Completion Notes

- Implemented by moving the snippet parse/operative-expression gate into
  `scripts/drift-ai/commented-out-code-operative.ts` and making expression
  operands/assignment targets shape-aware.
- Bare-identifier `delete`/`await`/`yield` trios and bare-identifier assignments
  now stay quiet; member deletes, awaited calls, and member/element assignments
  remain flagged.

## Out of scope

- Reworking the parse-diagnostics gate or the block/region detection.
- Raising recall on multi-line fragments that fail to parse (a separate, opposite
  follow-up noted in task 32).
