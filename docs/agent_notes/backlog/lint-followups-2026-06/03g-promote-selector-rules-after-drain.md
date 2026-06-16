# Promote Selector Rules To Unconditional Error And Retire The Ratchets

Status: Done (2026-06-12, landed in "feat(lint): retire drained e2e
selector ratchets per zero-baseline lifecycle")
Order: 03g
Source: zero-baseline lifecycle (see `docs/guides/lint-ratchet.md`);
terminal step planned by lint-review-2026-06 leaf 04.

## Context

Once 03a-03f drain every file, the three selector ratchets
(`ratchet/local-e2e-prefer-role-selectors`,
`ratchet/playwright-no-nth-methods-e2e`,
`ratchet/playwright-prefer-native-locators-e2e`) hold empty baselines and
the debt-file override sets in `eslint-config/` are empty. The prior
pack's leaf 04 recorded the intended end state: "When the floors drain,
promote the rules to unconditional `error` and delete the debt-file
overrides per the zero-baseline lifecycle."

## Scope

- Confirm all three ratchets are at zero findings and zero baseline items.
- Make the three rules unconditional `error` across `e2e/**` in normal
  lint; delete the now-empty debt-file override machinery.
- Retire the three ratchets per the zero-baseline lifecycle (registry
  entry removal or the documented zero-disposition path — follow
  `docs/guides/lint-ratchet.md`, do not invent a new lifecycle).
- Update `docs/agent_notes/lint-coverage-map.md` rows if they reference
  the ratchets (the coverage-map checker will catch drift).
- Record a short completion verdict in `evaluation-verdicts.md` noting
  final counts and dates, mirroring how prior drains were recorded.

## Definition Of Done

A new raw/positional selector anywhere in `e2e/**` fails `bun run lint`
directly; no selector ratchet remains in the registry; coverage map and
zero-baseline audits pass.

## Verification

- A deliberate `page.locator("#probe")` and a `.first()` probe in two
  different e2e files each fail `bun run lint`; revert the probes.
- `bun run lint:ratchet:check-registry`, `lint:ratchet:zero-baseline`,
  and the coverage-map check pass.
- `bun run verify:changed`.

## Notes (2026-06-12)

- The promotion half was already complete when this leaf started: 03f
  removed the empty override sets, so normal lint had been unconditional
  `error` across `e2e/**` since then. This leaf was pure retirement.
- Registry removal goes through
  `lint:ratchet:update --allow-worse --reason "<...>"` — the updater
  treats orphaned baseline ids as a guarded removal and records the
  reason in `lint-ratchet.debt-log.jsonl` (commit it with the baseline).
  The umbrella method's "--allow-worse is never justified by a drain"
  applies to drains; retirement is the documented exception.
- The ratchets were also registered as controls in
  `harness.controls.json` (checked by `harness:check`); removed the three
  entries and regenerated `docs/generated/harness-controls.md`
  (101 controls, 6 ratchets remain).
- `drift:e2e` decision deferred from 03f: retired the `debtFileCount`
  report field (schema 1 → 2) since the override sets it counted no
  longer exist; the sensor stays as the report-only raw-locator counter
  and currently reports zero.
- Probes verified: `.first()` failed `playwright/no-nth-methods` and
  `page.locator("#probe")` failed `local/e2e-prefer-role-selectors` under
  plain `bun run lint`; both reverted before commit.
- Coverage-map row for `e2e/**/*.ts` updated to 45 files, single
  remaining ratchet (`local-type-assertion-boundary`), retirement noted
  in Blocker/follow-up. Verdict recorded in `evaluation-verdicts.md`.
