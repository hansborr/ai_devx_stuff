# 68. Two lint-ratchet sandboxes still keep their adapter import closures by hand

Status: **Done 2026-07-31** on branch `fix/cq-68-69-fixture-and-control`.
Theme: Sandbox fixtures should fail at the missing dependency · Area: harness · Severity: low · Size: S

Source: review of SERVER-COMMENTS S12 on
`feat/cq-server-comments-s12-s13` (2026-07-30), after full verification exposed
both copy lists during the original implementation · Confidence: high for the
gap, open on the smallest design

Evidence is pinned to `1a4dba03c`. Re-resolve line anchors before implementation.

## Outcome

- The residual was worth closing, but derivation was not. Both existing copy
  lists remain local to the sandbox that consumes them and now have focused
  static-import closure assertions using the existing
  `validateSeedImportClosure` walker.
- `output.test.ts` checks `ADAPTER_SUPPORT_FILES` before creating a fixture.
  `test-lint-ratchet.sh` checks `PORTABLE_RUNTIME_FILES` before building a
  fixture. Both explicitly require the adapter entry, treat the fixture-written
  registry as a terminal, and treat the symlinked `@musi/lint-ratchet` package
  as external.
- TDD removed `scripts/lib/records.ts` from each list. Each new assertion failed
  first and named the missing helper plus all four importing modules; the
  Vitest sandbox's later module-resolution failures demonstrated the noisier
  signal the focused check replaces.
- Review follow-up TDD then removed the adapter entry itself. Because the walker
  necessarily allows its entry, both guards now assert entry membership
  explicitly; each failed at that assertion before the entry was restored.
- The generic shell `unmodelled-copy` annotation remains truthful: the
  path-policy analyzer still cannot enumerate the `git ls-files` pipeline. Its
  comment now points to the focused assertion. No fixture framework, copy-list
  parser, or manifest was added.

## Problem

The repository's fixture import-closure guard covers ordinary shell copy sets,
but two lint-ratchet sandboxes remain outside that proof:

- `scripts/lint-ratchet/output.test.ts:37-46` maintains
  `ADAPTER_SUPPORT_FILES` manually for a Vitest-created repository.
- `scripts/tests/test-lint-ratchet.sh:100-115` maintains the overlapping
  `PORTABLE_RUNTIME_FILES` list. Its copy loop is explicitly marked
  `fixture-closure: unmodelled-copy` at `:201-205`.

S12 originally added a shared `scripts/lib/` dependency. Focused tests stayed
green until full verification revealed that both lists needed the new file.
The review pass removed that dependency by co-locating the predicate in the
already-copied `lint-rule-docs.ts`, so this branch no longer needs the reactive
entries. The next unrelated cross-directory adapter import can still repeat the
same failure.

## Existing coverage and boundary

`docs/agent_notes/backlog/ready-2026-07/03-fixture-copy-set-import-graph-guard.md`
is landed and already checks statically modelled shell fixtures. It deliberately
allows the shell list above through the reasoned `unmodelled-copy` escape hatch,
and it does not parse copy arrays embedded in Vitest files. This leaf is the
residual case, not a proposal to rebuild that guard.

## Proposed direction

Choose the smallest source of truth that both sandboxes can consume, or add a
focused closure assertion for each:

1. Derive the required transitive repository-local imports from the adapter
   entry points using the existing import-closure walker.
2. Compare that closure with `ADAPTER_SUPPORT_FILES` and
   `PORTABLE_RUNTIME_FILES`, reporting the missing paths directly.
3. Remove the shell `unmodelled-copy` escape only if the resulting copy set is
   genuinely modelled. Do not add a second general-purpose fixture framework.

An implementation that must teach the path-policy analyzer to parse arbitrary
Vitest constants and dynamic shell pipelines is harness-project scope; plan it
with the harness cluster rather than squeezing it into a comment slice.

## Verify

The acceptance test should delete one required cross-directory adapter helper
from each copy set and make the focused closure check name it before either
sandbox runs. Then run:

```
bun run test:scripts:file -- scripts/lint-ratchet/output.test.ts
bash scripts/tests/test-lint-ratchet.sh
bun run test:scripts:subjects:check
```
