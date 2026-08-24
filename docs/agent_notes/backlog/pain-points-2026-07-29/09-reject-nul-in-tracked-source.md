# Reject NUL Bytes in Staged Source

Status: Implemented
Date: 2026-07-29
Priority: P2
Size: S
Source: `lint-ratchet-and-source-policy.md` — “Source-policy edge cases”

## Problem

A literal NUL byte in TypeScript is valid enough to reach Git but makes Git
treat the file as binary, hiding ordinary diff, numstat, and grep evidence.
The live suppression identity implementation documents that exact failure mode
at `scripts/suppression-ledger-identity.ts:128-135` and deliberately uses the
escaped `\u0000` spelling instead. The archived incident records that a literal
NUL reached `scripts/worktree-seed-import-closure.ts` while Bun, Vitest, ESLint,
and Prettier all stayed green
(`/home/node/persist/musi/pain_points/archive/2026-07-21-through-2026-07-29.log:448-456`).

Before this leaf, the edit hook did not prevent the mistake. Its binary
classifier treated a NUL-bearing file as binary
(`scripts/ai-hooks/tidy-edited-file.sh:132-140`) and
the hook then selects the neutral `binary file` skip reason at
`scripts/ai-hooks/tidy-edited-file.sh:204-214` and emits it as an ordinary skip
at `scripts/ai-hooks/tidy-edited-file.sh:298-307`. That was the incident's only
live signal. No commit gate rejects the staged source blob.

This is a narrow commit-artifact invariant, not a new maintained-text taxonomy
or general encoding validator. The existing source policy already computes
staged ACMRD paths intersected with `source-relevant` at
`scripts/lib/verify-metadata.sh:568-584`. The panel verified that every tracked
file under those prefix selectors is text and none contains NUL, so the
prefixes need no exclusion today. Reusing them also fails closed: a future
unknown suffix under `packages/`, `scripts/`, `e2e/`, `tools/`,
`eslint-config/`, `eslint-rules/`, or `.husky/` remains selected automatically.

## Scope

- In `scripts/lib/verify-metadata.sh`, factor/reuse the staged-path pipeline at
  `:568-584`: enumerate staged ACMR paths, filter the NUL-delimited stream
  through the full `source-relevant` query, and inspect every selected
  `:<path>` index blob as raw bytes regardless of suffix. A
  selected blob containing a literal NUL fails with the path and remediation to
  spell program values as an escape such as `\u0000`. A selection or blob-read
  error also fails; staged deletions remain outside blob reads.
- Invoke that guard directly from `.husky/pre-commit` immediately after the
  source-relevant unstaged/untracked rejection at `.husky/pre-commit:275-278`
  and before the staged-source/no-source branch at `:280-297`. The gate engine,
  including marker reuse and the `verify:changed` bridge, is not entered until
  `.husky/pre-commit:461`, so this ordering makes both shortcut paths pass
  through the guard.
- Add focused raw-blob and hook-order coverage to the existing shell suites.
  Cover NUL at offset zero and after multibyte UTF-8, the source text
  `\\u0000`, ordinary UTF-8, a staged blob that differs from its worktree file,
  staged add/modify/rename/delete, an unknown suffix under a source-relevant
  prefix, selector/blob-read failure, no-source skip, a fresh pre-commit marker,
  and the `verify:changed` marker bridge.
- In `scripts/ai-hooks/tidy-edited-file.sh`, keep skipping genuinely binary
  files, but emit a conspicuous `WARNING:` for every binary skip that a literal
  NUL may be hiding source text and name the path. ESLint extension support is
  a formatter capability, not a source-policy classifier. Pin TypeScript,
  Prisma, and generic binary paths in `scripts/ai-hooks/test-tidy.sh`.
- Do not add `maintainedText`/`maintained-text`, change path policy, add a shared
  raw-Buffer Git primitive, create a standalone `scripts/source-policy.ts` CLI,
  add full-repository mode, add package scripts, or wire a lint lane. Register
  the blocking invariant in the harness control manifest.

## Implementation outcome

- The blob scan uses the full `source-relevant` policy, including `bun.lock`;
  the narrower `source-relevant:precommit-staged` query remains limited to
  deciding whether behavioral source verification can be skipped.
