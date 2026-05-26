# Path Policy: Source Relevance And Script Smokes

Status: Done
Order: 18

## Context

Pre-commit source relevance and script-smoke selection also duplicate path
policy, but they have different behavior from lint and format callers. Migrate
them only after the shared data, shell interface, and first caller migrations are
stable.

## Prerequisite

Complete `14-path-policy-data-model.md`, `15-path-policy-shell-interface.md`,
and at least one caller migration leaf.

## Scope

- Migrate pre-commit source relevance and `test:scripts:changed` subject-path
  selection to shared policy data where appropriate.
- Preserve staged and deleted-file behavior.
- Add selection regressions for maintained tooling surfaces and full-scan
  triggers.

## Definition Of Done

Adding a maintained script/helper/config surface requires one shared policy
data edit plus targeted caller behavior only when semantics actually differ.

## Verification

- `bash scripts/test-test-scripts.sh`
- Relevant pre-commit/source-relevance tests
- `shellcheck` for changed shell scripts
- `bun run test:scripts:changed`
- `bun run verify:changed`
