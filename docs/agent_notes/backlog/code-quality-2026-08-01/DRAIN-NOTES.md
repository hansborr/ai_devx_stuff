# Drain notes — failure modes and why the protocol is shaped this way

Status: Reference — the appendix to [DRAIN.md](./DRAIN.md).
Created: 2026-08-06 · Updated: 2026-08-08

Nothing here is needed to dispatch a unit. Read it when a step misbehaves, when
you are about to simplify part of the protocol, or when you are porting this
shape to another pack. Every item is something that actually went wrong.

## Lane hazards

- **`worktree:new` can fail for reasons unrelated to the leaf.** Its
  `worktree:init` step fingerprints the seed import closure; when that closure is
  mid-repair on the base branch, init exits non-zero and leaves the git worktree
  in place. A docs-only or harness-only lane that never touches the database can
  proceed in that worktree as-is; a lane that needs dev/test DBs cannot, and must
  wait for the base to be repaired rather than working around the guard. The
  instance that blocked this protocol's own lane was repaired by
  `fix/seed-import-closure-copy-set`, landed 2026-08-08; it is recorded because
  it recurs whenever that closure is mid-repair, not because it is open now.
- **Commits are serialized repo-wide.** `git-commit-quiet.sh` holds one queue
  lock across every worktree, and a parked lane prints a heartbeat naming the
  holder every ~60s. A waiting lane is waiting, not stuck.
- **Concurrent full gates produce timing-shaped failures.** Before blaming a
  branch for one, check the host for other running gates and for orphan load
  (`ps --sort=-pcpu`). The 2026-07-25 pack converged on serial lanes for exactly
  this reason.
- **Fast-commit mode** (`touch "$(git rev-parse --git-common-dir)/musi-fast-commit"`)
  skips only the slow test/scripts slots per commit and suits a multi-commit
  lane; such a lane must land through `bash scripts/land.sh`, which runs the full
  sequential verify. The marker lives in the shared git dir, so it affects every
  worktree of the repo.
- **Commit from inside the lane.** When driving a lane from another checkout,
  use a literal `git -C <path>` (not a shell variable) so the protected-branch
  guard resolves, and `git add` then `git commit` without a pathspec so changed
  verification does not abort on apparently unstaged work.
- **Never let a path variable reach `git -C` or `cd` unchecked.** An unresolved
  lookup expands to the empty string, and `git -C ""` silently operates on the
  *current* repository while `cd ""` stays put. A round-6 reviewer of this
  protocol ran `git -C "" branch -d` with an empty `<main-worktree>` and deleted
  the local `main` ref; it was restored from `origin/main`. Use `"${VAR:?msg}"`
  so an empty value fails loudly.
- **`branch -d` must run from `main`.** With no upstream configured — which is
  what `worktree:new -b` leaves you — `git branch -d` asks whether the branch is
  merged into the *caller's* `HEAD`. Run it from an older orchestrator checkout
  and it refuses a branch that is perfectly well merged into `main`, so the claim
  silently survives.
- **`land.sh` must run from the worktree holding `main`.** Run it from the lane
  while `main` is checked out in a sibling worktree and it aborts before the
  verify, printing the exact `cd <main-worktree> && bash scripts/land.sh
  --branch <name>` to use instead. Plain `git merge` has no such protection: run
  the direct form in a worktree parked on another feature branch and the lane
  merges into *that* branch.

## Why lanes branch from `main`

`scripts/land.sh` hard-codes the protected branch as `main`
(`scripts/land.sh:238,258,264,391`), so it cannot integrate anywhere else. And
the lane's own tree has to contain the pack when it records covered-unit carrier
membership before review. If a future pack repeats this shape, land the protocol
with the evidence, not after it.

## The lock

The shared-git-dir lock is one atomic `mkdir`, and `status` probes that directory
alongside exact-width `fix/cq-<UNIT>` claims. Never adopt a held lock; its owner
clears it. Claims, not the lock, record in-flight work.

## Review cycle

**Independence has to be in the mission, not just the filesystem.** Separate
scratch directories are organisation, not isolation: both reviewers run as the
same user with unrestricted reads, and the paths are predictable. On this
protocol's own round 11 one reviewer's shell was blocked, it read the other's log
from a shared scratchpad, and its "ready to execute" rested on experiments it had
not run. Two verdicts built from one investigation are one verdict. The
no-peeking paragraph is therefore part of the rendered mission
(`drain.mjs brief --review`), and each reviewer should still get its own
directory as a second line of defence.

**Weight a blocked reviewer's verdict as a static read.** Across twelve rounds on
this protocol, the executing reviewer found a real defect the static one could
not have reached in four consecutive rounds.

