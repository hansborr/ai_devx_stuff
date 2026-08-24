# 90. The lint-ratchet demo omits the flock prerequisite and misstates its debt invariant, while the live zone-cap comment cites a deleted ruling and calls a landed package move pending

Status: Landed on fix/cq-081
Theme: Public adoption docs accuracy · Area: docs · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The lint-ratchet demo is the repo's flagship copyable example — the artifact an
external adopter is told to walk through and then imitate. Its Requirements
section lists exactly two things: Bun and a `git`-tracked checkout. But step 4
of the "Make it yours" recipe sends every clone through the baseline
merge-driver installer, and that installer invokes `flock` with no preflight.
`flock` ships with util-linux — present on stock Linux, absent on stock macOS —
so an adopter who satisfies every documented requirement can still come out of
the recipe with no merge driver installed. Worse, the failure is silent-ish:
because the installer is deliberately advisory (`warn_and_exit` exits 0 so
package `prepare` and Git hooks never hard-fail), a missing `flock` emits Bash's
`flock: command not found` diagnostic, then the misleading WARN "could not
acquire merge driver attributes lock", and still exits successfully. For
exactly the audience this public harness-reference repo targets, the flagship
example fails while returning success and without a deliberate prerequisite
diagnostic.

The same walkthrough deliberately demonstrates the supported explicit-increase
workflow: accept a third finding with `--allow-worse` and a recorded reason.
Immediately afterward, its cleanup step summarizes the lifecycle by saying debt
can only trend down. That statement contradicts the workflow the reader just
performed and obscures the real governance invariant: debt cannot change
silently. Increases require explicit reasoned acceptance, while decreases
require the tightened baseline to be updated and committed.

Separately, the live zone-policy comment in
`eslint-config/code-quality-configs.js` — the prose that justifies the engine's
500-line cap zone — still describes the engine's move to `tools/lint-ratchet`
as future work ("Carried to `tools/lint-ratchet/**` when the engine moves") and
cites its ruling at a leaf file that was deleted when the 2026-07-18 landed
record replaced it. The glob list six lines below the comment already covers
`tools/lint-ratchet/**/*.ts`, so a maintainer reviewing the exceptional zone is
told a completed move is pending and is pointed at a file that does not exist.

## Evidence

- `examples/lint-ratchet-demo/README.md:30-34` — the Requirements section lists
  only Bun and a `git`-tracked checkout. The exact pinned measurement
  `git grep -n 'flock' ebf096580b31f604861fadb3d4cbd4079da4f017 -- examples/lint-ratchet-demo/README.md`
  returns no matches.
- `examples/lint-ratchet-demo/README.md:100-103` — adoption step 4 tells each
  clone to copy `scripts/git/*` and run
  `bun run lint:ratchet:install-merge-driver`; that script exists at
  `examples/lint-ratchet-demo/package.json:13`, with the root counterpart at
  `package.json:99`.
- `scripts/git/install-baseline-merge-driver.sh:106-109` — the shared installer
  opens the lock file descriptor and invokes `flock` without a `command -v`
  guard; when the binary is missing, the `||` branch reports that it could not
  acquire the lock rather than naming the missing prerequisite.
- `scripts/git/install-baseline-merge-driver.sh:17-18,29-33` — the installer
  explicitly has advisory semantics, and `warn_and_exit` exits 0, so a failed
  install still reports success to `prepare` and hooks.
- `scripts/git/install-baseline-merge-driver.sh:1-125` and
  `examples/lint-ratchet-demo/scripts/git/install-baseline-merge-driver.sh:1-125`
  — the copies are byte-identical at the pin:
  `git diff --no-index --exit-code scripts/git/install-baseline-merge-driver.sh examples/lint-ratchet-demo/scripts/git/install-baseline-merge-driver.sh`
  exits 0.
