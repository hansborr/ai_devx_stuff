# Make Agent-CLI Dispatch Examples CWD-Independent

Status: Implemented
Date: 2026-07-29
Priority: P1
Size: S
Source: `agent-cli-and-external-reviews.md` — “Dispatch path portability”

## Problem

The agent-cli skill's fast path invokes its wrapper as
`.claude/skills/agent-cli/scripts/agent-run.sh`
(`.claude/skills/agent-cli/SKILL.md:17-29`). The command-shape, long-mission,
and follow-up examples repeat that repository-relative executable path
(`.claude/skills/agent-cli/SKILL.md:40-50,126-140`), and the lifecycle repeats
it for `agent-wait.sh` (`.claude/skills/agent-cli/SKILL.md:60-64`). If an
orchestrator's shell cwd has drifted into a repository subdirectory, Bash exits
127 with `no such file or directory` before the wrapper launches. There is
consequently no wrapper log, trailer, attempt record, or answer file; only the
shell diagnostic distinguishes this pre-launch failure from a run that
launched and later died.

A literal `/workspace/...` repair would work only in the primary checkout.
The skill is explicitly copyable into other repositories
(`.claude/skills/agent-cli/references/portability.md:1-21`), and linked
worktrees have their own top-level paths. The parallel-worktree examples
already avoid the primary-checkout assumption with a `<repo>` placeholder
(`.claude/skills/agent-cli/SKILL.md:97-114`), but that placeholder still
requires manual substitution.

The registration path makes this more than a one-file prose edit.
`harness.controls.json:2687-2729` declares the Claude tree canonical, the
Codex `SKILL.md` as a harness-block projection, Codex `agents/` as
target-owned, and `scripts/tests/test-skill-dispatch-wrappers.sh` as the owning
smoke. `bun run harness:skills:refresh` projects the shared text and
regenerates smoke subjects (`package.json:60-61`;
`scripts/harness/generate-skill-artifacts.ts:60-92`). It preserves the
hand-authored Codex harness block while replacing its surrounding shared text
(`scripts/harness/skill-overlay-content.ts:27-72`), so the Codex polling
example and the cross-tree command-path invariant require deliberate,
hand-maintained edits.

## Scope

- In canonical `.claude/skills/agent-cli/SKILL.md`, change every runnable
  `agent-run.sh` and `agent-wait.sh` example to the quoted Git-rooted form:
  `"$(git rev-parse --show-toplevel)/.claude/skills/agent-cli/scripts/<name>.sh"`.
  Cover the fast path, command shape, lifecycle helper, parallel worktree
  dispatch, long-mission, and follow-up examples. State once that dispatch
  starts inside the worktree the run owns, so `git rev-parse` resolves that
  checkout.
- In `.codex/skills/agent-cli/SKILL.md`, preserve the Codex-specific harness
  block but hand-update its `exec_command` JSON example to the same rooted
  command shape. Then run `bun run harness:skills:refresh` to project the
  canonical shared sections around that block.
- In `.codex/skills/agent-cli/agents/openai.yaml`, replace the target-owned
  instruction that names the bare repository-relative wrapper with guidance
  pointing to the Git-rooted wrapper form in `SKILL.md`. Do not duplicate a
  second path convention in UI metadata.
- In `scripts/tests/test-skill-dispatch-wrappers.sh`, keep the generated
  skill-smoke subject block at
  `scripts/tests/test-skill-dispatch-wrappers.sh:3-23` generator-owned. Add
  hand-maintained assertions beside the existing `SKILL.md` and
  target-metadata checks at
  `scripts/tests/test-skill-dispatch-wrappers.sh:5315-5401` that:

  - both skill trees use the quoted `git rev-parse --show-toplevel` form for
    every runnable wrapper/waiter example;
  - neither tree retains a bare relative, literal `/workspace`, or `<repo>`
    executable example;
  - the Codex harness block and `openai.yaml` retain the rooted-path guidance;
    and
  - the rooted form resolves the checked-out wrapper from a nested directory
    in a linked-worktree fixture.

- Run `bun run harness:skills:refresh` and inspect every generated surface.
  The expected changed-file set is exactly:
  `.claude/skills/agent-cli/SKILL.md`,
  `.codex/skills/agent-cli/SKILL.md`,
  `.codex/skills/agent-cli/agents/openai.yaml`, and
  `scripts/tests/test-skill-dispatch-wrappers.sh`. Because no skill file is
  added, removed, or rerouted, the marked subject list and the downstream
  `scripts/path-policy/path-policy-smoke-subjects-data.ts` and
  `scripts/fixtures/test-scripts/all-smoke-tests.txt` outputs must remain
  unchanged after refresh.
- Do not change `agent-run.sh`, `agent-wait.sh`, `harness.controls.json`, the
  projection generator, dispatch semantics, or wrapper failure
  classification.
- No other repository doc or guide copies the relative path as a runnable
  dispatch. `docs/ai-harness.md`'s **Substrate Ruling (Bash Vs TS)**,
  `.claude/skills/agent-cli/references/portability.md:69-70`, and
  `.claude/skills/agent-cli/references/trailer-contract.md:1-4` identify or
  validate the file rather than teach dispatch; leave them unchanged.

## Acceptance

- Copying a fast-path, command-shape, parallel-worktree, long-mission, or
  follow-up invocation from either skill tree resolves the wrapper from any
  subdirectory of the current worktree.
- In a linked worktree, the copied form resolves that worktree's wrapper, never
  `/workspace` or another checkout.
- A cwd-caused missing-wrapper exit 127 is no longer reachable from any
  runnable `SKILL.md` example; the wrapper's launch, logging, trailer, and
  answer contracts remain unchanged.
- `bun run harness:skills:refresh` produces only the four expected file diffs,
  and a second refresh is clean.
- `bash scripts/tests/test-skill-dispatch-wrappers.sh`,
  `bun run harness:skills:check`, `bun run test:scripts:subjects:check`, and
  `bun run harness:check` pass.

Implementation coverage note (2026-07-29): the smoke executes the documented
rooted wrapper prefix from a nested directory in the active checkout. It
deliberately does not synthesize a linked worktree; linked-worktree selection
is covered by the lexical requirement to use the active checkout's
`git rev-parse --show-toplevel`, not by a second Git-behavior fixture.

## Resolved decisions

- Use the quoted `$(git rev-parse --show-toplevel)`-rooted executable form,
  matching the root-command pattern in `AGENTS.md:13-16`. It is immediately
  copyable, survives ordinary cwd drift, and follows the active linked
  worktree.
- Reject literal `/workspace/...`: it binds the example to one checkout and
  violates the portable-skill contract.
- Reject a documented `$REPO`/`<repo>` placeholder plus setup: the extra
  substitution is easy to omit, and the fast path should be executable when
  copied as shown.
- Reject retaining the relative path with an explicit cwd precondition:
  subdirectory drift is routine, and a documentation-only precondition leaves
  the observed exit-127 failure intact.

## Open questions

None.
