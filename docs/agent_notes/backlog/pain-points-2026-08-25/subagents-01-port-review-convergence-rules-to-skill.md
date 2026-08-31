# Port Review-Convergence Working Rules Into the Agent-CLI Skill

Status: Implemented — all seven rules as drafted; section placed directly before `## Follow-ups` (the spec's two placement clauses conflict — the mission-file paragraph stays inside Prompting)
Date: 2026-08-25
Priority: P2
Size: M
Source:
`/home/node/persist/musi/pain_points/subagents-and-review-convergence.md` —
"Review loops need a scope checkpoint", "'Redundant coverage' deletions invert
on the next round", "The fail-open-completeness P1 treadmill", "A settled
disposition that asserts impossibility caps reviewer severity", and "A
P2-only merge gate still needs a decision, and the Opus budget shapes it"

## Problem

Five incidents in the source note each cost a repeat multi-round adversarial
review cycle because a working rule the orchestrator later derived was not
available going in:

- Two agent-cli repair branches ran five or six consecutive P0/P1-producing
  rounds before anyone asked whether the mechanism itself had outgrown its
  scope (2026-07-30 gate follow-up pack).
- A five-model panel deleted a test as "redundant coverage" by comparing it to
  other tests instead of to the leaf's acceptance clauses; the very next round
  had to restore it.
- Reviewing a gate-rewiring lane (unit 115), codex filed a new, individually
  true "a future edit could silently no-op this check" P1 in three consecutive
  rounds — an inexhaustible class on gate code — until a round-4 brief added an
  explicit three-part severity bar and a carried-forward settled-dispositions
  list.
- Unit 231 pinned an adapter to an external binary's grammar on a settled
  disposition that the grammar was "unobservable" because the binary was not
  installed; five versions of the crate sources and a cached debug build sat
  in `~/.cargo/registry/src` the whole time, and the wrong disposition capped
  a real P1 down to P2 for a full round.
- Unit 243's merge gate returned three P2s from a single reviewer seat while
  three other seats found nothing; the lead P2 was a genuine wrong-ownership
  claim that a single grep confirmed, and landing it would have
  institutionalized the exact defect class the unit existed to fix.

`.claude/skills/agent-cli/SKILL.md`'s "Prompting" section already carries this
shape of institutional lesson as short mission-clause bullets — for example
"One fix agent per review round, confirm-then-fix" (`SKILL.md:133`, sourced
from `docs/agent_notes/backlog/code-quality-2026-08-01/DRAIN.md` step 6) and
"Guard/hook code reviews need a threat model" (`SKILL.md:134`). Grepping the
live skill tree and `docs/ai-harness.md` for the specific rules this note
crystallized — scope checkpoint, acceptance-clause check before deleting
coverage, a fail-open severity bar for gate code, a settled-dispositions list,
"don't settle unanswerable without running the check", and "judge a P2 by what
it institutionalizes" — finds no match. None of the five incidents' lessons
are ported yet, so the next reviewer/orchestrator pair has to rediscover them
at the cost of another multi-round cycle.

## Scope

Add one new `## Review conduct` section to
`.claude/skills/agent-cli/SKILL.md`, placed after the existing `## Prompting`
section's "Concurrency: ..." paragraph and before `## Follow-ups`. Keep each
bullet to the working rule plus enough of the "why" to apply it without
re-reading the source note; do not inline the full case histories. Bullets:

- **Convergence checkpoint.** After three consecutive rounds where the same
  mechanism produces a new P0/P1, or immediately when a fix strategy conflicts
  with an explicit task constraint, stop dispatching and hand the decision
  (expand scope, change design, or defer) to the requester. "One more round"
  is not convergence evidence.
- **Coverage-deletion check.** When a review recommends deleting test coverage
  as redundant, verify the deletion against the task's written acceptance
  clauses, not only against what other tests cover — "covered elsewhere" is a
  behavior claim, acceptance clauses are a contract claim, and the two do not
  partition the same way. A cheap counterweight: give one panel seat an
  explicit "confirm the prior findings are genuinely fixed and introduced
  nothing new" brief on a fix round.
- **Fail-open severity bar (gate/check code).** The existing threat-model
  bullet above is necessary but not sufficient for code that itself gates or
  checks something, where "a future edit could remove this" is true of every
  check and the class is inexhaustible. To file a fail-open finding at
  P0/P1 on gate code, establish all three: the state is reachable by an
  ordinary good-faith edit; no other layer catches it — name the layers
  checked; and the consequence is a real gate hole, not a lost redundant
  diagnostic.
- **Settled-dispositions list.** Carry a running list of closed questions and
  the evidence that closed each one forward into every later round's brief, so
  no round re-litigates one. When a round's finding contradicts a disposition
  a prior round settled, the requester rules on the reversal — a fix agent
  handed only the current round's brief cannot see that it is being asked to
  undo the last round's mandatory fix.
- **Don't settle "unanswerable" without checking.** Before recording a
  disposition as unanswerable (e.g., "the tool isn't installed, so its output
  format can't be observed"), check cheaper alternatives first: vendored
  source, a cached build, the tool's own integration tests, upstream release
  notes. A disposition that forecloses a remedy also caps the severity of any
  finding that needs that remedy — when a reviewer's finding contradicts a
  disposition you authored, re-verify it yourself before trusting the label.
- **Blocked reviewer = static read.** A reviewer that reports its shell or
  tools were blocked is doing a static read no matter what its verdict says.
  Read that line before the verdict, and treat a clean call from a blocked
  seat as unconfirmed on anything empirical.
- **Judge a P2 by what it would institutionalize**, not by its label or seat
  count — a single seat can be right against several that found nothing. A
  leaf's own suggested phrasing is a draft, not a spec, when it conflicts with
  the leaf's own verification clause; the clause wins. A P2-only fix round does
  not require spending a second scarce reviewer seat (e.g., a per-unit Opus
  budget): fix with a cheaper seat pointed at the reviewer's answer file, add
  the fixed P2s to the settled-dispositions list, and re-confirm with the
  original panel's remaining (non-scarce) seat only.

Run `bun run harness:skills:refresh` afterward so the shared text projects
into `.codex/skills/agent-cli/SKILL.md` around its hand-authored Codex harness
block, matching the mechanism `pain-points-2026-07-29/15-*.md` documents.
`.codex/skills/agent-cli/agents/openai.yaml` and the reference files
(`references/*.md`) are out of scope — the new section belongs in the shared
prose, not a Codex-specific or edge-case file.

Out of scope: any wrapper, hook, or `TeammateIdle`/`SubagentStop` enforcement
of the convergence checkpoint or the settled-dispositions list. The prior
pack's disposition (`pain-points-2026-07-29/01-sources-and-verdicts.md`, row
"same — review loops") already ruled that stop-threshold enforcement and
review-dispatch authority are requester policy, not wrapper-inferable — this
leaf only documents the heuristic as skill guidance for whoever is driving the
rounds. Likewise out of scope: any change to `agent-run.sh`, `agent-wait.sh`,
`harness.controls.json`, or review-panel tooling/automation.

## Verification

- `bun run harness:skills:refresh` produces only the expected diff in
  `.claude/skills/agent-cli/SKILL.md` and `.codex/skills/agent-cli/SKILL.md`
  (new shared section projected verbatim around the existing Codex block); a
  second refresh is clean.
- `bun run harness:skills:check` passes.
- `bash scripts/tests/test-skill-dispatch-wrappers.sh` passes (unaffected by a
  prose-only addition, but confirms the generated skill-smoke subject list is
  unchanged).
- `bun run harness:check` passes.
- Manual read-through: the new section does not duplicate the existing
  "One fix agent per review round" / "Guard/hook code reviews need a threat
  model" bullets, and each new bullet traces to a specific incident in the
  source note.

## Evidence note

This is a documentation-only port of working rules the source note already
states in imperative form; there is no code change and no test to write
beyond the generated-artifact and smoke checks above. The bounded risk is
skill-doc bloat or duplication, which the manual read-through step checks for.
