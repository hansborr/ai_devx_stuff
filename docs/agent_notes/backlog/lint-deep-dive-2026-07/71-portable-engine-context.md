# 71. Portable-core milestone 2: pass an engine context instead of importing the Musi registry singleton (design-gated)

Status: Design recorded — in-tree engine context recommended; implementation still pending. Amended 2026-07-16: packaging mechanism superseded by lint-arch-review-2026-07 leaf 02 (see Addendum); the engine-context design itself stands.
Lens: portability · Area: ratchet + pipeline core · Severity: med · Size: L · Confidence: med-high
Theme: public-reference · Source: Musi lint deep-dive 2026-07-04 (3 parallel Codex xhigh lanes + Claude verification agents); successor to harness-review-2026-07 leaf 75 (Milestone 1 done)

## Problem
Milestone 1 documented the portable boundary; the code still crosses it.
Collection, mode dispatch, and the scheduler import the `lintRatchets`
singleton directly, and diagnostics/output import Musi shared schemas — so
"copy the ratchet" means "copy Musi's config shape and path assumptions,
then edit inside the engine." The same pattern repeats one layer up:
`path-policy.ts` embeds repo-specific file classes, package names, and
full-scan triggers inside otherwise-portable logic. For a repo whose stated
purpose is copyable harness engineering, the engine/adapter split is the
next real milestone, not more docs.

## Evidence
- `scripts/lint-ratchet/modes.ts:36,298-310`, `current-collector.ts:12,214-228`, `current-collection-scheduler.ts:4` — singleton imports. Verified 2026-07-04.
- `scripts/lint-ratchet/diagnostics.ts:5-10`, `output.ts:4` — shared-schema coupling (adoption guide documents the manual rewrite today).
- `scripts/path-policy/path-policy.ts:95-170` — embedded repo profile.
- `docs/agent_notes/backlog/harness-review-2026-07/75-portable-core-extraction.md` — Milestone 1 scope + the deferred remainder.

## Proposed direction
Introduce an explicit context object — `{ ratchets, paths, ruleDocs,
diagnosticsSchema, packageManager, repoMeta }` — constructed once in
`scripts/lint-ratchet.ts` (the Musi adapter) and threaded through modes,
collector, scheduler, and validation. Same move for a `repoProfile` consumed
by path-policy. Decision to record first: whether the portable core stays
in-tree under `scripts/lint-ratchet/` (adopters copy the dir; adapter file
excluded) or moves toward the extraction shape leaf 75 sketched — in-tree is
strongly suggested by the "runtime copy model" the adoption guide already
teaches. Prove the seam with the existing copy-and-run fixture test
(`PORTABLE_RUNTIME_FILES`) plus one new fixture whose context differs from
Musi's (different paths + reduced schema).

## Scope / caveats
- Large but mechanical; do it as a lane of small commits (context type →
  one consumer at a time), each passing the ratchet's own test suite.
- Freeze behavior with the envelope/baseline byte-identity tests before
  starting; no output changes allowed.
- Owner sign-off on the decision paragraph before the first commit.

## Design Decision — 2026-07-04

Recommendation: keep the portable ratchet engine in-tree under
`scripts/lint-ratchet/`, and introduce an explicit `LintRatchetEngineContext`
instead of importing the Musi registry singleton from engine modules. The Musi
adapter should be constructed at the CLI boundary (`scripts/lint-ratchet.ts` or
a small sibling adapter module) and pass `{ ratchets, thirdPartyPlugins, paths,
ruleDocs, diagnostics, packageManager, repoMeta }` into modes, default mode,
collector/scheduler, registry validation, edit-check, summary/update, and
reporting. Apply the same pattern to path-policy: keep query/evaluation logic
portable, and pass a `PathPolicyProfile` so Musi's source-relevant selectors,
full-scan triggers, script-smoke subjects, and package layout stop living inside
the engine.

Current seams re-verified before this decision:
- `bun run code:intel -- def --name lintRatchets --format json` resolves the
  exported registry at `scripts/lint-ratchet/lint-ratchet-config.ts:133:14`.
  `code:intel refs` from that definition reports 55 refs, including runtime
  imports in `scripts/lint-ratchet/modes.ts:36`,
  `default-mode.ts:14`, `current-collector.ts:12`,
  `current-collection-scheduler.ts:4`, `edit-check.ts:19`,
  `check-registry.ts:13`, and
  `post-merge-baseline-preflight.ts:4`.
