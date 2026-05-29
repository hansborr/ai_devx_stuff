# Leaf 30: generate-harness-controls Lint Adoption

Status: Drafted 2026-05-20 - parked ratchet-first/drain leaf
Sources:

- `docs/agent_notes/backlog/lint-followups/19-scripts-eslint-remaining-families.md`
- `scripts/generate-harness-controls.ts`
- `scripts/test-generate-harness-controls.sh`

## Problem

`scripts/generate-harness-controls.ts` was probed as Leaf 19 slice 2 but not
added to ESLint coverage. The temporary lint run found two blockers:

- `resolveNonLintControl` complexity 13 vs the repo-wide `complexity` max 10.
- 384 effective lines vs the default `local/max-lines` max 300.

The script is important generator infrastructure, so leaving it outside lint
coverage keeps a known high-value file unguarded.

## Scope

Single-file adoption for `scripts/generate-harness-controls.ts`. Do not pull in
other harness, ratchet, or diagnostics scripts in this leaf.

## Ratchet-First Enforcement

Before cleanup or normal ESLint adoption, add ratchet coverage for the current
findings in this file. The first enforcement step should baseline the current
`complexity` and `local/max-lines` findings so the file cannot get worse while
the structural split is still pending.

If `lint:ratchet` cannot yet express core ESLint `complexity`, extend the
ratchet runner or split that infrastructure first. Do not postpone enforcement
until the file is clean.

## Candidate Work

- Re-run the exact lint probe against the current branch with the file
  re-included.
- Add scoped ratchet coverage for `scripts/generate-harness-controls.ts` with
  current finding counts committed in `lint-ratchet.baseline.json`.
- Reduce `resolveNonLintControl` below the complexity ceiling by extracting
  named helper predicates or a table-driven resolver.
- Split generator concerns if needed, for example manifest loading,
  non-lint-control derivation, markdown row rendering, and write/check CLI
  handling.
- Preserve output exactly unless the fixture intentionally changes.
- After the ratchet baseline reaches 0, add the file to the normal lint gate
  using the existing script pattern: global ignore exemption, scripts
  `parserOptions.project`, and `local/type-assertion-boundary` enforcement.

## Exit Criteria

- `scripts/generate-harness-controls.ts` is protected by ratchets for its
  current findings before structural cleanup starts.
- New or higher finding counts fail `bun run lint:ratchet`.
- Normal `bun run lint` adoption happens once the ratcheted findings are
  drained, or the leaf records why a follow-up drain remains.
- `scripts/fixtures/generate-harness-controls/expected.md` changes only if the
  generator output is deliberately updated and reviewed.
- Leaf 19 is updated with the adoption or a fresh deferral reason.

## Verification

- `bun run lint:ratchet`
- `bun run lint:ratchet:check-baseline`
- `bash scripts/test-lint-ratchet.sh` if core-rule/source support changes
- Temporary-violation probe if any new ratchet scope starts at 0 findings
- `bun run harness:check`
- `bun run docs:harness-controls:check`
- `bun run lint -- --max-warnings=0`
- `bash scripts/test-generate-harness-controls.sh`
- `bun run test:scripts:changed`
- `bun run verify:changed`
