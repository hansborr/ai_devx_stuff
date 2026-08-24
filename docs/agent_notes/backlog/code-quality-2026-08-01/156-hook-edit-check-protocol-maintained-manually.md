# 156. Generate the hook edit-check field contract from one schema instead of hand-synchronizing TypeScript and shell

Status: Landed on fix/cq-160
Theme: Generated wire contracts · Area: harness · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The lint-ratchet edit-time hooks exchange four kinds of positional, tab-separated rows across TypeScript producers, TypeScript parsing, shell consumers, and shell-test fakes. Their layouts are documented and repeated by hand rather than represented by one machine-readable contract.

A contributor changing a field must therefore find every positional shell read and every canned emitter. Missing one does not necessarily fail loudly: target decoding and the advisory hooks intentionally degrade quietly, so protocol drift can disable or weaken an edit-time check instead of identifying the incompatible consumer. The same hook bodies are then projected into the Claude, Codex, and Copilot adapters, making this a poor contract for outside adopters to copy.

## Evidence

- `tools/lint-ratchet/src/governance/edit-check-protocol.ts:3-19` documents the three-row exchange, says that only `target` is parsed, and explicitly tells maintainers to keep column order and counts synchronized with shell `read -r` lists.
- `tools/lint-ratchet/src/governance/edit-check-protocol.ts:21-26` defines three kind constants but only one arity constant, `TARGET_FIELD_COUNT = 5`.
- `tools/lint-ratchet/src/governance/edit-check-protocol.ts:60-113` formats `target`, `checked`, and fixed-nine-field `regression` rows, while `parseEditCheckTargetLine` is the only decoder.
- `tools/lint-ratchet/src/governance/ratchet-coverage.ts:15-22` independently owns the fourth layout, `ratchet-covered<TAB>path<TAB>rules`.
- `scripts/ai-hooks/ratchet-regression-check.sh:111-124`, `:216-223`, and `:232-239` repeat target-row positions in three shell reads. Its result parser at `:277-287` repeats the regression layout with special handling for empty fields and backward compatibility.
- `scripts/ai-hooks/lint-coverage-check.sh:35-55` documents and manually reads the three-field `ratchet-covered` layout.
- `scripts/ai-hooks/test-ratchet-regression.sh:69-113` and `scripts/ai-hooks/test-lint-coverage.sh:140-156` use fake `bun` programs that emit their own literal copies of the row formats.
- The real-emitter fixture asserts selected row prefixes and one five-field target count at `scripts/tests/lib/test-lint-ratchet-edit-check-fixtures.sh:67-79`, `:88-109`, and `:150-155`; it does not validate every emitted row kind against a shared shell contract.
- `harness.controls.json:2518-2571` projects the two source hooks into Claude, Codex, and Copilot hook bodies, so one source-side parsing defect reaches all three adapters.

## Proposed direction

1. Define one declarative row-layout table in `tools/lint-ratchet/src/governance/edit-check-protocol.ts`. For each of `target`, `checked`, `regression`, and `ratchet-covered`, record the ordered field names, fixed arity, and any accepted optional trailing fields. Move ownership of the coverage-row layout out of `ratchet-coverage.ts` and derive all existing formatters from this table without changing emitted bytes.

2. Add TypeScript decoders for `checked`, `regression`, and `ratchet-covered` beside `parseEditCheckTargetLine`. Add formatter-to-parser round-trip coverage for every kind while preserving target rows’ undecodable-row soft skip.

3. Add a generator for `scripts/ai-hooks/edit-check-protocol.generated.sh`. Generate per-kind field lists and arity constants, or narrowly scoped read helpers, from the TypeScript layout table. Add refresh/check package-script aliases and use the check alias in a new `generatedSurface` facet in `harness.controls.json`; these edit-check-protocol aliases and the generated file do not exist yet. Include the schema, generator, and output in the facet, then regenerate verify metadata with the existing `bun run verify:steps` command.

4. Source the generated shell contract from `ratchet-regression-check.sh` and `lint-coverage-check.sh`, replacing their hand-repeated field lists. Retarget the fake emitters in `test-ratchet-regression.sh` and `test-lint-coverage.sh` to the same generated constants or helpers. Rewrite comments that currently instruct contributors to synchronize column order by hand so they point to the generated contract.

5. Extend `scripts/tests/lib/test-lint-ratchet-edit-check-fixtures.sh` with real-emitter parity assertions for `--edit-check-targets`, `--edit-check`, and `--edit-ratchet-coverage`. Each emitted line must satisfy the generated kind and field-count contract, so a TypeScript layout edit cannot remain green against stale shell consumers.

## Scope / caveats

- Keep the existing tab-separated, line-oriented wire format. Introducing version fields or a self-describing replacement protocol is out of scope.
- Preserve the documented invariants in `edit-check-protocol.ts`: undecodable target rows soft-skip; `containsProtocolSeparator` warns loudly; `repairCommand` separators are sanitized; and regression rows emit fixed arity.
- Generated shell helpers must preserve the `\x1f` substitution at `ratchet-regression-check.sh:277-287`. A naive tab-IFS read collapses an empty regression `line` field.
- Preserve acceptance of the older eight-column regression form, the optional ninth repair column, and the trailing sink that prevents a future tenth column from being absorbed into `repair`.
- Do not change hook throttling, cache identity, target caps, tier selection, advisory prose, or the lint-ratchet CLI mode surface beyond routing existing modes through derived formatters.
- Register the generated file and all generator dependencies in the harness closure. A stale or unsourced fragment on this degrade-quietly path can otherwise disable the advisory without a hard failure.
- Coordinate edits to `scripts/lint-ratchet/modes.ts` with [124-ratchet-cli-has-no-authoritative-command.md](./124-ratchet-cli-has-no-authoritative-command.md). This is a merge-conflict edge only; either leaf may land first.
- Focused verification surfaces already exist: `bun run test -- tools/lint-ratchet/src/governance/edit-check-protocol.test.ts`, `bash scripts/ai-hooks/test-ratchet-regression.sh`, `bash scripts/ai-hooks/test-lint-coverage.sh`, `bash scripts/tests/test-lint-ratchet.sh`, `bun run verify:steps`, and `bun run harness:check`.
