# 20 — lint-ratchet module naming/fragmentation consolidation

Status: Done
Track: T (tooling) · Priority: P3 · Size: M

## Evidence (verified 2026-07-11; corrected in 2026-07-11 adversarial triage; re-verify before implementing)

- `scripts/lint-ratchet/` holds 112 `.ts` files (plus `portable-manifest.json`)
  with two naming families: 30 files carry a `lint-ratchet-` prefix that is
  redundant inside a `lint-ratchet/` directory (`lint-ratchet-baseline.ts`,
  `lint-ratchet-baseline-compare.ts`, `lint-ratchet-metrics-*.ts`,
  `lint-ratchet-check-registry.ts`, ...) alongside the unprefixed majority
  (`baseline-merge.ts`, `baseline-update.ts`, `baseline-hash.ts`, ...).
- Micro-modules exist: `errors.ts` is 49 bytes (one error class);
  `lint-ratchet-metrics.ts` is a 543-byte pure barrel over the five
  `lint-ratchet-metrics-*.ts` files. But the local `max-lines` rule caps files
  at 300 effective lines (`eslint-rules/max-lines.js`), so some fragmentation
  is ratchet-driven, not accidental — consolidation headroom is limited.
- Correction to the original leaf: `portable-manifest.json` glob-expands
  `scripts/lint-ratchet/*.ts` via `expandDirectories` (excluding `*.test.ts`,
  `*.test-helper.ts`, and `lint-ratchet-config.ts`), so ordinary renames need
  NO manifest edit. What renames do require is re-copying the renamed files
  into `examples/lint-ratchet-demo/` — `scripts/check-lint-ratchet-demo-sync.ts`
  is a byte-parity checker only; there is no writer script.
- Couplings the original leaf missed (all confirmed at HEAD):
  - `lint-ratchet-config.ts` is name-load-bearing: manifest exclude entry,
    `DEMO_AUTHORED_REGISTRY` constant in
    `scripts/check-lint-ratchet-demo-sync.ts:18`, many `"source"` entries in
    `harness.controls.json`, and an entry in
    `eslint-config/max-lines-exceptions.baseline.json`. Keep its name out of
    scope.
  - `eslint-config/script-configs.js` names
    `scripts/lint-ratchet/lint-ratchet-output.ts` by path.
  - `lint-ratchet.baseline.json` keys two debt entries on
    `scripts/lint-ratchet/lint-ratchet-baseline.test.ts`; renaming it surfaces
    as a removed-path improvement plus new-path regression — carry the
    baseline update in the same commit via the normal update flow.
  - 10+ files outside the directory import `lint-ratchet/lint-ratchet-*`
    modules (`scripts/lint-ratchet.ts`, `scripts/harness-check.ts`,
    `scripts/lint-probe-rule.ts`, `scripts/harness/*`, ...); use
    `bun run code:intel -- dependents` to enumerate before renaming.

## Do

Rename the 30 `lint-ratchet-*`-prefixed modules to drop the redundant prefix
(keep `lint-ratchet-config.ts` as-is — its name is wired into the manifest
exclude, the demo-sync guard, and `harness.controls.json`). Update importers
inside and outside the directory, the `script-configs.js` path reference, and
the two baseline entries keyed on the renamed test file. Re-copy renamed
files into `examples/lint-ratchet-demo/` (delete the old-named copies).
Consolidate micro-modules only where trivially safe — e.g. fold the 49-byte
`errors.ts` into its natural home and inline the `lint-ratchet-metrics.ts`
barrel if importer count stays sane — respecting the 300-line `max-lines`
cap; do not chase a file-count target. Mechanical, no behavior change; land
as its own commit(s).

## Verify

```
bun run test:scripts:file -- scripts/check-lint-ratchet-demo-sync.test.ts
bun run lint:ratchet
bun run harness:check
bun run verify:changed
```

## Acceptance

One naming family inside `scripts/lint-ratchet/` (sole allowed exception:
`lint-ratchet-config.ts`); demo byte-parity, `harness:check`, and all ratchet
modes still green; baseline paths updated with no debt-count change beyond
the mechanical path moves.
