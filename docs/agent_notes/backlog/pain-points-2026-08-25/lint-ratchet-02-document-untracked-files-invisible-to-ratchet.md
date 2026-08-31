# Document That Untracked Files Are Invisible to Lint-Ratchet Update

Status: Implemented — guide paragraph added after the `--allow-worse` example
block; the optional `cli-catalog.ts` scope-message line was skipped because
that message fires on flag misuse (`--allow-worse` without `--update`), not on
the silent no-op this leaf documents.
Date: 2026-08-25
Priority: P3
Size: S
Source: `lint-ratchet-and-source-policy.md` — "Baselines depend on
installation and staging state"

## Problem

`lint:ratchet:update -- --allow-worse` silently no-ops on a finding that lives
only in a brand-new, not-yet-`git add`-ed file. The later commit gate then
reports that finding as unaccepted new debt, and the failure looks like the
flag was ignored rather than a scoping rule.

Every lint-ratchet entry point that decides which files to scan — collection
(`tools/lint-ratchet/src/kernel/current-collector.ts:196`), propose
(`tools/lint-ratchet/src/governance/propose.ts:450`), retirement
(`tools/lint-ratchet/src/governance/retire-update.ts:65`), and zero-baseline
audit (`tools/lint-ratchet/src/governance/zero-baseline.ts:334`) — falls back
to `trackedFilesFromGit` (`tools/lint-ratchet/src/kernel/git-tracked-files.ts:16`),
which runs `git ls-files -z` with no `--others`/`--exclude-standard`. That
command lists only files Git already tracks (staged or committed), so an
untracked new file is outside the ratchet's file universe entirely: `--update`
(with or without `--allow-worse`) cannot record a floor for a finding it never
scans. `docs/guides/lint-ratchet.md` does not mention this anywhere in its
`--allow-worse` documentation (lines 190-260) or the "Adding a ratchet"
section — an operator who hits this has no guidance pointing at `git add`
first.

This is confirmed live, not just historical: the same `git ls-files -z`-only
scoping is unconditional across all four call sites above at HEAD, and no
`trackedFiles` override or working-tree scan exists in production code (only
as a test-injection seam).

## Scope

- In `docs/guides/lint-ratchet.md`, add a short paragraph immediately after the
  `--allow-worse` example block (after line ~228, before the `--reason`
  durable-recording paragraph) stating: a new file's findings are invisible to
  `lint:ratchet:update` until the file is at least staged (`git add`), because
  the update's file scope is `git ls-files` (tracked files only); `--allow-worse`
  cannot accept a finding it never saw. If a fresh `--allow-worse --reason`
  update stops looking like it worked once the new file is staged or
  committed, stage the file first and rerun the update.
- Documentation only. Do not change `trackedFilesFromGit` or add an
  `--others`/`--exclude-standard` mode, do not add a new CLI flag, and do not
  change any of the four call sites' file-scoping behavior — widening the
  ratchet's file universe to include untracked/ignored-adjacent paths is a
  deliberate-default engine change with its own tradeoffs (gitignore
  interaction, determinism across machines, portability to the copied
  `@musi/lint-ratchet` package) that belongs to a separate owner decision, not
  this doc fix.
- Optionally add one line to the `--allow-worse` scope message in
  `scripts/lint-ratchet/cli-catalog.ts:81-85` if it can be done without
  changing the flag's validation behavior; this is a nice-to-have, not
  required for acceptance.

## Verification

- No automated test is meaningful for a prose addition; this leaf is graded on
  review of the added paragraph's accuracy against the citations above.
- If the optional CLI message line is added, `bun run test -- scripts/lint-ratchet/cli-catalog.test.ts`
  (or the nearest existing CLI-catalog test file) must still pass with the
  updated string.