- `scripts/git/install-lint-ratchet-merge-driver.sh:21-22`,
  `scripts/git/install-knip-unused-exports-merge-driver.sh:21-22`,
  `scripts/git/install-max-lines-exceptions-merge-driver.sh:21-22`, and
  `scripts/git/install-near-duplicates-merge-driver.sh:14-15` — all four
  per-metric shims source the shared installer body, so one preflight there
  covers every installer; the demo ships only the lint-ratchet shim.
- `examples/lint-ratchet-demo/README.md:65-86` — the walkthrough accepts an
  increase from two findings to three with `--allow-worse` and a recorded
  reason (`:65-73`), then reduces the count and concludes, "Debt can only trend
  down" (`:75-86`).
- `docs/guides/lint-ratchet.md:197-215` — the authoritative guide defines the
  two recovery paths: improvements update the baseline without
  `--allow-worse`, while intentional increases require `--allow-worse` plus a
  reason recorded in the committed debt log alongside the baseline.
- `docs/harness-tour.md:43-57` — the public tour advertises an explicitly
  accepted increase and a locked-in improvement, then names symmetry as the
  important property: both new debt and unrecorded cleanup fail until the
  committed baseline explains the change.
- `eslint-config/code-quality-configs.js:38` — the comment says the zone will
  be carried to `tools/lint-ratchet/**` "when the engine moves", although the
  move landed on 2026-07-18.
- `eslint-config/code-quality-configs.js:39` — the comment points to
  `docs/agent_notes/backlog/lint-arch-review-2026-07/05-engine-file-consolidation.md`,
  which does not exist. The exact command
  `git grep -n -F 'docs/agent_notes/backlog/lint-arch-review-2026-07/05-engine-file-consolidation.md' ebf096580b31f604861fadb3d4cbd4079da4f017 -- .`
  returns only this comment.
- `eslint-config/code-quality-configs.js:45-51` — the live glob list directly
  below the comment already includes `tools/lint-ratchet/**/*.ts` at line 50,
  contradicting the future-move framing.
- `docs/agent_notes/backlog/lint-arch-review-2026-07/00-index.md:34-46` — the
  retained "Landed record — 2026-07-18" section contains the leaf-05 zone-cap
  ruling that should replace the dead pointer.

## Proposed direction

Three independent parts share the public lint-ratchet accuracy theme; land them
as three separate commits, in any order.

**Part A — declare and preflight the flock prerequisite (S).**

1. Add a `flock` bullet to the demo README Requirements section
   (`examples/lint-ratchet-demo/README.md:30-34`): util-linux `flock`, present
   on stock Linux, absent on stock macOS (`brew install flock` or util-linux),
   needed only for the optional merge-driver step 4.
2. Add a preflight to the shared installer body
   `scripts/git/install-baseline-merge-driver.sh`, immediately before the
   exec/flock block at `:106-109`: a `command -v flock` guard that calls the
   existing `warn_and_exit` with a message naming `flock` and explaining how
   to install it on each platform. Preserve the file's advisory semantics:
   package `prepare` and hooks must never hard-fail.
3. Mirror the identical edit into
   `examples/lint-ratchet-demo/scripts/git/install-baseline-merge-driver.sh`;
   the two files are byte-identical today and must remain so.

Verify Part A with the demo smoke: from
`examples/lint-ratchet-demo/`, `bun run smoke` invokes the real
`bash smoke.sh` script (`examples/lint-ratchet-demo/package.json:15`), whose
lines `76-79` install the driver and assert that Git registered it. Linux CI
has `flock`, so that path should remain green. Extend the registered installer smoke `scripts/tests/test-lint-ratchet.sh` with
a missing-`flock` case that asserts the preflight names the prerequisite and
exits 0, then run it directly with `bash scripts/tests/test-lint-ratchet.sh`.
Its `# smoke-subjects:` header already names the shared installer and its
lint-ratchet shim, so run `bun run test:scripts:subjects` only if that header
changes; the regeneration script exists at `package.json:60`.

**Part B — rewrite the zone-cap comment in present tense (XS).**

