# Fixture copy-set vs import-graph guard

Status: Ready — scope narrowed 2026-07-19. The exact requested mechanism
landed for one copy set: `scripts/harness/fixture-closure-check.ts`
(`checkFixtureCopyClosure`, wired into `harness-check.ts`) validates
`generatedSurface.fixturePaths` against the static import closure for the
`test-harness-check.sh` fixture manifest (`511fb458`, 2026-07-18). Remaining
work: extend that pattern (or generalize the checker) to the other
hand-written fixture copy sets under `scripts/tests/` — e.g.
`test-dependency-freshness.sh` (~55 cp lines), `test-lint-changed.sh` (~24),
`test-lint-dist-preflight.sh`, `test-test-slow.sh`, `test-doctor-json.sh`.
Was repo-level M-L; now S-M per gate since the machinery exists.
Date: 2026-07-07 (re-verified 2026-07-19)
Source: agent-cli consolidation burn-in incident (drift-triage fix workflow,
2026-07-07); routed out of the agent-cli pack — not a wrapper defect.

## Context

A new leaf module (`scripts/harness/harness-paths.ts`) broke sandboxing test
fixtures in three separate copy sets, each surfacing only at the next-deeper
gate (changed smokes → full scripts slot → full test slot). The tail cost
three fix rounds across dispatched lanes because nothing enumerates which
fixture copy sets must mirror a new module.

## Scope

- A repo-level guard that compares each sandboxing fixture copy set against
  the import graph of the entry points it sandboxes, so adding a leaf module
  fails one fast check that lists every copy set needing the file — instead of
  failing gate-by-gate.
- Until the guard exists: dispatch missions that add leaf modules under
  `scripts/` should require a fixture-copy-set sweep up front (prompt-side
  mitigation; noted in the agent-cli pack index).

## Follow-up: TS entry files copied into shell fixtures (2026-07-19 review)

`scripts/path-policy/fixture-shell-dependencies.ts` only follows shell
`source` edges; a TS/JS entry script copied into a fixture gets no
import-closure check. This exact class produced three incidents on
2026-07-19 alone (latest: `test-generate-harness-controls.sh` missing
`harness-manifest-schema.ts` after the typed-parser split — the smoke failed
silently because the fixture's bun stderr is redirected into the cleaned-up
temp dir). Design sketch:

- In `parseFixtureCopyCommand`, keep walkable TS/JS copies (today
  `isShellPath` drops them) and closure-walk each copied entry with
  `validateSeedImportClosure` (`scripts/worktree-seed-import-closure.ts`,
  already reused by `scripts/harness/fixture-closure-check.ts`), requiring
  every closure file to be in the group's copy set.
- Two satisfaction channels beyond plain copies must be modelled or the
  harness-controls fixture false-fails: heredoc-synthesized stubs
  (`cat >"$fixture_dir/scripts/..." <<'TS'` — treat heredoc-target paths
  under the fixture root as satisfied) and node_modules symlinks
  (`ln -s "$PWD/..." "$fixture_dir/node_modules/<pkg>"` — feed the linked
  package names into the walker's `externalPackages`).
- Scope guard: entry-file closures only (no tsconfig path aliases in
  scripts/), same smoke-file scan population as the shell check.

Deliberately not squeezed into the 2026-07-19 review pass: the two extra
channels plus tests put it well past a ~150-line proportionate fix.

## Verification

- A fixture proving that a module missing from a copy set fails the guard
  with a diagnostic naming the copy set and the missing file.
- `bun run test:scripts:changed` green after wiring.
