# Flat-Config Guard Tests For Rule Replacement Hazards

Status: Done (2026-06-12, landed in "test(lint): guard flat-config rule
replacement hazards")
Order: 07
Source: Codex review item 5, narrowed after verification.

## Context

Flat config replaces rule entries by key, so a later scoped block can
silently drop a load-bearing earlier entry. The repo already guards the
highest-value case: `eslint-rules/no-shared-schemas-barrel.test.js` resolves
the real `eslint.config.js` via `calculateConfigForFile` and asserts the
schemas barrel ban survives for representative files (the Codex claim that
this hazard was untested was stale for that rule). The zero-baseline audit
separately checks resolved normal-lint coverage for ratcheted rules.

Unguarded hazards remain for normal-lint-only entries:

- the `RawTxClient` runtime-boundary `no-restricted-imports` restriction
  (`eslint-config/client-configs.js`);
- the package-boundary `no-restricted-imports` entries
  (`eslint-config/package-boundary-configs.js`, two blocks);
- the ordering-sensitive `no-restricted-syntax` process-primitive bans —
  `eslint-config/script-configs.js:177-179` documents the assumption that the
  process-primitive block is the *first* `no-restricted-syntax` selector, so
  the named-file off-switch only drops those bans; nothing tests that
  ordering.

## Scope

- Inventory by-key replacement hazards across `eslint-config/*.js`: every
  rule configured with options in more than one scoped block, plus rules
  whose correctness depends on config ordering.
- Extend the existing guard-test pattern (resolve config for representative
  real files, assert the load-bearing pattern/selector survives — behavior
  assertions, not config-byte snapshots) to the entries above.
- Keep each guard test documenting *why* the entry is load-bearing, matching
  the barrel test's header comment style.

## Definition Of Done

Dropping any inventoried load-bearing restriction via an innocent-looking
scoped rule re-add fails a named test, not a code review.

## Verification

- New guard tests fail when the guarded entry is deliberately shadowed
  (probe, then revert)
- `bun run test:scripts:changed` (or the eslint-rules test target that picks
  the new tests up)
- `bun run verify:changed`

## Notes (2026-06-12)

- Re-verification found the first two Context bullets stale: the existing
  `eslint-rules/no-shared-schemas-barrel.test.js` already guards the
  `RawTxClient` restriction (server files), the `socket.io-client`
  restriction (client files), and both shared package-boundary pattern
  groups — those assertions landed 2026-05-07 (`bbfc911ba`), before this
  pack was written. The `RawTxClient` config also lives in
  `eslint-config/package-boundary-configs.js`, not `client-configs.js`.
  The ordering-sensitive process-primitive note moved to
  `eslint-config/script-configs.js:100-103` (was 177-179).
- Inventory of rules configured with options in >1 scoped block, and their
  disposition: `no-restricted-imports` family, `local/max-lines`, and the
  e2e selector rules already have `calculateConfigForFile` guard tests
  (`no-shared-schemas-barrel`, `max-lines-policy`, `e2e-selector-config`);
  `import-x/no-extraneous-dependencies` blocks have disjoint per-package
  file scopes (no replacement possible); `max-params`, `no-magic-numbers`,
  `@typescript-eslint/restrict-template-expressions`,
  `max-lines-per-function`, `no-console`, and test-relax blocks are
  intentional per-scope relaxes whose ratcheted members the zero-baseline
  audit already covers. That left `no-restricted-syntax` (process
  primitives) and `no-restricted-globals` (shared runtime-neutrality,
  fetch boundary, sanctioned off-switch) genuinely unguarded.
- Added `eslint-rules/restricted-syntax-and-globals-config.test.js`. The
  exact-selector-count assertions operationalize the documented
  off-switch ordering assumption: any third `no-restricted-syntax`
  selector reaching regular source files fails a named test instead of
  being silently droppable by the boundary off-switch.
- Probe verified: a trailing scoped re-add of both rules made all six
  tests fail; reverted.
