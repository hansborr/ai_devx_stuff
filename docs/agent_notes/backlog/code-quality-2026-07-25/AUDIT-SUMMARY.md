# Codebase Quality Audit — findings summary

Status: Reference — background for [00-index.md](./00-index.md), not a work item
Created: 2026-07-25 · Updated: 2026-07-28

Companion to [00-index.md](./00-index.md). This file is **background, not
scheduling input**: what the audit concluded, which lenses it ran, and where it
did not look. An agent scheduling or executing a leaf needs the index, the leaf
and its plan — not this.

## Executive summary

**The application code is in better shape than the harness and the test suite,
and the two halves should be scheduled differently.** The application has no god
files (the largest hand-written server source is 561 lines), the router/service
layering documented in `packages/server/src/services/README.md` holds in the
large — confirmed independently by both consults behind
[SERVER-COMMENTS-PLAN.md](./SERVER-COMMENTS-PLAN.md), which found no finding of
the form "this logic is in the wrong layer" in any of leaves 02-05 — schema
naming across the shared package is disciplined (124
`*InputSchema` exports, each paired with its inferred `*Input` type), every
non-test script is reachable, no generated file has been hand-edited, e2e uses
page objects throughout with zero `waitForTimeout`, and the client package
contains no TODO/FIXME/HACK markers at all.

The harness and the test suite are a different story: a 2,526-line shell script,
a 2,761-line test file, a 603-line untyped shadow router, and several unfinished
migrations all live there.

The debt that does exist is a **mixture**, not one thing. In rough order of how
much of the pack it accounts for:

1. **Duplication that should have been extraction** — the largest single group.
   The codebase repeatedly solved a problem correctly once, then paid for that
   solution by copy-paste: 44 shell files each redefining `fail()` (leaf 27),
   eleven hand-written copies of one shell finding shape and three copies of one
   path normaliser (leaf 31). Leaves 01 and 39 were the same shape and are what
   this group looks like closed.
2. **Weakly typed boundaries** — a hand-written shape replaces a generated one and
   the lost information is bought back with casts (leaves 07 and 41 open; 01, 11
   and 24 landed).
3. **Incomplete migrations left readable as active contract** — vestigial
   wrappers and a shipped migration recipe for a finished migration (leaves 04,
   44).
4. **A shared substrate created and then only partly adopted** — `scripts/lib`'s
   `parseCli` has 10 importers against 19 hand-rolled argv walkers, and its
   canonical `PROCESS_ARGV_USER_ARGS_START` is imported by 4 of the 42 files that
   carry the offset, against 32 local re-declarations under seven different names
   (leaf 30). `eslint-rules/ast-helpers.js` is the counter-example and shows what
   "finished" looks like: 16 of the 32 registered rules import it plus two shared
   helper modules, and no local `unwrapChain`/`staticPropertyName` copy remains.
   Leaf 38 is scoped to `parentOf` (seven definitions across two competing homes)
   and `isFunctionNode` (four sites, three semantically distinct bodies — one
   throws where the others return `false`, so a blind codemod changes rule
   behaviour), the rule-registry ordering, and config tests parked in the wrong
   project.
5. **Conventions documented but unenforced** — `scripts/README.md` states a
   directory rule that 62 top-level files across seven flat families violate
   (leaf 28).
6. **Orientation contracts missing where the charter requires one** —
   `scripts/drift-ai/`'s 344 modules and the `scripts/` layout as a whole (leaf
   28), and the fixture copy-set analyzer inside `scripts/path-policy/` (leaf 49,
   the only one scoped to a single sub-tool rather than a whole directory
   family).
7. **Real modelling and contract defects.** These are not stylistic. Three have
   landed — versatile weapon damage silently dropped across two spellings of one
   SRD concept (19), the prepared-spell limit as a check-then-act race (51), and
   nested relation writes reaching every gated table through a non-gated delegate
   (50, closed by lint; leaf 60 holds the runtime closure). The open one is **leaf
   58**, and it is the counterpart to 51 rather than more of it: character
   creation writes six prepared level-1 spells for a wizard whose cap is four,
   with no concurrency involved at all, because creation makes no cap check — the
   same invariant, enforced on one of its two writers. Leaf 61 (landed) is the
   pack's only `high`; its client half is leaf 62.

## Comment density

**Comment volume is a narrow problem, not a broad one.** Measured comment density
is healthy in the large files: `verify-engine.sh` 8%, `policy.sh` 13%,
`worktree-db.sh` 14%, `doctor.sh` 20%. Twelve files across `eslint-rules/`,
`eslint-config/` and `tools/` exceed 40% comment density, but ten of them are
under 100 non-blank lines, where the ratio says little; the two substantial ones
are `eslint-config/max-lines-exceptions-codec.js` (60%) and
`eslint-config/restricted-syntax-builder.js` (50%). Judge long blocks one at a
time: most are **load-bearing and must be kept verbatim** — the concurrency
trust-boundary headers, the auth timing-oracle explanation, the Socket.IO
disconnect ordering note, the AoE coordinate model, the Zustand
callback-after-commit invariant, and the SRD geometry derivations among them.

The real comment problem is two specific things, leaves 44 and 45:

- **Archaeology shipped as contract** (leaf 44) — comments recording the change
  that produced the code rather than what the code does: bare leaf and task ids
  (`arch-plans-2026-07 leaf 02`, `DX5.3c-DX5.3f`), a spike record for a rejected
  design, a migration recipe for a finished migration, an anchor to a deleted
  `awk` script, `(done)` follow-ups. Some of these strings reach two audiences
  beyond the source file: four render into `docs/generated/harness-controls.md`,
  and `scripts/lint-ratchet/diagnostics.ts` puts the same `principle` text into
  the agent-facing regression envelope.
- **Comments compensating for code** (leaf 45) — where the fix is a rename, an
  extraction, or a type. Sharpest case: a file header claiming a compile-time
  guarantee the types do not actually provide.

## Naming

Leaf 46 collects the pure renames, with more in 17 and 36. Representative: a
variable named `action` holding a `ChatMessage`; `finishTopLevelCommand` which
runs the command rather than finishing it; `EpochWindow` carrying an exit code;
`testId`/`tests` throughout a lint kernel with nothing to do with tests; one
entity spelled `w`/`h` in one module and `width`/`height` in its sibling.

## Coverage

**In scope:** all of `packages/{shared,server,client}/src` except generated
Prisma output; `scripts/` (all 162 root scripts by name, `lib/`, `git/`, `harness/`,
`ai-hooks/`, `tests/`, `path-policy/`, `codemods/` layout, plus sampled `drift-ai/`,
`code-intel/`, `logs-audit/`, `drift-triage/` module bodies); all 92 `eslint-rules/`
files by name and ~15 in full; every `eslint-config/*.js`; `tools/lint-ratchet/`;
all 6 root tsconfigs, all four Stryker configs, all 10 vitest configs,
`knip.config.ts`, `playwright.config.ts`; `e2e/` in full (49 `.ts` files);
`.husky/*`; all 171 package.json scripts across the six tracked manifests.

**Out of scope:** `harness.controls.json` internals (2,819 lines, treated as
generator input); `scripts/codemods/` implementations (452 files, mostly fixtures);
`packages/server/src/generated/`; most of `scripts/drift-ai/`'s 344 module bodies;
`docs/` beyond the files leaves cite. Absence of a leaf in these areas is not
evidence that they are clean.

**Deliberately excluded:** bug hunting and security review (use `/code-review` and
`/security-review`), and anything owned by
`docs/agent_notes/backlog/codebase-audit/` (closed 2026-07-19).
