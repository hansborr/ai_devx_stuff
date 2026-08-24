# 101. Mutation-testing docs still promise sandbox isolation while three of the four lanes mutate tracked source in the live worktree

Status: Not started
Theme: mutation-run operator-doc accuracy · Area: docs · Severity: medium · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The landed mutation-testing plan and the operator guide both let a contributor
believe Stryker runs are sandboxed, but three of the four advertised lanes —
scripts, server, and lint-ratchet — set `inPlace: true` and write mutants
directly into tracked source in the live worktree. The plan's non-goal section
still asserts "Stryker mutates code in its own sandbox", and
`docs/ai-harness.md` labels only the server lane as in-place. The one warning
that actually matters to an operator — a hard kill mid-run can leave
single-character mutants stranded in tracked files, because Stryker restores
from `.stryker-tmp/backup` only on a clean exit — lives solely inside the
individual config comments, where nobody reads before typing a command. Neither
doc offers a preflight check or a recovery workflow, so an operator who trusts
the docs and kills an overnight run is left with silently mutated source and no
documented way to notice or undo it. For a repo meant to be copied as a
harness-engineering reference, the operator guide contradicting the executable
configs is a direct credibility cost.

## Evidence

- `docs/agent_notes/backlog/mutation-testing-stryker.md:53-55` — Non-Goals:
  "Do not make Stryker workers use separate git worktrees. Stryker mutates code
  in its own sandbox; resource isolation should be handled through env-driven
  DB/port selection or by running serially." The document is marked
  `Status: landed` (`:3-6`), so this reads as a description of the landed state.
- `docs/agent_notes/backlog/mutation-testing-stryker.md:283` — the Scope
  Expansion section later concedes the server lane "Runs serial + `inPlace`",
  and `:289-290` mentions "in-place backups / crashed-run sandboxes" — internally
  contradicting the sandbox premise while saying nothing about the scripts and
  lint-ratchet lanes being in-place too (they appear only in the status header
  at `:4-5`).
- `docs/ai-harness.md:607-635` — the operator-facing Mutation Testing section:
  run prose at `:609-613`, per-lane scopes at `:621-635`. Only the server bullet
  says `inPlace` (`:629`); the scripts and lint-ratchet bullets carry no
  in-place marking, and the section has no interruption warning or recovery
  procedure. The run prose at `:609-613` also omits
  `bun run test:lint-ratchet:mutation`, though its scope is listed at `:625-626`.
- Exactly 3 of the 4 lane configs set `inPlace: true` (re-measured by grep over
  the tree): `scripts/stryker-scripts.mjs:11`, `stryker.config.server.mjs:21`,
  `tools/stryker-lint-ratchet.mjs:9`. The shared lane (`stryker.config.mjs`)
  uses the default sandbox; `stryker.shared.mjs:79` only passes the option
  through.
- Each in-place config warns in its own comment that a hard kill mid-run can
  leave mutated sources on disk, restored from `.stryker-tmp/backup` only on a
  clean exit: `scripts/stryker-scripts.mjs:5-11`,
  `stryker.config.server.mjs:14-21`, `tools/stryker-lint-ratchet.mjs:5-9`.
- `package.json:53-56` — the four public wrappers (`test:mutation`,
  `test:scripts:mutation`, `test:lint-ratchet:mutation`,
  `test:server:mutation`) trap `EXIT INT TERM` only to `rm -f
  stryker-setup-*.js`; none performs or documents live-source recovery.

## Proposed direction

Agreed disposition, quoted: "Replace the stale blanket sandbox statement in
`docs/agent_notes/backlog/mutation-testing-stryker.md` with the per-lane split,
mark the scripts, server, and lint-ratchet lanes as inPlace in
`docs/ai-harness.md`'s mutation section, and add one operator-facing
hard-interruption warning with a verified git-based preflight/recovery recipe,
coordinating wording with D-065 (L06-103) if its guarded-runner direction
lands." (D-065 is
[066-three-mutation-test-lanes-can-strand-live.md](066-three-mutation-test-lanes-can-strand-live.md).)

Mechanics — treat the executable configs as authoritative:

1. In `docs/agent_notes/backlog/mutation-testing-stryker.md`, rewrite `:53-55`
   to state the landed per-lane reality: the shared lane
   (`stryker.config.mjs`) uses Stryker's default sandbox; the scripts, server,
   and lint-ratchet lanes run `inPlace` against tracked source (with the
   one-line reason from each config: sandbox copies break `import.meta.url`/git
   resolution, vitest global-setup paths, and `@musi/lint-ratchet/*`
   resolution). Keep the still-true half of the non-goal (no separate git
   worktrees; resource isolation via env-driven DB/port selection or serial
   runs).
2. In `docs/ai-harness.md:621-635`, mark the scripts and lint-ratchet scope
   bullets `inPlace` like the server bullet, and add
   `bun run test:lint-ratchet:mutation` to the run prose at `:609-613`.
3. Add one operator-facing warning in the `docs/ai-harness.md` mutation section
   (and a pointer from the plan doc): in-place lanes restore sources from
   `.stryker-tmp/backup` only on a clean exit, so a hard kill/OOM can strand
   mutants in tracked files. Pair it with a recipe verified against the actual
   config globs: preflight — confirm the lane's mutate targets are clean
   (`git status --porcelain` over them) before starting; recovery — check
   `git status`/`git diff` on the mutate paths, `git restore` them, and remove
   `.stryker-tmp/`.

If [066-three-mutation-test-lanes-can-strand-live.md](066-three-mutation-test-lanes-can-strand-live.md)
lands its supervised runner first, step 3's recipe must instead describe that
runner's behavior (preflight abort, stale-state detection, its printed recovery
command) rather than a hand-run git recipe — that leaf explicitly reserves the
final wording coordination.

## Scope / caveats

- **Docs-only.** Any change to wrappers, configs, or `stryker.shared.mjs` —
  including the config comments themselves, which leaf 066 rewrites to point at
  its runner — is out of scope here; runtime safety rails are owned by
  [066-three-mutation-test-lanes-can-strand-live.md](066-three-mutation-test-lanes-can-strand-live.md).
- **Sequencing: land after 066 if its guarded-runner direction is going ahead**
  (066's own sequencing note requires this leaf to describe the final runtime
  behavior). If 066 is deferred, this leaf may land alone with the manual
  git-based recipe; 066 then updates the wording when it lands.
- Keep the shared lane's description accurate — it genuinely sandboxes; the fix
  is a per-lane split, not a blanket "everything is in-place" inversion.
- Prior pack: [43-stryker-config-duplication.md](../code-quality-2026-07-25/43-stryker-config-duplication.md)
  (CQ25-221) carries a do-not-reopen ruling on the landed `.mjs` config route
  and its overturned feasibility stop. This leaf documents operator-visible
  semantics only and must not re-litigate that decision or propose config
  restructuring.
