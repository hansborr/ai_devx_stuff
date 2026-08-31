# Drain — dispatching this pack

Status: Reference — the execution contract for [00-index.md](./00-index.md).
Created: 2026-08-06 · Updated: 2026-08-29

Selection, gating, and the missions you send are computed by
[`drain.mjs`](./drain.mjs) from live state. This file is the loop around it —
the parts a tool cannot decide. Read it once; you should not need it again
per unit.

Everything is keyed by **unit**. A unit is a leaf (`154`), a plan slice
(`107-S0`, `109-S2`), or a whole-plan leaf (`108`). `drain.mjs` refuses the
wrong shape, so you do not have to remember which is which.

Rulings in [CONSTRAINTS.md](./CONSTRAINTS.md) stay in force, and a unit's own
`## Scope / caveats` outranks anything here — several leaves have an attractive
fix that is explicitly wrong.

## The tool

```bash
D=docs/agent_notes/backlog/code-quality-2026-08-01/drain.mjs

node $D status                  # lock, open lanes, what is free to take
node $D list --all --available  # browse past the current owner call
node $D plan 154 169            # gate a pick; prints the lane commands to run
node $D plan 154 169 --one-lane # gate the same pick as ONE batch lane
node $D brief 154               # the implementer mission
node $D brief 154 --with 169    # the batch-lane mission (reviewer: add --review)
node $D brief 154 --review --round 1
node $D brief 154 --conduct     # the conductor mission — delegate steps 3–8
node $D verify-closed 154       # prove a unit is fully closed (step 8's audit)
node $D record 169 --carrier 154 # batch passenger lands with the carrier branch
node $D lock acquire
```

`plan` is the gate. It reads the reviewed edge graph, live lane branches, and
merge commits on `main`, and prints which picks can be opened now, which must
wait, and why. It is mandatory before every lane because claims change the
answer.

Run the gating commands — `plan`, `status`, `list`, `brief` — from the
up-to-date main worktree: they read each leaf's `Status:` from the checkout
they run in, so a stale worktree gates against a stale world. `verify-closed`
is the one command that self-anchors to `main`.

## The loop

**0. Take the lock, once per session.** Run `node $D lock acquire`, then probe
with `node $D status`; hold the bare `mkdir` lock for the session. Never adopt a
held lock; its owner clears it. Finish or abandon any open claim before
selecting new work.

**1. Pick and gate.** Run `node $D plan <UNIT>...`, and read what it reports.

**2. Claim immediately**, with the command `plan` printed — before any deeper
reading. The gate answers against the claims that exist *now*, and nothing stops
another lane appearing in the window between gating and claiming, so the shorter
that window the better. The branch name is exactly `fix/cq-<UNIT>`, no slug: git
refuses a ref that already exists, which is what makes the claim atomic. If
creation fails because someone got there first, throw the gate result away and
start again at step 1 — it was computed against a world that no longer exists.

*Then*, with the claim held, **read both leaves of every incident edge in
full**. A blank relation cell is a minimum known constraint set, not proof of
independence, and it never waives a collision check against the separate
[2026-07-25 pack](../code-quality-2026-07-25/00-index.md), which is outside this
graph entirely. If that reading changes your mind, abandon the claim (step 8's
commands) — a released claim is cheap, a raced one is not.

**Leaf pins rot.** The pack was audited 2026-08-01 and the tree has moved under
it: every unit drained so far had stale line pins, and two had substantively
wrong claims (144 cited a precedent test that does not exist; 182 mislabeled
three of five keys). Re-verify every pin — file, line, symbol, cited test —
against the live tree before it is quoted into a brief, and put the
live-verified pins and any traps in the mission, so no downstream agent
inherits the audit's stale picture.

