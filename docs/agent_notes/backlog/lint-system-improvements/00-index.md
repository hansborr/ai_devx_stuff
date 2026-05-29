# Lint System Improvements

Status: Parked task index
Last updated: 2026-05-27
Source: original synthesis content is preserved by commit `a0975f3a`.

This backlog migrates the 2026-05-26 lint-system review synthesis into
23 promotable task notes. It is a refinement queue for the lint platform:
local/CI parity, duplicate gate wiring, policy ownership, portability, and
measured architecture spikes.

Promote one leaf at a time. Several items overlap the older
`docs/agent_notes/backlog/lint-reference-readiness/` queue or work that has
already landed locally. Re-run the live audits or file searches named in the
leaf before implementing and treat the overlap notes as pointers, not current
truth.

## Preserve

Keep these design principles while implementing any leaf in this folder:

- Ratchets use committed baselines, rule/config hashing, symmetric
  regression/improvement checks, and explicit zero-baseline lifecycle handling.
- Domain and architecture rules stay in lint where they prevent recurring
  mistakes, especially package boundaries, concurrency helpers, tRPC/schema
  contracts, socket lifecycle, and structured logging.
- Pre-commit can stay parallel, bounded, and content-keyed with lock and
  watchdog protection.
- Agent hooks should stay fast and non-blocking. Enforcement belongs in
  verify, pre-commit, and CI.
- Generated lint guidance, harness docs, and coverage maps are useful only when
  drift checks remain part of the gate.

## Promotion Rules

1. Promote exactly one task file into `docs/agent_notes/NEXT.md` or an
   `in_progress/` note.
2. Re-run the live audits named in the task. If the task lists targets instead
   of exact commands, use current `rg`, `bun run code:intel`, or nearby test
   coverage searches before editing. The source review was written on
   2026-05-26, and some findings may already have changed.
3. If the promoted task is still too large, split it again and update this
   index.
4. When a task lands, update durable handoff notes only where useful:
   `docs/agent_notes/LOG.md`, `docs/agent_notes/finished_work/`, or a decision
   record for true policy changes.

## Relationship To Existing Lint Backlogs

`lint-reference-readiness/` remains the canonical index for its original
reference-readiness cycle. This folder captures a later review pass with a
different shape: some items are direct follow-ups, some are refinements of
already-landed work, and some are spikes that should not block the reference
cycle.

When promoting an overlapping task, check both folders and close or merge stale
duplicates as part of the leaf.

## Active Work

None.

## Completed Work

Tasks 01-05, 08, 09, 13, 15, 16, 18-20 have landed and their leaf files have
been removed. Historical context is in git history and `docs/agent_notes/LOG.md`.

## Recorded Decisions

These tasks have a design direction recorded but are not yet implemented:

None currently.

## Ordering

Correctness and parity work comes first, then policy ownership and portability,
then documentation clarity and measured architecture spikes.

Filenames are the durable promotion order. The `07a`-`07d` sub-leaves split the
original harness execution-manifest item without renumbering later files.

## Dependencies And Coupling

Check these before promoting a leaf:

- `05` (done) should be settled before `06`; both touch ESLint config policy
  ownership.
- Promote `07a` before `07b`-`07d`. `07c`, `07d` all touch runner boundaries,
  so re-audit them together if any one lands first.
- Coordinate `14` with
  `docs/agent_notes/backlog/lint-reference-readiness/24-eslint-max-lines-policy.md`;
  either merge the work or make one task explicitly depend on the other.

1. `06-ratchet-suppression-metadata.md` - generate normal-lint suppressions
   from exact ratchet metadata.
2. `07a-harness-controls-simple-slot-validation.md` - validate simple harness
   command slots before adding runner behavior.
3. `07b-harness-controls-tier-metadata.md` - add checked tier metadata for
   validated slots.
4. `07c-harness-controls-runner-generation.md` - generate or adapt simple
   runner wiring from the manifest.
5. `07d-harness-controls-changed-semantics.md` - model changed/staged input
   semantics before migrating complex slots.
6. `10-lint-tool-doctor-parity.md` - make lint tool provisioning and version
   reporting first-class.
7. `11-ci-eslint-cache-spike.md` - measure whether CI ESLint caching is worth
   adopting.
8. `12-ci-validate-fanout.md` - parallelize CI validate after typecheck while
   preserving ratchet reporting.
9. `14-max-lines-exception-lifecycle.md` - classify and report max-lines
   exceptions by lifecycle.
10. `17-typescript-hook-runner-spike.md` - spike one TypeScript hook runner
    path without rewriting the shell layer wholesale.

## Explicit Non-Goals

- Do not add CI commit-message enforcement unless the local non-squash policy
  changes.
- Do not make post-edit tidy hooks blocking by default.
- Do not introduce changed-only ratchets until rule source, config, parser,
  dependency, and baseline invalidation are proven safe.
- Do not rewrite all hooks at once. Preserve signal handling, lock behavior,
  payload parsing, and output shape while any spike is evaluated.
