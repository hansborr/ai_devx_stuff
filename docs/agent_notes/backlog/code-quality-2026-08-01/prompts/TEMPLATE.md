# Common lane preamble — Code Quality Audit 2026-08-01

Status: Dispatch material — not a schedulable note

<!-- Dispatch: concatenate this file + one lane-NN file + that lane's
     Phase-1 hotspot addendum, then fill the placeholders: {{LANE_ID}},
     {{AUDIT_TARGET_SHA}}, {{DEDUP_CORPUS_PATH}}. Lane 00 dispatches
     standalone — do NOT prepend this file to it. -->

You are lane `{{LANE_ID}}` of a multi-lane code-quality audit of the Musi
repo (`/workspace`, a 5E-compatible virtual tabletop; see `AGENTS.md`). Your
lane's scope and emphasis follow this preamble. Report only what your lane
owns (see Ownership below).

**Mission.** Find where this codebase falls short of being well-organized,
idiomatic, and friendly to a new contributor: maintainability and readability
problems, weird/unusual/hacky constructs, code smells, duplication, layering
violations, misleading names, dead weight, and DX friction. Ambitious, wide
refactor proposals are welcome. The codebase is entirely AI-generated and
some periods went off the rails — expect spaghetti, especially in harness
code.

**Explicitly out of scope:** bug hunting and security review (owned
elsewhere). If you trip over a suspected bug, record it in `bugsSideList`
(`title`, `paths`, `whySuspectedBug`, `suggestedOwner`:
`code-review|security-review`) and move on.

**Read-only.** Do not edit, commit, or switch branches.

**Fan out with internal subagents — mandatory.** Partition your scope into
an **explicit glob partition, one slice per subagent** (state the globs in
each brief; together they must cover your scope, with sampling rules named
where you sample). Do this within this single invocation — one dispatch that
parallelizes internally, never external re-dispatch. Each subagent brief
must include the dedup-corpus records relevant to its slice, and each shard
returns its own coverage record (readFully/sampled/skipped); fold the shard
records into your lane-level `coverage`.

**Dedup — read the corpus before reporting.** The prior-pack dedup corpus is
at `{{DEDUP_CORPUS_PATH}}`: one record per open leaf, plan slice,
CONSTRAINTS ruling, and do-not-reopen decision. Cite corpus record ids —
never bare leaf numbers — in `priorPackOverlap`. A finding that merely
restates live prior work: drop it yourself, but log every such drop in
`droppedAsPriorPackDuplicate` (title, corpus ref, one-line reason) so the
triage judge can audit over-dropping. Overlap with a novelty delta (new
paths/counts or a different direction) stays reportable with
`priorPackOverlap` filled. Do not re-propose a recorded refusal verbatim.

**Ownership.** The lane ownership matrix in
`docs/agent_notes/backlog/code-quality-2026-08-01/ORCHESTRATION.md` is the
authority. Precedence rules: test-shaped findings belong to lane 06
everywhere; docs-drift belongs to lane 07; cross-package patterns and **all**
`category: "feature"` findings belong to lane 08. If you notice something
outside your rows, add a one-liner to `coverage.pointers` — not a finding.
Non-08 lanes put feature ideas as one-liners in `featureIdeas`; lane 08
promotes or drops them.

**Evidence.** Every claim carries `path:line` at pin `{{AUDIT_TARGET_SHA}}`
or a measured count (say how it was measured). Any command you cite must
actually exist — verify against `package.json` scripts and `scripts/` before
citing it; fabricated commands are a known failure mode. Do not suppress a
finding because a MODULE.md/ADR/guide blesses the current shape — flag the
conflict instead; triage weighs which side moves.

**Severity and size are hints.** Fill `severityHint`/`sizeHint` to rank
within your lane; the Fable-family triage judge assigns the authoritative
values later. Do not inflate hints to get attention.

**Calibration.** For scope the prior audit never read (see your lane's Known
context), coming back empty-handed is suspect — say what you read and look
again with stricter eyes before accepting it. For recently-worked areas,
"clean, with evidence of what was read" is a valid result. There is no
quota; do not manufacture findings to fill one.

**Output.** Your **final response IS the deliverable** — write no files.
Respond with exactly one JSON object (no prose around it) matching the
finding contract (`contractVersion: 1`) in
`docs/agent_notes/backlog/code-quality-2026-08-01/ORCHESTRATION.md`:
lane id `{{LANE_ID}}`, `auditTargetSha: "{{AUDIT_TARGET_SHA}}"`, every key
present on every finding (`null` where not applicable), and a mandatory,
honest `coverage` record (skipped ≠ clean). Soft cap: ~20 findings, ranked
by value; name anything you cut in `coverage.cut` rather than silently
dropping it.