What `plan` decides for you, and what it does not: it refuses a unit whose
prerequisite has not landed, whose co-land partner is unresolved, whose outcome
decision is unrecorded, or whose plan slices are out of order. It also
enforces the standing rule itself: while any `fix/cq-*` claim exists it defers
everything, and it prints lane commands for at most **one** unit — several
takeable units are an ordering, not an invitation, and a second lane is never
the answer (batch instead). It does not know your units' **source file sets**
— inside a batch lane overlap is harmless (one agent, working sequentially),
and there is never a second lane to collide with.

**A `BLOCKED` unit that needs a decision is not a dead end.** Two kinds wait
on a judgement no tool can make, and both are cleared by a row in
[drain-queue.json](./drain-queue.json) under `ownerDecisions`. Do not wait for
the owner to author it: run a cross-model panel — parallel consults from at
least two off-family models, with Grok 4.6 judging the routes — and record its
verdict as the row. Only a call resting on a preference the owner alone holds
is deferred: leave that unit blocked and take other work. Worked examples live
in [DRAIN-NOTES.md](./DRAIN-NOTES.md).

- **Outcome** (`moots`, `moots-part`, `alt`) — one leaf may make all or part of
  another unnecessary. Put the pair and the leaf warrants to the panel; record
  the verdict under `ownerDecisions.outcomes` as which units
  `proceed` and which are `moot`. The gate clears a unit only by naming it in
  `proceed`, so a decision that drops one side keeps it blocked rather than
  freeing both, and an incomplete row unblocks nothing. On an `alt` edge
  exactly one side may proceed. **Landing the other leaf is not a decision** —
  it may be what tells the panel the answer, but the row is what records it.
- **Co-land** (`coland`) — the pair must land on one branch, and this tool
  provisions one lane per unit. Have the panel name a **carrier** unit under
  `ownerDecisions.colandCarriers`; that lane then implements every covered unit,
  its brief names them all, the decision maps every covered unit to the carrier,
  and step 8 closes them all together.

Do not work around either by opening the lane anyway. `node $D --check`
validates every decision row against the live graph, so a stale one fails loudly
instead of quietly unblocking work.

**3. Dispatch one implementer per lane.**

```bash
node $D brief <UNIT> > /tmp/cq-<UNIT>-implementer.prompt
```

Send it to one fresh-context agent; the transport (a subagent, or the
agent-cli skill) is yours to pick — the mission file is what this protocol
owes you. Dev work — implementer and fix agents — runs on **Opus 5**
(`claude-opus-5`), never Sonnet 5, which is a review seat only. To hand steps
3–8 off entirely instead of running them yourself, see “Conducting a unit”.

**4. Verify the lane yourself** when it reports: `git -C <lane> log --oneline
main..HEAD`, `git -C <lane> diff --stat main...HEAD`, and the gate output.
Self-reports are not evidence, and an implementer that goes quiet has often
already committed its work.

**5. Record batch membership before review.** Ordinary and declared co-land
units need no extra record: their branch merge and `ownerDecisions` entry supply
the landing facts. For an ad-hoc batch, run the exact `record` commands printed
in its brief and commit `drain-carriers.jsonl` with the lane.
`DRAIN-LEDGER.md`'s landing table is narrative history only; do not add
`_pending_` rows or merge-sha follow-ups.

- Flip each landed leaf's `Status:` to `Landed on fix/cq-<CARRIER>`, regenerate
  the catalogs, update the counts in `00-index.md` and `../README.md`, then run
  `bun run backlog:lint`. Every status flip moves the generated `../CATALOG.md`
  totals, so the lane regenerates it (`bun run docs:backlog-catalog`) and
  commits it: a stale page fails `bun run harness:check`, which `scripts/land.sh`
  runs before the full verify and CI runs on every push. The pre-commit
  stale-catalog warning is advisory while the lane iterates, but it must be
  cleared by the lane's last commit — it is not the integrator's job. Two lanes
  that both regenerate conflict on the totals; resolve by taking either side and
  re-running the generator.

