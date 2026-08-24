# Musi Pain-Point Backlog — 2026-07-29

Status: Planning-complete pack
Date: 2026-07-29

This pack reconciles the persisted Musi pain-point collection against the live
tree and existing backlog ownership. Evidence came from
`/home/node/persist/musi/pain_points.log`, its twelve routed topic notes, the
verbatim archive for exact incidents, the live repository at HEAD, and the
existing backlog and finished-work records.

This is an orchestration surface, not a second ready queue. The leaf designs are
resolved; promotion follows the repository's normal backlog process.
Rejections, verified fixes, and existing ownership are in
[the disposition ledger](01-sources-and-verdicts.md).

## Disposition

| # | Item | Priority | Size | Status |
| --- | --- | --- | --- | --- |
| 02 | [Bind adapter failure evidence to the producing worktree](02-parallel-verify-lane-isolation-plan.md) | P1 | S | Implemented |
| 03 | [Remove the load-sensitive queue timing assertion](03-remove-load-sensitive-queue-timing-assertion.md) | P1 | S | Implemented |
| 04 | [Retune the registration admission timeout](04-retune-registration-admission-timeout.md) | P1 | S | Implemented |
| 05 | [Retune the actionlint timeout](05-retune-actionlint-timeout.md) | P1 | S | Implemented |
| 06 | [Replace fixture setup sleeps with readiness signals](06-replace-fixture-setup-sleeps-with-readiness.md) | P1 | S | Implemented |
| 07 | [Route drift-guard inputs to scripts tests](07-route-drift-inputs-to-scripts-tests.md) | P1 | S | Closed (won't fix) |
| 08 | [Contain opportunistic worktree GC and fix peer checker resolution](08-contain-opportunistic-worktree-gc-failure.md) | P1 | M | Implemented |
| 09 | [Reject NUL bytes in staged source](09-reject-nul-in-tracked-source.md) | P2 | S | Implemented |
| 10 | [Centralize Radix JSDOM capabilities](10-centralize-radix-jsdom-capabilities.md) | P2 | S | Implemented |
| 11 | [Prevent backend output from forging wrapper records](11-authenticate-agent-completion-anchors.md) | P1 | S | Implemented |
| 12 | [Label memory-admission no-launch separately from test failure](12-label-memory-admission-no-launch.md) | P1 | M | Implemented |
| 13 | [Isolate doctor smoke temporary files](13-isolate-doctor-smoke-temp-files.md) | P1 | S | Implemented |
| 14 | [Reject shell smokes passed to the Vitest wrapper](14-reject-shell-smokes-in-vitest-wrapper.md) | P1 | S | Implemented |
| 15 | [Make agent-cli dispatch examples cwd-independent](15-make-agent-cli-examples-cwd-independent.md) | P1 | S | Implemented |

## Dependency and ordering edges

- Leaf 02 implemented the producer-bound failure-evidence compatibility repair.
  Leaf 12's semantic dependency on its footer-based directory resolution is
  therefore satisfied; eventual C8 S4 typed state propagation must preserve
  that contract.
- Leaves 03 and 06 implemented the fixture changes that leaf 12 must now
  preserve. Their former merge-order edges into 12 are resolved. Leaf 04
  implemented its distinct registration-region change and has no semantic edge
  with leaf 12.
- The former 15-before-06 merge-order edge is resolved because both leaves
  landed. Leaf 11's correlation design was permanently withdrawn; its smaller
  backend-output boundary filter is implemented with no waiter or grammar
  migration, so its former ordering edge after 06 is also resolved.
- Leaves 04, 05, 08-10, and 13-15 are implemented. Leaf 07 is closed as won't
  fix; full PR verification deliberately owns the drift-guard coverage gap.
- If code-quality leaf 27 starts before leaf 12, rebase leaf 12 onto its
  `test-pre-commit.sh` extraction rather than editing the old fixture location.

## Owner decisions before dispatch

- **Owner decision — 2026-07-29:** leaf 02's Bash footer repair is carved out
  of the C8 rider. C8 S4 remains the later typed command-policy owner and must
  preserve the producer-authoritative behavior leaf 02 establishes.
