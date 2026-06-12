# Type-Aware ESLint Cache Policy

Status: Done (2026-06-12, landed in "fix(lint): remove normal eslint cache")
Order: 06
Source: Claude review item 4.

## Context

`docs/guides/lint-ratchet.md` explains why `type-aware-ts` ratchets omit
`--cache`: ESLint's cache key follows direct source bytes, not imported type
dependencies, so a schema type edit can leave an unchanged consumer file with
a stale clean result. But the main lint surface runs the strictTypeChecked
config **with** `--cache`: `scripts/lint.sh:21`, both paths in
`scripts/lint-changed.sh`, and the `lint:fix` script in `package.json`.

Consequence: a local full `bun run lint` can pass stale-clean after a
type-dependency edit and then fail in cold-cache CI — the exact failure mode
the ratchet design documents avoiding. CI being cold is the only backstop.

## Scope

This is a measured decision, not an automatic removal.

- Measure cold vs warm full-lint wall time to price the cache.
- Then pick one:
  - drop `--cache` from the type-aware lint invocations and accept the cost;
  - keep it and accept the risk explicitly — a comment in `lint.sh` pointing
    at the ratchet doc's rationale, plus a note in the lint guide, so the
    asymmetry is documented rather than accidental;
  - or invalidate smarter: the changed-lint path already classifies
    lint-affecting config changes via the path-policy full-scan trigger;
    evaluate extending that to clear the ESLint cache when type-graph-
    affecting paths (`packages/shared/src/**`, tsconfigs, eslint configs)
    change.
- Record the decision durably (decision record or guide section).

## Coupling

The watchlist's cache-and-CI-policy entry is the CI-side half of the same
decision space (adding cache to CI vs removing it locally). Settle one
coherent cache policy and record the outcome in `watchlist.md`.

## Definition Of Done

The repo either has no stale-clean window on the type-aware lint surface, or
the accepted window is documented where the next maintainer will trip over it
— with measurements justifying the choice.

## Notes

- Re-checked the original references: `scripts/lint.sh`, both ESLint paths in
  `scripts/lint-changed.sh`, and `package.json`'s `lint:fix` script all passed
  `--cache` before this leaf.
- Measured full `bun run lint` on 2026-06-12: former cached path was 60.6s
  after clearing `node_modules/.cache/eslint/` and 10.9s warm; no-cache path
  took 56.8s, then 57.2s on a second pass.
- Reproduced the stale-clean window before the change with a temporary shared
  enum plus an unchanged consumer switch: cached ESLint passed after adding an
  enum member, while uncached ESLint reported
  `@typescript-eslint/switch-exhaustiveness-check`.
- Decision: remove ESLint's per-file cache from normal `lint`, `lint:changed`,
  and `lint:fix`, accepting the warm-run cost so local type-aware lint has the
  same imported-type dependency safety as cold CI and `type-aware-ts` ratchets.

## Verification

- Cold/warm timing data for `bun run lint`
- Stale-clean repro before (schema type edit + warm cache) and its resolution
  after
- `bun run verify:changed`
