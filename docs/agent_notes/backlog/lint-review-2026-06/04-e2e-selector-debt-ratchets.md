# E2E Selector Debt Ratchets

Status: Done (2026-06-12, landed in "fix(lint): ratchet e2e selector debt")
Order: 04
Source: Claude review item 2.

## Context

The former `e2ePreferRoleSelectorAllowlist` block turned
`local/e2e-prefer-role-selectors` fully off for 19 e2e files. The stated plan
("files migrate off this list opportunistically, Plan Step 3c"; same wording
in the coverage map) had no forcing function: new violations in those files
accrued silently and a file could get worse without any gate noticing.

The same critique applied to the former `playwright/no-nth-methods: "off"` —
unbounded new `first()`/`last()` usage — and to the deferred Stage 4 selector
rules `playwright/no-raw-locators` and `playwright/prefer-native-locators`.

This is exactly the message-count ratchet use case: per-file floors let
existing debt stand while blocking growth, and files fall off naturally as
they drain.

## Scope

- Replace the allowlist-off block with a message-count ratchet for
  `local/e2e-prefer-role-selectors` over `e2e/**`; keep the rule at `error`
  outside the ratcheted files. Baseline current counts; mode `no-new`.
- Add a `playwright/no-nth-methods` ratchet floor the same way instead of
  global off.
- The registry supports local and third-party rule sources; e2e files parse
  under `tsconfig.e2e.json` — confirm `minimal-ts` reaches these syntactic
  rules, or add an e2e parser profile if not.
- Evaluate whether `no-raw-locators` / `prefer-native-locators` add signal
  beyond the local rule; record the verdict in `evaluation-verdicts.md` either
  way.
- When the floors drain, promote the rules to unconditional `error` and
  delete the debt-file overrides per the zero-baseline lifecycle.

## Definition Of Done

No e2e selector rule is globally or per-file "off" without a ratchet floor
holding its current count; new selector debt cannot land silently.

## Notes

- Replaced the legacy role-selector allowlist with debt-file overrides backed
  by `ratchet/local-e2e-prefer-role-selectors` (100 findings across the 19
  existing raw-locator debt files). Clean e2e files keep the local rule at
  normal-lint `error`.
- Added `ratchet/playwright-no-nth-methods-e2e` (38 findings across 13 files)
  and `ratchet/playwright-prefer-native-locators-e2e` (34 findings across 11
  files), with normal-lint `error` outside their current debt-file sets.
  `minimal-ts` reaches these syntax-only local/Playwright rules.
- Evaluated `playwright/no-raw-locators`: it reported 97 findings and no extra
  files versus the local rule's 100 findings, so the explicit `off` switch was
  removed and the duplicate plugin rule was left unconfigured. Verdicts are in
  `evaluation-verdicts.md`.
- Probe result: adding a temporary `page.locator("#batonloop-ratchet-probe")`
  call to `e2e/helpers/auth.setup.ts` failed `bun run lint:ratchet` as an
  increased `ratchet/local-e2e-prefer-role-selectors` count (5 -> 6), then the
  probe was reverted.

## Verification

- `bun run lint -- --max-warnings=0`
- `bun run lint:ratchet` / `lint:ratchet:update` /
  `lint:ratchet:check-registry`
- `bun run lint:ratchet:zero-baseline`
- A deliberate new-violation probe in a ratcheted debt file fails the ratchet
- `bun run verify:changed`
