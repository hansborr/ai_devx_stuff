# Merge-driver field exercise — adversarial real-merge validation

Status: Parked — owner-requested deeper dive, scheduled AFTER the
agent-cli-consolidation-pass pack drains
Date: 2026-07-07
Source: owner ruling during the arch-review promotion pass. The semantic
min-merge baseline driver (`baseline-merge.ts`, landed `e8b9f7db`, hardened
`6a0106df`) passed unit tests and two adversarial reviews, but has never been
exercised in a real multi-contributor scenario — and won't be organically for
some time, which means real-world issues would crop up late. This exercise
manufactures that scenario early.

## Mission shape (owner-specified)

**Exercise the driver the way a contributor actually meets it — by *causing*
merge conflicts in scratch branches and resolving them — not by writing unit
tests.** Simulate several contributors working concurrently: create scratch
branches off a pinned base, make each perform realistic ratchet-touching work,
then merge them into each other and into the base in different orders,
observing what the driver does and what the contributor experience is at each
collision.

## Conflict classes to manufacture (at minimum)

- Two branches draining **different rules** (the classic cross-rule collision
  the driver was built for).
- Two branches draining the **same rule in different files** (the class
  per-rule sharding could not fix — the driver's headline claim).
- A drain colliding with a **regression** (`--allow-worse --reason` on one
  side).
- A drain colliding with a **retirement** (`--retire-ratchet` proof on one
  side).
- A **hand-edited** baseline vs a generated update (the hand-edit integrity
  gate should interact here).
- A merge in a **driverless clone** (no `.gitattributes` driver installed —
  the auto-install/health-check machinery's gap case).
- Same scenarios via **rebase and cherry-pick**, not just `merge` — custom
  merge drivers run through different plumbing paths; verify the driver
  actually engages in each.
- The `postMergeTruthUpRequired` escape hatch and
  `post-merge-baseline-preflight.ts` paths, triggered for real.

## Deliverables

- A findings note (conflict class × what happened × contributor experience ×
  verdict), plus fix/improvement leaves for anything rough.
- **If the driver proves insufficient in practice, that is the "new
  evidence" that reopens the per-rule sharding decision**
  (`harness-review-2026-07/13-baseline-sharding-per-ratchet.md`, currently a
  closed won't-do gate) — record the linkage explicitly either way.
- Cross-ref: `arch-review-2026-07/12-baseline-framework-and-max-lines.md`
  (baseline framework extraction) — if that leaf runs first, re-run the
  relevant classes on the extracted layer.
