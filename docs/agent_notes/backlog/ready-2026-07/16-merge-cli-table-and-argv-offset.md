# Merge-CLI wrappers as data + one argv-offset constant (runCliMain kernel rejected)

Status: Ready — after B1 lands (lint-arch leaf 14 subpath-export curation).
Date: 2026-07-19
Source: 2026-07-19 harness architecture review, candidate 6 (session
artifact; claims verified against HEAD 544a9d06 the same day); design
calls consulted with Fable 5 + Codex 2026-07-19 — both ruled
trimmed-with-trigger, rulings folded in below.
Size: S.

## Evidence

Three ~30-line near-identical merge-CLI wrapper files:
`scripts/sensor-near-duplicates-merge-cli.ts` (32 L),
`scripts/max-lines-exceptions-merge-cli.ts` (28 L),
`scripts/sensor-knip-unused-exports-merge-cli.ts` (27 L).

The entry-guard argv-offset constant is respelled at least 4 ways
(`PROCESS_ARGV_USER_ARGS_START`, `PROCESS_ARG_OFFSET`,
`nodeArgvUserArgumentOffset`, …) across ~33 CLI files, defeating symbol
search for what is one concept.

Codex flagged a possible 4th merge CLI plus path-based callers;
spot-verify 2026-07-19 confirms `scripts/lint-ratchet/baseline-merge-cli.ts`
exists alongside the three above. **Inventory ALL merge CLIs and every
path-based caller (shell registry, tests, docs) before deleting any
entry file**, and preserve CLI paths/named exports as compatibility
shims unless the callers are deliberately migrated in the same change.

## In scope

- Collapse the merge-CLI wrappers to one data table + one wrapper.
- Unify the argv-offset constant into one shared export in
  `scripts/lib/` and migrate the files touched by this work — NOT a
  33-file normalization sweep. New CLIs should use the shared helper
  this work naturally produces; the rest converge opportunistically.

## Rejected scope (recorded so future reviews don't re-propose it)

Following the leaf-14/B1 pattern of recording rejected shapes: the
general `runCliMain` entry kernel across all ~33 CLI files is
**rejected**. Reasons:

- Churn-to-payoff: 33-file churn for a shallow idiom.
- Full-scan/registration hazard across every scripts entry file.
- The same objection lint-arch leaf 13 sustained against a package CLI
  driver (lint-arch-review-2026-07/13-package-cli-driver.md); CLI
  composition stays in `scripts/` per leaf 02 dispatch ruling 2
  (lint-arch-review-2026-07/02-package-seam-replaces-copy-manifest.md
  :129-135, four-model unanimous 2026-07-17).

**Re-open trigger**: an actual entry-guard defect, or ~3 new
post-ruling CLIs hand-rolling the same nontrivial async/error/exit
mapping after the shared helper exists. Plain `import.meta.main` +
`slice(2)` is insufficient evidence.

## Sequencing

After ready-row B1 (lint-arch leaf 14 subpath-export curation) so this
work does not freeze or conflict with the import curation. Note also
that `lint-ratchet/baseline-merge-cli.ts` sits in the lint-ratchet S3
engine-kernel neighborhood (held for review at 68a3f000) — check S3
disposition before folding it into the table.