- Path policy has three source-relevance variants, not two. Plain
  `source-relevant` drives this guard and unstaged/untracked rejection;
  `source-relevant:precommit-staged` removes `bun.lock` for behavioral source
  selection; `source-relevant:precommit-tracked` adds tracked `.claude/`,
  `.codex/`, and `.copilot/` paths only to the pre-commit fingerprint. Those
  tracked extras invalidate cached evidence but do not feed verification, so a
  path such as `.claude/skills/local/SKILL.md` deliberately remains outside the
  staged NUL guard unless it also matches a plain selector.
- `git cat-file` streams each staged blob into the NUL detector. No staged blob
  is materialized in a temporary file. The guard reports every NUL-bearing
  path in one run and distinguishes a staged non-blob such as a gitlink from an
  unreadable blob.
- The manifest registers `check/staged-source-nul` and the generated control
  reference documents it.
- Every edit-time binary skip warns, including non-ESLint source such as
  `.prisma`; `ai_tidy_eslint_supported` remains responsible only for deciding
  whether the formatter path runs ESLint.
- The registration-preflight wiring check semantically pins the NUL guard
  between unstaged-work rejection and staged-source selection, which keeps it
  ahead of gate dispatch and marker reuse without cloning hook source text.
- Concurrent external writes to the Git index after the scan remain an inherent
  pre-commit snapshot race. Repeating the scan would only move the same race
  window, so this leaf does not add index locking or repeated scans.

## Acceptance

- A staged literal NUL in any `source-relevant` ACMR blob blocks pre-commit and
  names every offending path; the extension cannot make a selected path
  disappear.
- The escaped source spelling `\u0000` and ordinary UTF-8 pass.
- The guard reads the index, not an unstaged worktree replacement.
- A staged deletion is ignored, while a staged add/modify/rename is read from
  the index.
- A source-relevant staged gitlink fails closed with a non-blob diagnostic.
- A source-relevant NUL is rejected even when a valid pre-commit marker or
  `verify:changed` bridge would otherwise skip behavioral slots.
- Every binary-classified edit produces the loud warning, including a
  non-ESLint source path such as `schema.prisma`.
- The focused verify-metadata/pre-commit fixtures,
  `bash scripts/ai-hooks/test-tidy.sh`,
  `bash scripts/tests/test-ai-hooks.sh`, and
  `bash scripts/tests/test-dependency-freshness.sh` pass.

## Resolved decisions

- Reject NUL only. It is the reproduced byte that makes Git hide text evidence;
  there is no live defect or repository convention supporting a broader C0
  ban, so broadening would add a new policy rather than close this incident.
- Reuse `source-relevant` without suffix exclusions. The proposed
  `maintainedText` allowlist failed open on every future extension, whereas the
  existing prefix selector covers an unknown suffix by default. Docs/root paths
  outside `source-relevant` remain deliberately outside this incident-sized
  control.
- Put the guard in the pre-commit body, after unstaged-work rejection and before
  source skip/marker/bridge evaluation. NUL is a commit-artifact invariant, and
  this exact ordering defeats the panel's `verify:changed` bridge concern
  without creating a permanent lint family.
- Keep the registered check commit-only rather than adding a verify slot.
  `bun run verify` evaluates the working tree, while this invariant is defined
  over staged index blobs; wiring the staged scan into full verification would
  still miss committed NULs and would give the slot misleading semantics.
  Therefore full verify is not a superset of this commit gate invariant, and
  `git rebase --continue`, imported merge commits, and commits made with hooks
  bypassed remain explicit boundaries. A second incident through one of those
  paths would justify a separate full-tree scanner.
- Add the tidy warning because it upgrades the incident's only live signal
  without pretending the edit hook can safely format a NUL-bearing source file.
- Read only staged index blobs. That is the artifact the guarded commit records;
  an always-on full repository scan is disproportionate to the single incident.
- Keep one streaming `git cat-file` pipeline per selected path. Batch mode
  returns size-framed binary records; Bash variables cannot preserve NUL bytes,
  so parsing `--batch` correctly would require a second byte-level helper and
  make this small guard materially harder to audit. If commit-scale process
  counts become measurable, replace the whole reader with one focused binary
  parser rather than partially decoding the batch protocol in shell.

## Open questions

None.