Rewrite `eslint-config/code-quality-configs.js:29-44` to state the current
layout: the engine has lived in `tools/lint-ratchet`
(`@musi/lint-ratchet`) since the leaf-02 package seam landed on 2026-07-18,
while the Musi adapter remains under `scripts/lint-ratchet` and
`scripts/lib/baseline`, hence the three globs. Delete the future-tense
"Carried to `tools/lint-ratchet/**` when the engine moves" sentence and replace
the dead ruling pointer with
`docs/agent_notes/backlog/lint-arch-review-2026-07/00-index.md`, whose landed
leaf-05 entry retains the decision.

Keep the still-live ordering guidance intact: spread the zone configs after
`createRepoCodeQualityConfigs` and before `maxLinesExceptionConfigs`. Also keep
the `.ts`-glob-versus-JSON hazard note at `:40-44`; both passages document live
behavior rather than stale history.

**Part C — state the actual debt-change invariant (XS).**

Keep the accepted-increase and cleanup walkthrough at
`examples/lint-ratchet-demo/README.md:65-84` intact. Replace only the false
monotonic summary at `:85-86` with the actual symmetric governance invariant:
debt cannot change silently. An increase requires `--allow-worse` plus a
recorded reason and committed acceptance record; a decrease requires updating
and committing the tighter baseline.

Make this a separate commit from Parts A and B so review can verify that it
corrects the explanation without changing either supported workflow or
rewriting debt-governance policy. As the payoff is making the public demo
factually accurate, audit every factual claim in the full README rather than
checking only the edited sentence.

## Scope / caveats

- **Out of scope:** any broader documentation-coordinate sweep. The prior
  pack's CQ25-168 refusal constrains this targeted repair; do not revive the
  bulk bare-coordinate sweep it rejected. This leaf covers one broken ruling
  pointer, one missing prerequisite, and one contradictory invariant in the
  same public demo.
- The adoption recipe remains unchanged except for declaring the `flock`
  requirement and correcting the debt-change explanation at
  `README.md:65-86`. Preserve the explicitly supported accepted-increase
  workflow, its `--allow-worse` command and reason record, and the improvement
  update command. Do not redefine debt-governance policy.
- The standing
  [code-quality-2026-07-25/CONSTRAINTS.md](../code-quality-2026-07-25/CONSTRAINTS.md)
  ruling (CQ25-96) applies: because this is a "make the doc true" slice, verify
  every factual claim in the edited demo README, not only the claims cited by
  this leaf.
- **Risk (Part A):** a misplaced or hard-failing preflight in the shared
  installer would regress the deliberately advisory `prepare`/hook path or
  the demo smoke's isolation run. The guard must go through `warn_and_exit`
  (exit 0), never `exit 1`. Editing only one of the two byte-identical
  installer copies would introduce copy drift; edit both or neither.
- **Risk (Part B):** do not alter or drop the still-valid config-ordering
  guidance, the `scripts/*` globs, or the `.ts`-glob hazard note. Only the
  tense, the completed-move sentence, and the dead ruling pointer change.
- **Risk (Part C):** do not replace "debt can only trend down" with wording
  that implies increases are ungoverned. The replacement must name both rails:
  reasoned explicit acceptance for increases and a committed baseline update
  for decreases.
- The misleading existing lock-contention warning is superseded for a missing
  binary by the new preflight; leave that warning unchanged for genuine lock
  acquisition failures.
- Adjacent leaves touch the same demo and documentation surface for different
  reasons:
  [081-lint-ratchet-adoption-docs-mix-packaged.md](./081-lint-ratchet-adoption-docs-mix-packaged.md)
  owns adoption-guide architecture, while
  [112-public-lint-ratchet-demo-asks-adopters.md](./112-public-lint-ratchet-demo-asks-adopters.md)
  owns the operational rail the demo asks adopters to vendor. There is no hard
  ordering dependency, but avoid concurrent edits to
  `examples/lint-ratchet-demo/README.md`.