**6. Review until a clean round.** Every round is the owner-fixed panel
(2026-08-23) — five seats run in parallel from a clean worktree on the same
review brief plus the angles file. Land only on a round with no P0/P1 from any
seat. Two rounds is normal; a third that produces only P2 style preferences
means land, not iterate. There is no separate merge gate: a fix goes back
through the whole panel on a fresh brief (next round number), and nothing
lands whose latest commits no reviewer has seen.

| Seat | Backend | Flags |
|---|---|---|
| Opus 5 | claude | `-m claude-opus-5 -e high` |
| Fable 5 | claude | `-m claude-fable-5 -e high` |
| Sonnet 5 | claude | `-m claude-sonnet-5 -e high` |
| Grok 4.6 | cursor | `-m cursor-grok-4.6-high` |
| GPT-5.6 | cursor | `-m gpt-5.6-sol-high` |

`-high`, never `-xhigh`. The cursor wrapper defaults to
`cursor-grok-4.6-xhigh`, so every cursor seat passes `-m` explicitly. Not on
the panel: codex (subscription lapsed 2026-08-23, until the owner renews),
copilot (policy-dead), GLM and Gemini (benched). Cursor is consult-only —
`work cursor` runs outside the repo's hook policy.

Write `/tmp/cq-angles.prompt` once per session, before the first round. It
tells each seat to fan out its own subagents across a few distinct review
angles, and that for the two mandatory ones below proposing removal is the
ask, not a redesign the brief forbids:

- **Simplicity** — flag code written for edge cases or threat models that do
  not matter here, and prefer deletion over hardening.
- **Useful test coverage** — the suite is already too slow to run and memory
  limits rule out more parallelism; flag tests whose runtime buys no real
  signal, not just coverage gaps.

```bash
WRAP="$(git rev-parse --show-toplevel)/scripts/agent-cli/agent-run.sh"
node $D brief <UNIT> --review --round 1 > /tmp/cq-<UNIT>-review-r1.prompt   # batch lanes: keep --with
for seat in "opus:claude:-m claude-opus-5 -e high" "fable:claude:-m claude-fable-5 -e high" \
            "sonnet:claude:-m claude-sonnet-5 -e high" "grok:cursor:-m cursor-grok-4.6-high" \
            "gpt:cursor:-m gpt-5.6-sol-high"; do
  IFS=: read -r name backend flags <<<"$seat"
  setsid nohup "$WRAP" consult "$backend" $flags -P /tmp/cq-<UNIT>-review-r1.prompt \
    -P /tmp/cq-angles.prompt -o /tmp/cq-<UNIT>-$name-r1.msg \
    > /tmp/cq-<UNIT>-$name-r1.log 2>&1 &
done
```

**Dispatch every consult detached** (`setsid nohup … &`), exactly as above:
when an agent dies the harness reaps its background children, and a
non-detached consult is SIGTERM'd mid-flight with the seat lost. Fresh `-o`
path per seat **per round** — a spent answer path cannot be reused. Then wait
in **one** long-lived sleep loop that polls for the answer files, not many
short calls: consults never wake the dispatcher, and every turn boundary is
another chance to lose the session to an API outage.

A seat that dies on credits or a 529 is a retry, not a lane failure. A seat
whose shell was blocked returns a **static read**; weigh it as one and say so
in the round — across this drain every P0/P1 came from a seat that ran the
code, and shell-blocked seats have declared branches landable minutes before
the gate found a P1 (see [DRAIN-NOTES.md](./DRAIN-NOTES.md), "Review cycle").

An agent-cli consult is deliberate — the skill's "spawn a subagent instead"
does not apply, because the fix dispatch needs a findings file on disk.
Dispatch fixes by pointing the fix agent at the reviewer answer files (paths in
the prompt, or `-f`) — do not restate findings, and do not re-verify them
against the code first. If a fix round changes what the unit delivered, update
step 5's bookkeeping and let the next round review that too. Accepted P2s and
open questions the round leaves behind go to the ledger's "Deferred for
owner" table (see standing rules), not into the report and not into the fix.