**Calibrate defensive-code rounds.** When a round's findings are about guard
code, state in the mission whether the threat model is accidental misuse or an
adversarial caller. Without that, review loops on guard code produce P1 evasion
findings indefinitely and never converge.

**A flat panel is safe to run in parallel.** Two to five reviewers, each a
single consult, have run concurrently throughout this drain without trouble.
Do not widen it into a nested fan-out where each seat spawns its own panel.
The 2026-08-23 container OOM during unit 119 was blamed on parallel consults
at the time; a 2026-08-24 forensic pass over the transcripts, wrapper logs,
and cgroup counters does not support that. The three-seat round-1 panel
(grok/gpt/fable) finished cleanly at 19:16 local, two hours before the
21:20 restart. The only delegate alive at the crash was a single `work`-mode
Opus 5 fix agent that went silent at 19:41 while running a parity harness
spawning old-vs-new subprocesses over dozens of fixture cases, on top of the
always-on dev server, `tsc --watch`, and the conductor. No `bun run verify`,
full eslint, stryker, or unfiltered vitest ran. The cgroup has no limit and
its counters were recreated at the restart, so the kill was host-level and
the exact trigger is unrecoverable. Lesson: a heavy loop *inside one
delegate* is the risk to police, not the panel width — and the 2026-08-02
"9 parallel codex lanes" OOM was a retracted misattribution of the same
shape.

**Consults die with their dispatcher unless detached.** The harness reaps an
agent's background children when the agent exits, so a consult started as a
plain `&` job is SIGTERM'd mid-flight when its conductor dies; `setsid nohup`
is what keeps the seat alive. Related: a detached consult or a backgrounded
`land.sh` never wakes the dispatcher, so a conductor that fires them and ends
its turn stalls — poll in one long-lived sleep loop within the same turn. The
2026-08-23/24 API 529 storm killed six conductors in a row this way, each at a
turn boundary; their transcripts survived and `SendMessage` resumed them.

## The queue

[drain-queue.json](./drain-queue.json) contains only fields the tool enforces:
decision dispositions, plan landing constraints, wave membership/order, and
excluded unit ids. This section owns their rationale and worked examples.

The owner call from 2026-08-06 is: harness leaves first; within harness,
lint-related leaves first. A leaf belongs to `lint-cluster` when its subject is
the lint stack's behavior, policy, or contract; test-suite structure is the
Tests area's work even when it edits lint paths. In `lint-cluster`'s exclusion
list, 114 and 163 are false-positive text matches; 152, 267, 094, and 128
belong to other subject areas. `drain.mjs` enforces declared graph edges
independently of this scheduling list.

The owner call from 2026-08-14 adds the `gate-cost` queue after `lint-cluster`
drains: leaves whose payoff is a cheaper land cycle for every later lane, since
each land pays the full sequential verify. G0 unparks the test units the
2026-08-06 call had set aside on subject-area grounds (067, 068, 069, 072, 073,
075 — slow serialized acceptance runs, wall-clock-sleep flake, and fixture
noise in suites the gate runs every time); G1 adds the verify-infrastructure
leaves 245, 117, and 141. The 2026-08-01 edge graph has no high-degree hub
leaf, so this call optimizes drain operating cost rather than unblocking
order. Queue order within the file is the priority order; wave order within a
queue remains a scheduling proposal, not a gate.

The owner call from 2026-08-14 adds five more queues, in file order after
`gate-cost`, so an unattended drain has roughly three weeks of runway rather
than two days. Between them they cover **every remaining harness leaf** plus the
three non-harness prerequisites those leaves need, which is the whole of the
2026-08-06 call's Area; the queues are the graph's own clusters, not a fresh
priority judgement:

- `controls-manifest` — the `harness.controls.json` / generated-surface cluster
  (127, 114, 116, 125, 126, then 110, 115), plus the cheap standalone config
  leaves (108, 136, 128, 267). It precedes `ai-hook-policy` because `107-S0`
  adds a manifest facet and carries `serial` edges to 114, 116, 125, and 126;
  110 is `serial` with 116 and 125. 127 leads on `pref-before:114` (`d-114-01`).
- `ai-hook-policy` — 107's five slices. The `plans` contract already forces
  their order, so the wave is one entry.
- `policy-extraction` — 152 first as the hub (`collides:131`, `serial:159`,
  `rebase:220`), then 109's slices, then the drift/analyzer, triage/sensor, and
  code-intel families. 109 precedes P2 deliberately: it is `serial` with 132 and
  134 and 147 `rebase`s on it, so the reverse order makes every P2 lane
  reconcile work 109 was going to redo.
