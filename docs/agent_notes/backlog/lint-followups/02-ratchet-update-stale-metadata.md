# Leaf 2: Ratchet Update With Stale Metadata

Status: Resolved (2026-05-19, commit `e0d2ff69`, follow-up `1c4fa69d` for Leaf 26)
Source: `docs/agent_notes/backlog/lint-ratchet-followups.md`

## Resolution (2026-05-19)

Implemented in `e0d2ff69 feat(lint): split ratchet baseline parse modes`.

- `parseLintRatchetBaselineStructure` in
  `scripts/lint-ratchet-baseline.ts:710` is the structural-only parse path.
  It validates JSON shape but treats `ruleSourceHash` as optional (see the
  comment at line 619) so update mode can rewrite a pre-Leaf-01 baseline.
- `parseLintRatchetBaseline` layers `validateBaselineAgainstRegistry` on top
  for check/enforce modes; malformed JSON remains a hard error.
- `decideLintRatchetUpdate` at line 835 preserves the count-regression
  safety contract: update may rewrite metadata, but worse counts still
  require `--allow-worse --reason "<why>"`.
- Leaf 26 follow-up (`1c4fa69d`) added orphan-id detection so a rename or
  removal cannot silently bypass count protection — see
  `26-ratchet-rename-count-protection.md`.
- Vitest coverage includes
  `scripts/lint-ratchet-baseline.test.ts` "structural parse accepts a
  baseline missing ruleSourceHash so update can fill it in" (line 507) and
  the broader `decideLintRatchetUpdate` describe blocks.
- Smoke coverage in `scripts/test-lint-ratchet.sh` exercises the
  stale-metadata recovery path alongside the rename refusal/acceptance
  paths from Leaf 26.

See also: [[01-ratchet-cache-invalidation]], [[26-ratchet-rename-count-protection]].

## Problem

`lint:ratchet:update` currently parses the committed baseline with strict
registry identity validation before it can rewrite stale metadata. A change to
`files`, `ignores`, `ruleOptions`, `configHash`, or a newly added ratchet can
make update mode fail before it has a chance to regenerate the baseline.

## Scope

Split baseline handling into:

- structural parse of the committed JSON, and
- registry identity validation for check/enforcement modes.

Update mode should be able to compare old counts and rewrite current metadata
when the JSON is well-formed but registry metadata is stale.

## Candidate Work

- Add a structural parse path that validates the baseline shape without
  requiring current registry identity.
- Keep malformed JSON a hard error.
- Preserve the existing safety rule: update may write equal or lower counts by
  default; worse baselines still require
  `--allow-worse --reason "<why>"`.
- Add tests that mutate or add a registry entry and prove update rewrites the
  stale baseline safely.

## Exit Criteria

- `lint:ratchet:update` can refresh stale registry metadata without weakening
  count-regression safety.
- `lint:ratchet:check-baseline` still fails on stale metadata.
- Malformed baseline JSON remains a hard failure.

## Verification

- `bun run lint:ratchet:update -- --check` if such a mode exists after the
  implementation, otherwise targeted helper tests.
- `bun run lint:ratchet:check-baseline`
- `bash scripts/test-lint-ratchet.sh`
- `bun run test:scripts:changed`
- `git diff --check`
