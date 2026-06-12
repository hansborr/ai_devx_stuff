# 03l: Invert The scripts/** Coverage Model

Status: Done (2026-06-12, landed in "refactor(lint): invert scripts lint
coverage")
Order: 03l
Parent: `03-zero-baseline-promotion-and-scripts-inversion.md`.

## Context

After the earlier batches, every maintained script family is under normal lint and the
file-by-file re-include machinery is pure overhead. This batch flips the
model: lint `scripts/**` by default under `tsconfig.scripts.json` and ignore
only fixtures/generated paths.

Surfaces to delete or shrink (verify they are actually empty first):

- the `scripts/**/*` global ignore at `eslint-config/base-configs.js:45`,
  replaced by targeted fixture/generated ignores
  (`scripts/codemods/fixtures/**`, `scripts/drift-ai/fixtures/**`,
  `scripts/logs-audit/fixtures/**`, `scripts/fixtures/**`, anything new);
- `lintedScriptFiles`, `deriveLintedScriptReincludePatterns`,
  `lintedScriptReincludePatterns`, and the directory re-open machinery in
  `eslint-config/shared-policy.js`;
- whatever remains of `scriptDebtOverrideConfigs` in
  `eslint-config/script-configs.js` (each survivor needs a reason comment or
  becomes ratchet metadata per the watchlist's suppression-metadata entry);
- `createScriptProjectConfigs` simplifies to a directory-level
  `tsconfig.scripts.json` mapping; check `tsconfig.scripts.json` include
  list can become `scripts/**/*.ts` + excludes.

Mind non-TS and shell surfaces: the flip must not accidentally pull
`scripts/**/*.sh`, fixtures, or `scripts/vitest.config.ts` (config-file
policy re-includes it deliberately) into the wrong config family.

## Scope

1. Probe the long tail: run normal lint with the inverted model report-only
   and enumerate any file the earlier batches missed; fix or add targeted
   ignores with reasons.
2. Flip the ignore model; delete the re-include machinery.
3. Registry audit: delete every ratchet drained by the earlier batches that
   is somehow still present; for the keep-list (broad
   `ratchet/local-type-assertion-boundary` floor — re-evaluate now that all
   scripts are in normal lint with the rule at error —
   `ratchet/strict-boolean-expressions-shared`, the different-options vitest
   floors), record verdicts in `evaluation-verdicts.md`.
4. Re-audit the watchlist's ratchet-suppression metadata entry against what
   actually remains; update `watchlist.md`.
5. Update the lint coverage map and `docs/guides/lint-ratchet.md` lifecycle
   text to describe the inverted model.
6. `bun run lint:ratchet:update`; the registry should now be small enough
   that the watchlist's registry-builder entry is actionable — note that in
   `watchlist.md` too.

## Definition Of Done

`scripts/**` is linted by default with only reasoned ignores; the
re-include machinery is gone; every surviving ratchet has a current
disposition and a recorded verdict; docs describe the inverted model.

## Notes

- Removed the blanket `scripts/**/*` ignore and the file-by-file script
  re-include machinery. Maintained `scripts/**/*.ts` now resolves through
  `tsconfig.scripts.json`; script fixtures and `scripts/vitest.config.ts`
  stay out of the runtime-script project by explicit ignores.
- Narrowed `ratchet/local-type-assertion-boundary` to the same script
  fixture/config exclusions as normal lint and refreshed the zero baseline.
  The remaining six ratchets are intentional zero floors with verdicts
  recorded in `evaluation-verdicts.md`.
- Re-audited `scriptDebtOverrideConfigs`: remaining entries are deliberate
  normal-lint policy, not mirrored ratchet debt. Watchlist notes now reflect
  the six-ratchet registry state.
- Probe result: before the flip, a temporary `scripts/new-tool.ts` with
  `any`/missing-return-type violations passed `bun run lint`; after the flip,
  the same probe failed full lint without any config edits, then was reverted.

## Verification

Umbrella gate set, plus: `bun run lint:agent:local-rules` smoke on a
scripts file, `bun run test:scripts:changed`, and a probe that a brand-new
`scripts/new-tool.ts` with a lint violation fails `bun run lint` with no
config edits (then revert) — that probe is the whole point of the inversion.