- `verify-engine` — 204, 253, 206, 271. Same payoff argument as `gate-cost`,
  but placed after 107, which rewrites hook-side shell.
- `diagnostics-chain` — 182 (its co-land decision carries 171, which is why 171
  is excluded rather than queued), then 144 on `pref-before` (`d-144-01`), then
  181, which is `serial` with 067/068 and 152 and must precede 119
  (`S3-contradicts`) and 080 (`S3-collides`). 181 and 182 are the only
  cross-cutting leaves here, and 080 the only docs leaf; each is queued because
  a harness leaf is stuck behind it, not on its own merits.

`queueOrderProblems` (in `drain.mjs`, run by `--check`) pins the part of that
reasoning a later edit could silently break: a queued unit whose hard
prerequisite is neither queued nor landed, or is queued after it, is a defect
rather than a proposal — the drain reaches it, finds it blocked, and has nothing
to fall back on. Recorded preferences are checked only when the queue schedules
both sides and neither has landed, since a preference between a queued and an
unqueued leaf constrains nothing and a landed side settles it.

**The membership rule is hand-derived, and there is no grep that reproduces
it.** Verify that before trusting one:

```bash
cd docs/agent_notes/backlog/code-quality-2026-08-01
grep -hiE '^\|[0-9]+\|' LEAVES-HARNESS-*.md LEAVES-CROSS-CUTTING.md \
  | grep -iE 'lint|ratchet|eslint|semgrep|suppress'
```

That returns 17 rows: 15 of the 31 members, plus 114 and 163, which are not lint
leaves. It misses more than half the cluster —

```
081 090 102 113 123 129 148 153 154 156 158 160 175 197 225 251
```

— because their lint relevance lives in the leaf body rather than the catalog
subject, and because it searches only two of the twelve catalogs (so 081, 090,
102, and 251 are invisible to it regardless of pattern). Use it as a staleness
alarm — a new hit is worth investigating — never as the membership rule. To
rebuild membership properly, read each candidate's `## Problem` and apply the
rule above.

**A wave is a scheduling proposal, not a gate.** `drain.mjs plan` gates every
pick against the reviewed edge graph regardless of what the queue file says, so a
stale wave costs ordering advice, never safety.

The scheduling judgment is to clear the independent small clusters before the
ratchet-CLI hub, then run the hub's serial peers one at a time. Unit 124 is the
hub and cannot overlap any L3 unit, but taking it first is only a preference: if
124 stalls, L3 is not blocked and its leaves may run solo before 124. The final
wave is the dense shared-policy/coverage-map cluster and also runs one at a time.

Worked decision shapes (examples only; never copy them into live JSON as
`*Example` sibling keys):

```json
{"edge":"d-047-01","date":"2026-08-09","proceed":["047","105"],"moot":[]}
{"edge":"d-182-01","carrier":"182","covers":["171","182"],"date":"2026-08-09"}
```

For an outcome, `proceed` and `moot` together name every endpoint; only
`proceed` becomes dispatchable, and an `alternativeTo` decision permits exactly
one side. For co-land, `covers` names both endpoints and includes `carrier`.

### Live decisions

- `d-047-01`: both 047 and 105 proceed; take 105 first per the edge warrant, or
  105's lane skips the 047 comment.
- `d-097-01`: 097 proceeds and 203 is moot because the two write-immediately
  backfill commands are removed; nothing remains for 203 to guard.
- `d-203-01`: the same disposition as `d-097-01` — removal over safety rail.

## The three plan units are not interchangeable

The plan files own their contracts and per-slice verification. The queue keeps
only the fields the gate must enforce: 107 lands sequentially per slice, 108
lands as one whole-plan unit, and 109's slices are independent except S2/S3.
The graph cannot encode same-leaf slice order, so these few fields are necessary
machine data rather than copied plan prose.

## The gate, and why it distinguishes four remedies

A cross-model review of the first version found `drain.mjs` treating every
binding edge as plain serialization. It printed lane commands for a unit whose
prerequisite had not landed, split a co-land pair into two lanes, and let
argument order decide which side of a hard edge got the lane. The remedies are
not interchangeable, so the tool now separates two questions:

- **May this unit be opened at all?** Answered from git-derived landed state. An
  unlanded `requires` prerequisite, an unresolved `coland` partner, an undecided
  `moots`/`alt` outcome, or an out-of-order plan slice each stop the lane
  outright, whatever else is in the pick.
- **May these two run side by side?** The concurrency question. `serial` and the
  above forbid it; `rebase` and the preference tokens permit it, with the later
  lane reconciling.

