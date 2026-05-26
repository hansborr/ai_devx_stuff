# Lint System Improvements

Status: Parked task index
Last updated: 2026-05-26
Source: original synthesis content is preserved by commit `a0975f3a`.

This backlog migrates the 2026-05-26 lint-system review synthesis into
22 promotable task notes. It is a refinement queue for the lint platform:
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

## Recorded Decisions

These tasks have a design direction recorded but are not yet implemented:

- `02` — composite CI lint floor (drop separate `lint:shell` /
  `lint:config-sensors` steps).
- `03` — drop `check-baseline` from CI, fold `check-registry` into
  `lint:ratchet` preflight. CI runs only `lint:ratchet` +
  `lint:ratchet:zero-baseline`.
- `04` — resolved by task 03; `verify:changed` already matches the simplified
  CI ratchet surface.
- `08` — document why `parallel-runner.sh` and `parallel-step.sh` are separate;
  do not unify.
- `18` — keep ESLint authoritative. Biome is fast enough to revisit only as an
  opt-in lint-only advisory tier with formatter and assist disabled.

## Ordering

Correctness and parity work comes first, then policy ownership and portability,
then documentation clarity and measured architecture spikes.

Filenames are the durable promotion order. The `07a`-`07d` sub-leaves split the
original harness execution-manifest item without renumbering later files.

## Dependencies And Coupling

Check these before promoting a leaf:

- Promote `05` before `06`; both touch ESLint config policy ownership, and
  generated ratchet suppressions should build on the settled linted-script
  surface.
- Recheck `05` before `15` if shared-policy exports or `eslint.config.js`
  imports changed; both tasks touch the boundary between config composition
  and reusable policy data.
- Recheck `04` before `06` if ratchet CI command names or registry checks
  changed; `06` should not generate suppressions against stale ratchet
  metadata assumptions.
- Promote `07a` before `07b`-`07d`. `07c`, `07d`, and `08` all touch runner
  boundaries, so re-audit them together if any one lands first.
- Coordinate `10` with
  `docs/agent_notes/backlog/lint-reference-readiness/20-external-tool-provisioning.md`
  and
  `docs/agent_notes/backlog/lint-reference-readiness/21-external-tool-dev-parity.md`;
  the doctor should report the same system-tool contract CI and onboarding use.
- Coordinate `12` with
  `docs/agent_notes/backlog/lint-reference-readiness/32-ci-parallelization.md`;
  merge or close the older spike if this fanout work lands first.
- Coordinate `14` with
  `docs/agent_notes/backlog/lint-reference-readiness/24-eslint-max-lines-policy.md`;
  either merge the work or make one task explicitly depend on the other.
- `09` and `10` both define tool provisioning conventions. If one lands first,
  update the other task's scope before promotion.
- Promote `16` only after auditing all callers of the renamed
  `lint:agent:local-rules` surfaces, including hook adapters and generated
  harness docs.

1. `01-ci-coverage-map-gate.md` - add the full coverage-map gate to CI.
2. `02-ci-lint-step-deduplication.md` - *(decision recorded)* composite floor.
3. `03-ratchet-ci-pass-deduplication.md` - *(decision recorded)* drop
   check-baseline, fold check-registry.
4. `04-verify-ratchet-ci-parity.md` - *(resolved by 03)* parity achieved.
5. `05-derive-linted-script-reinclude-patterns.md` - derive flat-config
   reinclude patterns from the linted script surface.
6. `06-ratchet-suppression-metadata.md` - generate normal-lint suppressions
   from exact ratchet metadata.
7. `07a-harness-controls-simple-slot-validation.md` - validate simple harness
   command slots before adding runner behavior.
8. `07b-harness-controls-tier-metadata.md` - add checked tier metadata for
   validated slots.
9. `07c-harness-controls-runner-generation.md` - generate or adapt simple
   runner wiring from the manifest.
10. `07d-harness-controls-changed-semantics.md` - model changed/staged input
    semantics before migrating complex slots.
11. `08-parallel-runner-unification.md` - *(decision recorded)* document
    separation, do not unify.
12. `09-agent-hook-pinned-tools.md` - replace agent-hook `npx` usage with the
   pinned local toolchain.
13. `10-lint-tool-doctor-parity.md` - make lint tool provisioning and version
    reporting first-class.
14. `11-ci-eslint-cache-spike.md` - measure whether CI ESLint caching is worth
    adopting.
15. `12-ci-validate-fanout.md` - parallelize CI validate after typecheck while
    preserving ratchet reporting.
16. `13-warning-severity-semantics.md` - document normal ESLint warning
    enforcement versus agent-envelope warning behavior.
17. `14-max-lines-exception-lifecycle.md` - classify and report max-lines
    exceptions by lifecycle.
18. `15-eslint-entrypoint-exports.md` - stop exposing shared policy through
    `eslint.config.js`.
19. `16-lint-agent-alias-retirement.md` - retire or explicitly sunset legacy
    `lint:agent` aliases.
20. `17-typescript-hook-runner-spike.md` - spike one TypeScript hook runner
    path without rewriting the shell layer wholesale.
21. `18-fast-edit-loop-linter-spike.md` - **done** — narrow Biome advisory
    decision.
22. `19-lint-platform-positioning.md` - present the setup as a lint platform
    with minimal and full adoption paths.

## Explicit Non-Goals

- Do not add CI commit-message enforcement unless the local non-squash policy
  changes.
- Do not make post-edit tidy hooks blocking by default.
- Do not introduce changed-only ratchets until rule source, config, parser,
  dependency, and baseline invalidation are proven safe.
- Do not rewrite all hooks at once. Preserve signal handling, lock behavior,
  payload parsing, and output shape while any spike is evaluated.