- `scripts/lint-ratchet/diagnostics.ts:4-10` imports the Musi shared
  harness-diagnostics builders/schema, and
  `scripts/lint-ratchet/output.ts:4` imports the shared
  `HarnessDiagnostics` type.
- `scripts/lint-ratchet/output.test.ts:35-57` already proves the
  right shape for an in-tree copy fixture by excluding the real registry and
  deriving runtime modules, but it still copies
  `packages/shared/src/schemas/harness-diagnostics.ts` as a cross-directory
  runtime dependency.
- `bun run code:intel -- def --name PATH_POLICY --format json` resolves
  `PATH_POLICY` at `scripts/path-policy/path-policy.ts:90:14`; refs currently
  sit in `path-policy-query-core.ts` and path-policy tests, while the profile
  itself embeds Musi paths, package names, and full-scan triggers in the same
  module as the exported policy object.

Alternatives considered:
- Extract a package or separate repository now. This loses because leaf 75
  explicitly deferred package/repo extraction pending external adopter demand,
  and the current runtime-copy model plus fixture tests already give us a
  cheaper seam to harden first.
- Leave singleton imports and improve only the adoption guide. This loses
  because the copied runtime still has to edit engine internals: registry,
  third-party allowlist, shared diagnostics schema, paths, and path-policy
  profile are all concrete imports or embedded constants today.
- Pass only `ratchets` as a function argument. This loses because it fixes the
  most visible import while leaving rule docs, third-party plugin identity,
  baseline paths, diagnostics output/schema, package-manager commands, and path
  policy as hidden Musi globals.
- Use environment variables or dynamic imports for repo-specific pieces. This
  loses because it would make the portable contract implicit, harder to test,
  and easier to break than a typed context object passed through the call graph.

Acceptance test for a future implementation:
- Behavior stays byte-identical for Musi: existing baseline/envelope/output
  tests pass before and after each consumer is threaded through the context.
- A copy-and-run fixture constructs a non-Musi context with different source
  paths, baseline path, package-manager command strings, and a reduced local
  diagnostics schema; it must run without copying the real
  `scripts/lint-ratchet/lint-ratchet-config.ts` or
  `packages/shared/src/schemas/harness-diagnostics.ts`.
- The portable-runtime import-boundary check uses the same
  `PORTABLE_RUNTIME_FILES` source as the smoke fixture and fails if an engine
  runtime file imports the Musi registry, `packages/shared`, `eslint-config`,
  or path-policy profile data directly.
- `code:intel refs` for `lintRatchets` no longer lists engine runtime modules
  such as modes, default mode, collector, scheduler, registry validation, or
  edit-check; remaining refs should be Musi adapters, tests, coverage/harness
  generators, or other explicitly repo-specific surfaces.
- Path-policy query tests run against both the Musi `PathPolicyProfile` and a
  small fixture profile with different package roots/full-scan triggers, proving
  that the query engine is profile-driven rather than hard-coded to Musi.

## Addendum — 2026-07-16 (owner ruling via lint-arch-review-2026-07 leaf 02)

The packaging half of this decision is amended; the engine-context half
stands.

- **Superseded:** "keep the portable core in-tree under
  `scripts/lint-ratchet/` with adopters copying the directory" (the copy
  manifest + demo-sync mechanism). The engine moves to an internal
  workspace package whose boundary *is* the portable surface. Grounds: the
  sync harness carrying cost is now quantified (~830 LOC of
  manifest-expand + demo-sync check + test, plus a full mirrored engine
  copy), and lint-arch-review leaf 01 moves the baseline kernel onto
  `scripts/lib/baseline/`, splitting the portable surface across two
  directories — the "runtime-copy model as the cheaper seam" premise this
  decision rested on does not survive that convergence.
- **Still deferred:** external publication (npm package / separate repo)
  pending external adopter demand, exactly as leaf 75 recorded. The
  amendment is internal packaging only.
- **Stands:** the `LintRatchetEngineContext` / `PathPolicyProfile` design
  and this leaf's acceptance tests — the context object becomes the
  injected configuration the Musi adapter (leaf 02's layer 4) passes into
  the packaged kernel, and the import-boundary acceptance check becomes
  structural (package dependency graph) rather than copy-based.

Full ruling:
`docs/agent_notes/backlog/lint-arch-review-2026-07/02-package-seam-replaces-copy-manifest.md`.