**Every block has to be resolvable.** A second review round found the first
attempt deadlocking: outcome and co-land edges blocked *both* endpoints, and the
only clearing condition was the peer landing — which the same edge prevented. A
block whose exit is unreachable is not safety, it is a stall. So:

- A `requires` block clears when the prerequisite lands. Only the dependent side
  (`after:`) is blocked; the prerequisite is free.
- An outcome block clears when a decision row is recorded under
  `ownerDecisions.outcomes` in [drain-queue.json](./drain-queue.json), and by
  **nothing else**. The row names which endpoints `proceed` and which are
  `moot`; a unit is freed by being named in `proceed`, so "097 wins, drop 203"
  leaves 203 blocked rather than freeing both, and a row missing either field
  frees nothing. For `moots`/`moots-slice` only the side that may be mooted is
  blocked, since landing the *mooting* side is how the outcome gets decided;
  `alternativeTo` blocks both, being a genuine either/or, and its row must have
  exactly one side proceeding — both-proceed is the outcome that edge exists to
  prevent, and is refused. Both-proceed *is* accepted on a `moots` edge: the
  claim there is that one leaf **may** make the other unnecessary, and the
  decision may find that it did not.

  **A landed peer is not a disposition.** An earlier version cleared the block
  once the other side landed — a leftover from before decision rows existed,
  when it was the only exit. Landing 047 may be exactly what settles
  whether 105 is still needed, but it does not record the answer, and 105 may be
  wholly moot. The gate now waits for the row.

  The same rule runs at both points it is needed. Validating decision rows only
  in `--check` put the check at the wrong place in the loop: `--check` runs at
  bookkeeping time, `plan` runs before it, and `plan` is what opens work. One
  `outcomeRowFault` predicate now backs both, so a row cannot be rejected by the
  validator and honoured by the gate.
- A co-land block clears when a carrier unit is named under
  `ownerDecisions.colandCarriers`. One lane, named for the carrier, implements
  every covered unit; that endpoint-exact decision is also the carrier-membership
  record, so declared co-land pairs need no `drain-carriers.jsonl` row.

**The exemption is scoped to the edge, never to the pair.** One reviewed edge
can carry several remedies, and when an adjudicator put a `rebase` on the same
edge as a mooting one, that permitting remedy is the way through — `s3-003-097`
is both `rebaseOn: 003 → 097` and `moots-slice: 097 → 003`, so the pair proceeds
and reconciles, in both eligibility and concurrency. But two leaves can carry
several *separate* declared edges: 097 and 203 have four, including a `rebaseOn`
beside a `moots` and an `alternativeTo`. A rebase edge resolves nothing about
the mooting edge next to it. Widening the exemption to the pair silently freed
the pack's only `alternativeTo` cluster — caught in review, pinned by tests.

`drain.test.mjs` pins both questions — including outcome direction, the
permitting-remedy exemption, both resolution paths, and that a co-land or
outcome pair never ends up with both sides blocked and no exit — plus git merge
and carrier derivation and flag handling, against stub landed state, lane lists,
and decision sets:

```bash
node --test docs/agent_notes/backlog/code-quality-2026-08-01/drain.test.mjs
```

The registered shell smoke runs this suite and `drain.mjs --check`.

**Landed-ness comes from git.** An exact first-parent merge subject for
`fix/cq-<UNIT>` on `main` lands that unit. A declared co-land passenger inherits
the carrier from `ownerDecisions.colandCarriers`; an ad-hoc batch passenger
names its carrier once in `drain-carriers.jsonl`. The Markdown ledger is never
read.

## Serial-only, and batch lanes

**Why the drain runs one lane at a time.** Concurrent lanes have OOM'd this
container — two full gates at once is the recorded failure (2026-08-01), and
timing-sensitive suites also flake under a co-tenant gate. The owner made
serial-only the standing rule on 2026-08-09. The `serialize` and `collides`
edges in the graph are dormant under it, not deleted: they still gate what may
share a batch lane, and they would matter again the day the policy changed.

