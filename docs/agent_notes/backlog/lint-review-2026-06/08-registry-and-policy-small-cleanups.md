# Registry And Policy Small Cleanups

Status: Done (2026-06-12, landed in "refactor(lint): share test assert allowlist")
Order: 08
Source: Claude review items 5, 6, 7.

## Items

### 1. Registry glob redundancy — completed by 03d2

No remaining action. Leaf 03d2 deleted
`ratchet/core-complexity-lint-ratchet-runtime` after moving
`scripts/lint-ratchet/**/*.ts` under normal lint, and narrowed
`ratchet/local-max-lines-runtime` to the three files 03g still owns. The
former redundant lint-ratchet helper globs are gone.

### 2. Single-source the `assertFunctionNames` allowlist

The same seven-name list (`expect`, `assertNonPermissiveOutput`,
`expectClean`, `expectHit`, `expectOneFulfilledOneConflict`,
`expectParseFailure`, `expectParseSuccess`) is still spelled out in the
normal `unitTestConfigs` Vitest block, the
`ratchet/vitest-expect-expect-script-tests` rule options, and the
codemod-test override introduced by Leaf 03j (which appends `runFixture`).

Fix: lift a shared constant into `eslint-config/shared-policy.js` (where the
e2e selector debt-file lists now live) and import it from both surfaces. The
codemod-test override should spread the shared base list and append
`runFixture`. Rule options are part of the ratchet config hash, so a future
edit correctly forces a baseline refresh either way; expect one refresh when
the constant lands if formatting changes the emitted options.

Note: the deliberately *narrower* drift-ai ratchet
(`assertFunctionNames: ["expect"]`) is not part of this list and stays
independent.

### 3. Unpin the baseline line-count in the guide

`docs/guides/lint-ratchet.md:499` says "the 1390-line baseline JSON"; the
committed baseline is 796 lines today and shrinking as debt drains. Replace
with "the committed baseline JSON" so the number stops rotting.

## Verification

- `bun run lint:ratchet:summary` before/after (item 1 scope check)
- `bun run lint:ratchet:update` + `lint:ratchet:check-baseline` /
  `check-registry`
- `bun run lint -- --max-warnings=0`
- `bun run verify:changed`

## Notes

- Added `scriptTestAssertFunctionNames` in `eslint-config/shared-policy.js` and
  wired the normal Vitest block plus the script-test expect-expect ratchet to
  that shared list; the codemod-test override now spreads the shared list and
  appends `runFixture`.
- `bun run lint:ratchet:update` reported the baseline already matched because
  the serialized rule options did not change; no baseline diff was generated.
- Replaced the stale fixed baseline line count with "the committed baseline
  JSON" in the ratchet guide.