The rendered review mission already carries the independence clause (review
only from the repository and your own experiments; a shell-blocked seat says so
and marks its static claims) and the guard-code threat model (accidental drift
by a cooperative caller, not an adversary). Every **fix mission** you write by
hand carries these, each one learned from a round that would not converge:

- **Name the capability, not the spellings.** A fix prompt that lists the
  reviewer's repros produces a fix that recognizes those repros; the next round
  finds the fifth. Write "close the *capability* — any route to X, however the
  binding was obtained; the spellings above are symptoms", and quote the
  reviewer's own "this fixed the spelling rather than the capability" back at
  the fixer when a round reopens. When a guard loop still will not converge,
  measure what the code defends against *today* and surface delete-or-reduce
  as an option rather than hardening again.
- **Prose corrections are verified against the code AND the tests.** Before
  rewriting a sentence a reviewer called false, the fixer verifies the new
  sentence against the code path *and* greps for a landed test asserting the
  opposite. Each fix round otherwise inverts the same sentence into the
  opposite falsehood (three rounds on one sentence, 2026-07); the falsifying
  evidence was a test in the same package every time.
- **Backlog annotation is its own commit.** A "**FIXED <sha>**" note cannot
  ride in the fix commit — a commit cannot contain its own sha and amend is
  policy-blocked — so the mission says "fix commit first, then a separate
  `docs(<scope>): annotate finding #N fixed` commit" (commit-msg hook: subject
  ≥ 20 chars, body ≥ 40 chars). A delegate told to fold them together stalls
  asking for an amend.
- **Delegate-authored leaves get an existence check.** Every `scripts/...`
  path and `bun run <script>` a delegate writes into a leaf's Verify section is
  checked against the tree before the leaf is accepted; invented paths have
  reached `main` this way.
- **Never assert impossibility in a brief.** "X is unavailable" caps every
  seat's severity on anything that contradicts it. Check package caches,
  registry sources, and vendored copies — not just `command -v` — and word the
  premise as a question ("check whether …; say which branch you took"). The
  incident record is the pain-point topic
  `pain_points/subagents-and-review-convergence.md`, "A settled disposition
  that asserts impossibility caps reviewer severity".

**7. Land.** Standing merge-on-green covers this — do not stop to ask.

```bash
MAIN_WT="$(git worktree list | awk '/\[main\]/{print $1}')"   # empty => pick a clean worktree and `git switch main` in it first
bash scripts/land.sh --branch fix/cq-<UNIT>                     # run from $MAIN_WT; background it
```

Only `land.sh` verifies. It runs the full sequential `verify` first, which
outlives a foreground timeout, so background it and **read its exit line before
step 8** — advancing early deletes the branch it is still verifying.

| Exit | Token | `main` moved? | Do |
|---|---|---|---|
| 0 | `landed-verified` | yes | Go to step 8. |
| 1 | `not-landed` | no | Claim stays. Follow the printed recovery, then retry. |
| 2 | `verify-failed` | no | Claim stays. Fix the failure and re-run, up to four attempts; then park (see “Parking a lane”). |
| 3 | `merged-unverified` | **yes** | **Still landed.** Run the action it printed; once green, go to step 8. Never re-run `land.sh` after a 3. |

Any recovery or fix that adds commits to the branch — on any exit — re-enters
step 6 for a clean panel round before the next `land.sh` run.

The bare `git -C "$MAIN_WT" merge --no-ff fix/cq-<UNIT>` form runs no gate at
all and must name the branch — a bare `git merge --no-ff` merges the configured
upstream and commonly reports "Already up to date" while the lane stays
unmerged.

**8. Close the unit.** All three, or the claim outlives the work:

