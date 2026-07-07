# 21. Per-agent skill caveats — mirror redesign (owner reopened 2026-07-07)

Status:
- Spike: DONE 2026-07-07 — mechanism selected (inline per-agent sections,
  see spike results).
- Waiter helper + shared-doc updates: SHIPPED ahead of the migration (see
  "Already shipped" below — do not re-implement).
- Mirror-restructure migration: Implemented 2026-07-07 — SKILL.md is now a
  structural mirror (shared core identical across trees, one marked
  harness-specific block per tree); CLAUDE.md's skill-scoped lore moved into the
  `.claude` tree's block, codex polling/lock/session lore into the `.codex`
  tree's block; the byte-identical SKILL.md mirror test is replaced by the
  structural assertion (references stay byte-identical).

Size: M · Depends on: after 13 (single-lane; touches the mirror-invariant
tests in `test-skill-dispatch-wrappers.sh`); before 20 (the docs audit builds
on the new structure)
Source: owner ruling 2026-07-07, superseding part of the 2026-07-04 mirror
decision

## What is reopened, and what is not

- **Stands:** the wrapper lives only under `.claude/skills/agent-cli/`, with
  the `.codex` tree pointing at the `.claude/...` path. Single-sourced by
  design; not reopened.
- **Reopened (owner, 2026-07-07):** the byte-identical SKILL.md/references
  mirror. Field use showed byte-identical is actually the wrong invariant:
  each harness has caveats the other should not carry.

## Problem

Claude-specific dispatch caveats currently live in `CLAUDE.md` (the
"agent-cli inside Workflow scripts" section), which every Claude session
loads whether or not it uses the skill — a permanent context tax for
skill-scoped lore. Codex-specific caveats have nowhere to live at all: there
is no `CODEX.md` equivalent trick, so they either pollute the shared SKILL.md
(where Claude also reads them) or go undocumented.

## Spike results (2026-07-07) — mechanism selected

Tested empirically per harness by planting a sentinel file
(`references/spike-probe.md`) plus a bare `@references/spike-probe.md` line
under the `# agent CLI dispatch` heading in each tree's SKILL.md, then
inspecting an actual loaded-skill context:

- **Claude Code:** the Skill tool injects the SKILL.md body verbatim; the
  `@` line arrived as literal inert text and the sentinel content did not
  appear. `@`-inlining is a CLAUDE.md/memory-file feature, not a skill-loader
  feature.
- **Codex (0.142.5):** activating `$agent-cli` likewise injects the SKILL.md
  body verbatim into the conversation. A consult asked to introspect its own
  context before any tool use quoted the literal `@references/spike-probe.md`
  line as the first line under the heading and reported the body was
  "provided inline in the user message", not tool-read. No expansion either.

Option (a) — `@`-references — is dead on both harnesses. **Owner ruling
(2026-07-07): write the harness-specific sections directly into each tree's
SKILL.md.** The shared core stays common prose; each tree carries one
inline section only its own harness ever loads, and that section is the only
permitted divergence between the trees. Options (b) (pointer-file read) and
(c) (generated variants) are rejected as needless indirection/machinery for
a one-section divergence.

## Codex-specific caveat — the motivating gap (owner, 2026-07-07)

**Codex cannot idle-wait on a dispatched run**: it gets no background
completion notification, so it must hold the session by polling until exit.
The full caveat — verified poll caps, empty-`write_stdin` discipline,
"long runs are expected; never narrate unchanged polls" — has already
landed in the shared SKILL.md as the "Codex polling pattern" section (see
"Already shipped" below). That landed, reviewed text is the source of
truth; the migration *moves* it into the `.codex` tree's harness-specific
section — do not re-author it from an older draft.

## Already shipped ahead of the migration (2026-07-07) — do not re-implement

Commits `63b5a119` + `5c5852e3` landed working code past the spike's scope
(reviewed 2026-07-07: mirror byte-identical, shellcheck clean, all
`test-skill-dispatch-wrappers.sh` checks green). What exists now:

- `.claude/skills/agent-cli/scripts/agent-wait.sh` — the bounded waiter,
  with 8 test cases in `test-skill-dispatch-wrappers.sh` and a path-policy
  smoke-subjects registration. Contract: exit 0 = decided (completion
  trailers or non-empty answer file), 10 = still running at `--timeout`
  (re-invoke), 20 = dead-run signature, 21 = dead wrapper with a live
  lock-holding orphan backend; output is one `agent-wait:` status line plus
  the `agent-run:` summary trailers, never log body. Flags from the codex
  consult verdict: `--finalized-only` (work-run waiters ignore a landed
  answer until the wrapper's drift check/lock release finish) and
  `--timeout 0` as the one-shot dead-run probe.
- Shared SKILL.md (both trees, still byte-identical): waiter guidance points
  at the helper instead of the hand-rolled until-loop; "Codex polling
  pattern" carries the verified caps and poll discipline; helper scope is
  explicit per the codex consult verdict — a caller holding a live session
  handle polls it directly (empty `write_stdin` at the 300000 cap), the
  helper is only for degraded cases (lost handle, someone else's dispatch,
  dead-run triage).
- CLAUDE.md's workflow-wrapper wait bullet points at the helper (exit-code
  summary inline).

The migration should move the codex-only parts of "Codex polling pattern"
into the `.codex` tree's harness-specific section, and split the
helper-scoping sentence in dispatch step 3 (the codex live-session-handle
clause is codex-only; the schema-bound-workflow-wrapper clause is
claude-only).

## Migration scope (implementation, after leaf 13)

- Move the skill-scoped parts of CLAUDE.md's "agent-cli inside Workflow
  scripts" section into the `.claude` tree's harness-specific section; audit
  line by line — anything an orchestrator needs *before* deciding to invoke
  the skill stays in CLAUDE.md, everything else moves.
- Build the `.codex` tree's harness-specific section by moving the codex-only
  lore out of the shared body (the "Codex polling pattern" section,
  codex-caller wait discipline), adding anything
  codex-specific worth promoting from `references/codex.md` (lock semantics
  for codex consults, session-store path). Symmetrically, claude-only wait
  lore (turn-ended waiting, `run_in_background`) moves into the `.claude`
  tree's section where it is not needed by both.
- Replace the byte-identical mirror-invariant test with the new structural
  assertion (trees identical outside the marked harness-specific section;
  each tree's section present and addressed to the right harness), and
  update leaf 10/20 instructions that say "edit under `.claude`, copy,
  `diff -q`".
- Portability: the caveat sections live inside SKILL.md itself, so the skill
  still travels by directory copy.

## Done criteria

- Each harness demonstrably sees its own caveats and not the other's.
  (Loader behavior half verified by the 2026-07-07 spike: both loaders
  inject their own tree's SKILL.md verbatim, so divergent trees deliver
  divergent content structurally.)
- CLAUDE.md no longer carries skill-scoped agent-cli lore.
- Mirror tests assert the new invariant; `.codex` tree still resolves the
  wrapper via the `.claude` path.
