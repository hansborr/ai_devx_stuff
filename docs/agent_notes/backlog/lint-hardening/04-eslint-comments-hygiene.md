# Leaf 4: ESLint Comments Hygiene

Status: Landed 2026-05-16
Depends on: independent; overlaps with Leaf 16 (suppression register) but does
not require it.

Promotion note: this leaf can be evaluated before Leaf 1, but full-repo
`bun run lint -- --max-warnings=0` will still see the existing warning
baseline until Leaf 1 lands. Before Leaf 1, use that command as a probe and
verify the eslint-comments slice with targeted lint output plus the existing
ESLint-disable register script.

## Problem

`scripts/eslint-disable-register.sh` enforces that no broad
`eslint-disable` comments land outside a small allowlist, and
`drift:ai --check suppressions` reports newly added suppressions. There is
still no ESLint-side hygiene for the *content* of disable comments
themselves:

- Disable comments without a rule id (broad disables) — partly covered, but
  not at the lint layer.
- Disable comments without a reason after `--`.
- `eslint-disable` block comments that disable a wider scope than the line
  needs.
- `eslint-disable-next-line` followed by code that no longer triggers any
  rule (stale disables — already partly covered by ESLint's
  `reportUnusedDisableDirectives` setting if turned on).

## Rule Goals

Adopt `@eslint-community/eslint-plugin-eslint-comments` with:

- `eslint-comments/require-description: "error"` — disable comments must
  have a description after `--`.
- `eslint-comments/no-aggregating-enable: "error"`.
- `eslint-comments/no-duplicate-disable: "error"`.
- `eslint-comments/no-unlimited-disable: "error"`.
- `eslint-comments/no-unused-disable: "error"`.
- `eslint-comments/no-use: ["error", { allow: [...]} ]` — left off; we
  intentionally allow per-line disables.

Also enable ESLint's built-in
`linterOptions.reportUnusedDisableDirectives: "error"` so stale disables
fail the gate.

## Possible Outcomes

- **Adopt subset (expected default).** The named rules above are tightly
  scoped to suppression hygiene and have no plausible noise. Most likely
  outcome is adopting all of them.
- **Reject.** Unlikely. Park with a reason only if the plugin's diagnostics
  conflict with `scripts/eslint-disable-register.sh` in ways that cannot be
  resolved by deduplicating coverage. Record that reason in
  `evaluation-verdicts.md`.

## Rollout

1. Install `@eslint-community/eslint-plugin-eslint-comments`.
2. Add the rule set at `error` in a throwaway config. Run inventory.
3. Add missing `-- reason: …` text to existing disables. The expected
   change set is modest because `eslint-disable-register` already requires
   reasoned broad disables.
4. Land the cleanup, then enable in `eslint.config.js`.
5. Turn on `reportUnusedDisableDirectives` last; this requires every
   remaining disable to actually suppress an active diagnostic.

## Adaptation Policy

Every disable directive now requires a one-line reason. Agents and
contributors should treat the reason as a small README for the suppression.

## Verification

- `bun run lint -- --max-warnings=0` after Leaf 1 lands, or as an inventory
  probe before then.
- `bash scripts/eslint-disable-register.sh` (existing register) still
  passes.
- `bun run drift:ai --scope current`
- If the plugin is rejected, deferred, subset-adopted, or fully adopted with
  caveats/scoped exceptions, append a row to `evaluation-verdicts.md` before
  closing the leaf.

## Implementation Result

Landed with the full intended rule set plus
`linterOptions.reportUnusedDisableDirectives: "error"`. Inventory found eight
`eslint-comments/require-description` errors, all on existing `eslint-enable`
comments that lacked descriptions. No `no-aggregating-enable`,
`no-duplicate-disable`, `no-unlimited-disable`, or stale-disable findings were
present in the repo baseline.

`eslint-comments/no-unused-disable` stayed enabled. A stdin stale-disable probe
against the final config produced one built-in unused-disable diagnostic and no
plugin duplicate, so the overlap does not double-report.

## References

- [eslint-plugin-eslint-comments](https://github.com/eslint-community/eslint-plugin-eslint-comments)