```bash
bun run worktree:drop <path> --remove          # RETAINS the branch by design
git -C "$MAIN_WT" branch -d fix/cq-<UNIT>      # must run from main
node $D verify-closed <UNIT>                   # the proof: landed, claim gone, worktree gone, status flipped
```

Leaving the branch alive makes the unit read as permanently in flight, and
`plan` will report a landed peer as an active conflict against every later lane.
On a co-land carrier lane, run `verify-closed` with every covered unit listed
alongside the carrier — the carrier's merge landed them all, and a covered
leaf left unflipped is exactly what it catches — just as the batch amendment
runs it on every member; the conductor mission already renders that list.
`verify-closed` checks the landing facts from live state; catalogs and counts
are step 5's hand-edited bookkeeping, which `bun run backlog:lint` checks but
never regenerates.

**9. Release the lock** when the session ends and no lane is open:
`node $D lock release`.

## Batch lanes

The per-unit fixed cost — a lane, a review cycle, a full sequential verify —
is what bounds a serial drain, so several small units may share one lane.
`plan <A> <B> <C> --one-lane` gates the set: every unit must be free right
now, a plain leaf unit (plans keep their own landing contracts), outside any
co-land pair, and pairwise clean — one blocking edge refuses the whole batch.
The first unit is the **carrier**. The tool prints the carrier's worktree
command, a claim-marker branch for every other unit (`git branch fix/cq-<U>
main` — no worktree, but the claim is visible to every session), and the
batched brief:

```bash
node $D plan 154 169 225 --one-lane
node $D brief 154 --with 169,225 > /tmp/cq-154-implementer.prompt
node $D brief 154 --with 169,225 --review --round 1 > /tmp/cq-154-review-r1.prompt
```

The loop is otherwise unchanged, with three amendments:

- **Step 2 applies per unit.** Read every member's leaf and incident edges
  before dispatching, and keep a batch to 3–5 small units (the gate refuses
  more than five): each reviewer reads one diff covering all of them, and a
  batch too wide to review honestly is worse than two lands.
- **Step 5 applies to batch passengers.** Run `node $D record <UNIT> --carrier
  <CARRIER>` once per passenger and commit the appended JSON lines before
  review. The carrier itself needs no record.
- **Step 8 deletes the marker branches with the carrier**
  (`git -C "$MAIN_WT" branch -d fix/cq-<U>` for each) and runs `verify-closed`
  on every member, not just the carrier — a surviving passenger marker is
  exactly what it catches. A surviving marker
  reads as a unit permanently in flight — and to the next session a marker is
  indistinguishable from an abandoned bare claim (`status` flags claims with
  no worktree), so find the carrier lane whose brief names a unit before
  treating its claim as orphaned.

## Conducting a unit

Steps 3–8 do not need the session that claimed the unit. On a long drain the
orchestrating context accumulates every leaf read, review round, and `land.sh`
vigil, and quality decays with it; delegating each unit to a fresh **conductor**
agent keeps the orchestrator a thin scheduler that stays small across many
units. This buys context, not throughput — the serial-only rule is unchanged.

```bash
node $D brief <UNIT> --conduct > /tmp/cq-<UNIT>-conductor.prompt   # batch lanes: keep --with
```

Dispatch it as one fresh-context agent with no model override, inheriting the
dispatcher's model — the mission is shepherding plus scaffolded judgement. The
conductor may therefore share a model with a panel seat; a seat's independence
rests on its fresh context and on the off-family seats beside it, not on a
model split. If a conductor dies mid-lane (API outages have killed six in a
row), resume it with `SendMessage` — its transcript survives — rather than
redispatching. The seam is fixed, and it is the same loop either way:

- **You keep steps 0–2**: the lock, `plan`, the claim, and decision panels for
  BLOCKED units. Gating and claiming stay in one session so the gate-to-claim
  window stays short. The conductor does step 2's post-claim deep read — pin
  re-verification included — and keeps the right to abandon.
