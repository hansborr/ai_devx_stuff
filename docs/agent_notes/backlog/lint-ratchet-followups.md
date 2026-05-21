# Lint Ratchet Follow-ups

Status: Historical PR 4 follow-up provenance
Last reviewed: 2026-05-20
Source: Review of `d4b11723` plus secondary reviewer feedback.

Organized leaves now live in `lint-followups/01-ratchet-cache-invalidation.md`
through `lint-followups/05-ratchet-cleanups.md`. Keep this file as source
provenance for the PR 4 review notes.

Use this note only as provenance for the original PR 4 review concerns. The
current promotion pointer lives in `docs/agent_notes/NEXT.md`; do not treat this
file as permission to keep pulling ratchet work after one leaf lands.

## Original Priority Before Next Ratchet

1. Fix ESLint cache invalidation for ratcheted local rules.
   - Problem: the ratchet cache key is based on ratchet config, not the local
     rule implementation. A changed `eslint-rules/*.js` file can reuse stale
     cached results for unchanged source files.
   - Preferred fix: include the ratcheted rule file content hash in the
     generated ESLint config/cache key. Disabling cache is acceptable only if
     runtime stays within hook budget.
   - Add a smoke or fixture test proving a local rule implementation change
     invalidates cached ratchet results.

2. Make `lint:ratchet:update` recover from stale registry metadata.
   - Problem: update mode currently parses the committed baseline with strict
     registry identity validation before it can rewrite stale `files`,
     `ignores`, `ruleOptions`, `configHash`, or newly added ratchets.
   - Split baseline handling into structural parse and registry validation so
     update can compare old counts and then rewrite current metadata.
   - Keep malformed JSON a hard error unless a future explicit
     `--force --reason` flow is added.
   - Add a test that changes/adds a registry entry and verifies `--update`
     rewrites the stale baseline safely.

3. Close harness parity gaps.
   - Add reverse parity in `harness:check`: every exported `lintRatchets` entry
     must have a matching `kind: "ratchet"` control in `harness.controls.json`.
   - Add `harness.controls.json` to pre-commit source-relevant path detection
     so manifest-only edits do not skip local gates.

4. Record ratchet runtime and hook budget impact.
   - Measure cold and warm `bun run lint:ratchet` runtime on a normal local
     checkout.
   - Record the numbers in the PR 4 durable note.
   - Before adding another ratchet to pre-commit, remeasure and decide whether
     to keep sequential ESLint runs, parallelize, combine ratchets into one
     invocation, or leave CI as the enforcement point.

## Smaller Cleanup

- Change failing regression output from `lint:ratchet OK` to a failure label
  before setting exit code 1.
- Add shell smoke coverage for usage/config exit code 2, including unknown
  arguments, `--allow-worse` outside update mode, and missing or blank
  `--reason`.
- Replace the nested optional-line ternary in `addFinding` with a small
  `minDefined` helper.
- Extract the 12-character cache hash prefix into a named constant.
- Consider sweeping stale `node_modules/.cache/eslint-ratchet/<id>-<hash>/`
  directories when cache keys change.
- Refactor `parseBaselineTest` so parsed field validation and construction do
  not duplicate the same narrowing conditions.
- Make `scripts/test-lint-ratchet.sh` mutate JSON structurally instead of
  relying on a layout-sensitive `perl` replacement.

## Docs And Process Hygiene

- Move or delete
  `docs/agent_notes/in_progress/lint-hardening-review-followup-pr-4-custom-ratchet-plan.md`
  once PR 4 is fully handed off; the durable summary already lives in
  `docs/agent_notes/finished_work/lint-hardening-review-followup-pr-4-custom-ratchet.md`.
- Refresh verify-wrapper descriptions in `harness.controls.json` and generated
  harness docs so they mention the ratchet step accurately.
- Keep the ratchet control paired to `docs/guides/lint-ratchet.md`; the
  underlying local rule keeps its own guide pointer for rule-specific repair
  guidance.