**The rule is enforced, not advisory** (a round-4 review found the first
version stated it in prose while `plan` still printed a worktree command per
takeable unit — the tool's own recipe was the misuse path). `plan` now defers
every pick while any `fix/cq-*` claim exists, related or not, and prints lane
commands for at most one unit; the extra takeable units are named as "land
this first, or --one-lane". The graph half of `dispatchable` is unchanged —
"may these two ever be open together" still feeds the batch gate.

**Why batches exist.** With one lane at a time, wall-clock is (lands) ×
(review rounds + full sequential verify); the per-unit fixed cost, not gating,
bounds the drain. A batch amortizes that cost over 3–5 small units (the gate
refuses more than five — each reviewer must read one diff). The design
generalizes the co-land carrier: one branch carries several units, the brief
names them all, and each passenger gets one carrier record.

**Why the batch gate does not relax `serialize`.** One agent in one worktree
works sequentially, which arguably satisfies what a `serialize` edge protects
against — but loosening a reviewed gate is a separate decision from adding a
lane shape, so v1 refuses any blocking pair inside a batch. Revisit only with
a review round on that specific question.

**Why covered units get claim-marker branches.** The branch is the only
in-flight signal that crosses sessions. A batch that claimed only the
carrier's branch would leave its other units reading as free to the next
`status`, and a crashed session would leave no trace that they were taken.
`git branch fix/cq-<U> main` is atomic exactly like the carrier claim, and
step 8 deletes the markers with the carrier. One hazard is deliberate: a
marker is observationally identical to an abandoned bare claim — no worktree,
no commits beyond `main` — so `status` labels claims with no worktree at the
conventional lane path, and the close-out rule is "find the carrier lane whose
brief names this unit" before "treat it as orphaned". Deleting a live batch's
markers would re-free units whose work is still in flight.

## What the tooling deliberately does not decide

- **Source file-set overlap.** The edge graph is a minimum known constraint set.
  A blank relation cell is not proof of independence, and two units with no edge
  can still share a file — 154 and 155 both live in `eslint-rules/`.
- **Collisions with the separate [2026-07-25 pack](../code-quality-2026-07-25/00-index.md).**
  Its open plan slices are outside this graph entirely.
- **Priority.** The owner calls it. Severity, size, Area, and graph degree
  describe findings; they do not establish a queue.
- **Whether an audited claim still holds.** Line anchors are pinned to the audit
  and may have rotted. An implementer that finds the claim itself no longer holds
  stops and reports; it does not implement around it. Reporting releases the
  unit — either as `Status: Not needed` with the evidence and a concurring
  review round, or as a park (both in [DRAIN.md](./DRAIN.md)) — and the drain
  moves to the next unit. It is not a reason to hold the lock idle.

### Why the unattended amendments exist

The 2026-08-14 owner call is for a long absence, so the three protocol
amendments that came with the new queues all answer the same question: *what
does this drain do at a point where it used to wait for an answer?*

- **Parking, and why the rename matters.** The old rule sent an unreleasable
  lane to the owner and stopped there. That is affordable when the owner is
  reachable and ruinous otherwise: claims are detected by globbing
  `fix/cq-[0-9][0-9][0-9]`, and while any claim exists `plan` defers every
  other unit, so one wedged lane freezes the entire queue rather than one unit
  of it. `git branch -D` is denied to agents and deleting the commits would be
  the wrong remedy regardless, so the release is a rename out of the namespace —
  the commits survive for the owner, and the gate stops counting a claim.
  Excluding the unit afterwards is what stops the *next* session from re-taking
  it and wedging identically; `--check` then cascades the exclusion to anything
  that required it.
- **Four `land.sh` attempts, not two.** Exit 2 is a verify failure, and this
  gate's failures are not all deterministic — the full-suite heap and timing
  flakes recorded under “Lane hazards” cost retries that are genuinely worth
  spending. Parking a lane costs the owner a review; four attempts is cheaper
  than one wrong park.
- **`Not needed` as an implementer disposition.** Landings moot later leaves,
  and the queues now run far enough ahead that this will happen. Making it an
  owner question would stall the drain on exactly the leaves its own progress
  made obsolete. It is deliberately fenced: evidence in the leaf, a concurring
  review round, a ledger row — and it never covers a `moots`/`alt` pair, which is
  an outcome call the gate still refuses to clear without a decision row.

### Known over-blocking: cross-leaf edges apply to every slice

A plan's slices inherit *all* of their leaf's cross-leaf edges, because the edge
graph records edges between leaves and has no slice-level resolution. The plans
are more specific than that: only 109-S1 touches the surface 132 restructures,
and only 107-S0 edits the manifest behind 107's four serialization edges. So an
open 132 lane blocks 109-S4 today, and an open 114 lane blocks 107-S4, when
neither pair actually collides.

This is left as-is deliberately. The error is in the safe direction — it delays
work rather than running colliding lanes together — and the fix would mean a
hand-maintained table mapping each slice to the subset of its leaf's edges that
binds it. That table is a fourth place the same facts live, kept in sync by
hand, in a pack whose repeated failure has been documentation drifting from
behaviour. Narrower scheduling is not worth a new drift surface; an orchestrator
that hits this can read the two plans and take the call itself.