- **The conductor owns steps 3–8**: implementer dispatch, lane verification,
  bookkeeping, review rounds, `land.sh`, close-out — and
  parking its own lane when that path fails, since it already owns `land.sh`'s
  failure exits. Its mission forbids it the lock, `plan`, other claims, and
  second lanes.
- **One conductor at a time.** A conductor is a lane plus full gates, so two
  conductors are the concurrent-gate mode the serial-only rule retired.
  Reviews *inside* the one conducted unit parallelize as always.
- **The main worktree is the conductor's while its lane is open.** The
  conductor works in the lane and in the main worktree (`land.sh`, step 8's
  `branch -d`); the dispatcher touches no file in the main worktree —
  including `drain-queue.json` — until the lane closes.
- **Audit state, not the report.** A conductor is done when
  `node $D verify-closed <UNIT>` passes — run it yourself before taking the
  next unit. An evidence-route close is audited exactly the same way: the
  lane lands its `Not needed` flip through `land.sh` like any other diff, so
  the merge exists and the flipped status is on `main` — "closed by evidence"
  still means the command passes.
  Only two reported stops change the audit, not the standard: for
  **abandoned**, check the claim branch and lane worktree are gone (the unit
  returns to the pool); for **parked**, check every member's branch left the
  `fix/cq-*` namespace and the queue exclusion covers them all (see “Parking
  a lane”). A conductor that goes quiet has often finished; check live state
  before nudging it.
- **A dead conductor's lane is yours.** If it stalls, dies, wedges — or stops
  and reports while the claim still stands, neither closed, parked, nor
  abandoned — the claim is your own again: read the lane state first, then
  finish, abandon, or park it. Never redispatch a second conductor on top of
  a lane you have not read.

## Standing rules

- **One lane at a time, always.** This drain is serial-only: two lanes
  running full gates at once have OOM'd this container, and every
  parallel-lane rule the protocol once carried existed to police a mode that
  is now off. To move more than one unit per land, share the lane (see
  “Batch lanes”) — never open a second one. Read-only consults are exempt:
  a round's reviewers and a decision panel run in parallel as one **flat**
  panel; it is lanes, full gates, and nested fan-outs (a consult that itself
  spawns a panel of consults) that stay serial.
- **`land.sh` is the only full gate.** Step 7 runs one full sequential
  `verify` per land, and nothing else in a lane ever runs one: implementers,
  fix agents, and conductors never run `bun run verify` or `land.sh` mid-lane.
  The commit gate and focused tests carry the lane, and a lane-side full verify
  only pays ~15 minutes for the answer step 7 produces again minutes later. A
  file or surface that is not yet a registered verify subject is flagged in the
  lane's report — the land-time run is what covers it.
- **Fresh sessions.** Prefer a fresh session (fresh context window) per
  dispatch. Resume (`-r`) only to recover a specific broken run, never as the
  default.
- **No progress reports.** Work silently: the owner hears nothing until the
  work is done, they ask, or the drain genuinely cannot continue. Interim
  status updates are noise. What the owner *does* need to hear eventually —
  accepted P2s, deferred cross-pack calls, open questions — goes in
  [DRAIN-LEDGER.md](./DRAIN-LEDGER.md)'s "Deferred for owner" table as it
  arises, one row per unit, so nothing accumulates in a session's memory.
- **Do not stop for input.** Keep going as long as possible without the owner.
  A judgement call goes to a cross-model panel with Grok 4.6 as judge, recorded
  as step 2's `ownerDecisions` row; a unit that truly needs the owner's own
  call is deferred — take the next free unit and keep moving.
- **Bug fixes are in scope at implementer judgement**, with a regression test
  and an explicit mention in the lane's report.
  [BUGS-HANDOFF.md](./BUGS-HANDOFF.md) is input to a separate `/code-review`,
  not to this queue.
- **Merge authorisation is standing** ([DRAIN-LEDGER.md](./DRAIN-LEDGER.md)
  records the grant). **Pushing and opening a PR are not covered** and stay the
  owner's call.
