# 10. Trailer/exit-code contract: one artifact consumed by wrapper, tests, and SKILL.md

Status: Implemented 2026-07-07
Size: S-M · Depends on: none — do this first; its tests are the safety net for leaves 11–13
Source: consolidation item 2 + arch-review-2026-07 A2/T4 (2026-07-07 merge of the two)

## Problem

The `agent-run:` trailers (`dispatched:`/`backend-pid:` header;
`worktree:`/`backend-exit:`/`session-id:`/`answer:`/`branch:`/`head:` finalize
set) are a machine-read API — orchestrators, workflow shims, and the SKILL.md
waiting loops all grep them, and SKILL.md already has to warn against anchoring
on the wrong key. Today the contract lives as a ~39-line prose header comment
(`agent-run.sh:1-40`), is restated by hand in SKILL.md, and is asserted only
implicitly by the 1762-line fork-exec test.

## Shape ruling (resolves the item-2 vs A2 divergence)

The "single artifact" is a **contract reference file inside the skill
directory** (e.g. `references/trailer-contract.md`) — it travels with the
skill by file copy. "Consumed by all three" means:

- **Tests** assert the wrapper's conformance to the documented invariants
  (the enforcement edge).
- The **wrapper's** header comment shrinks to a pointer at the reference file.
- **SKILL.md** links to the reference instead of restating key lists.

Do **not** introduce a code-generation step into the wrapper: it must stay
hand-written single-file bash with no build step (portability ruling).
Generated shell is house style for repo-local surfaces
(`../arch-review-2026-07/11-generated-resolver-and-timeout-constants.md`), not
for the portable skill.

## Scope

- Contract table: every trailer key — launch header set vs finalize set —
  required vs optional, ordering guarantees, and exit-code meanings 0/1/2/3/4
  (wrapper-owned; backend codes never pass through raw).
- Tests asserting the consumer-critical invariants per exit path (success,
  backend failure, usage error, lock busy, consult drift, TERM,
  SIGKILL-orphan): header lands before completion trailers; completion is
  anchored on `worktree:`/`backend-exit:`; exit-code meanings hold; optional
  keys are specified as optional. **Not** byte-exact golden files — the stream
  carries legitimately optional records (`session-id`, `head`, Claude cost,
  drift details) that exact key-set/ordering assertions would overfit.
- Update the wrapper header and SKILL.md to point at the artifact (respect the
  `.claude`/`.codex` docs mirror: reference docs like `trailer-contract.md`
  stay byte-identical, so edit under `.claude`, copy, `diff -q`; SKILL.md is a
  *structural* mirror since leaf 21, so edit its shared core identically in both
  trees and never copy one tree's SKILL.md over the other's harness-specific
  block).

## Done criteria

- One contract file under `.claude/skills/agent-cli/references/`, mirrored to
  `.codex` per the docs-mirror invariant.
- Invariant tests exist per exit path and pass; existing wrapper behavior is
  unchanged (this leaf adds assertions and documentation, no wrapper logic).
- Wrapper header and SKILL.md reference the artifact instead of duplicating it.

## Verification

- `bash scripts/tests/test-skill-dispatch-wrappers.sh` (or its focused
  invocation) green, including the existing mirror-invariant checks.