- **Numbering is stable.** 096 and 161 are deliberate holes: never recreate
  them, never renumber.
- **Queues run in file order, and when the last one drains, stop and ask the
  owner** for the next priority call. This pack does not infer one from
  severity, size, Area, or graph degree, and a queue that is merely *blocked*
  is not drained — take the next free unit the gate offers, in any queue, and
  come back to it.
- **A leaf whose premise no longer holds is not an owner question.** If the
  audited finding is already fixed, or mooted by something that landed since,
  the unit closes by the **evidence route** — a normal close whose diff is
  bookkeeping-only. On the lane branch, set the leaf's `Status:` to
  `Not needed — <the evidence>`, do step 5's bookkeeping, and record the
  close in [DRAIN-LEDGER.md](./DRAIN-LEDGER.md), all committed like any
  other unit work; the row's `Merge` cell stays empty — the landing sha does
  not exist yet, and the ledger takes no backfills — and the concurring
  panel round is step 6's ordinary review of that lane diff, so
  reviewers see the flip and the ledger row.
  Then run `land.sh` (step 7) and close per step 8
  exactly as for a code close — the lane merged, so the safe `branch -d`
  releases the claim, and the landing merge is what carries the flip to
  `main`, where `verify-closed` reads the status.
  After the flip, check for hard dependents: a `requires` edge naming this
  leaf as prerequisite may or may not clear on its own — landing the lane
  clears it for a plain or whole-plan leaf, while a sliced leaf's dependent
  stays blocked because only the claimed slice enters the landed set — and
  either way the leaf's work never happened, so settle each dependent
  deliberately with a queue exclusion or an edge removal, as when parking,
  before it runs against a missing prerequisite. Not a licence to
  drop work that is merely hard, and never for a `moots`/`alt` pair — that
  stays an outcome call for step 2's panel.

## Parking a lane

A lane that cannot be released — abandoned with commits on it, or four failed
`land.sh` verifies — **must not stay in the `fix/cq-*` namespace while you
wait for the owner**: while any claim exists `plan` defers every other unit,
so one wedged lane stops the whole drain. Parking is for work that cannot
proceed but remains valid; a unit whose audited premise no longer holds is the
evidence route's case (standing rules), and that reason is never itself
grounds to park — the lane lands its bookkeeping diff like any other. An
evidence lane that *cannot land* (four failed verifies, a wedged claim)
follows the same failure path as any lane, this section included. Do not
delete anything; rename the branch out of the namespace:

```bash
bun run worktree:drop <path> --remove
git -C "$MAIN_WT" branch -m fix/cq-<UNIT> parked/cq-<UNIT>
```

Parking disposes of **every member of the lane**, not just the carrier: delete
each batch passenger's marker branch (`git -C "$MAIN_WT" branch -d fix/cq-<U>`
— its work rides the parked carrier branch), so no member is left in
`fix/cq-*`, and no member — carrier, batch passenger, or co-land covered unit
— is left schedulable but permanently blocked on its excluded carrier.

Then move every member from its wave into that queue's `exclusions` in
[drain-queue.json](./drain-queue.json) — otherwise the next session re-picks one
and wedges the same way — and run `node $D --check`; if it now reports a queued
dependent whose prerequisite is no longer queued, exclude that dependent too.
Append a row to [DRAIN-LEDGER.md](./DRAIN-LEDGER.md) — every member, the
branch, what was attempted, the exact failure — and **continue with the next
unit**. The owner disposes of `parked/*` branches; no later lane may build on
one.

## When something goes wrong

[DRAIN-NOTES.md](./DRAIN-NOTES.md) holds the failure modes and the reasoning
behind the shape of this protocol: lane provisioning hazards, why concurrent
full gates fail on timing, and how the queue was derived.
Read it when a step misbehaves, not before you dispatch.
