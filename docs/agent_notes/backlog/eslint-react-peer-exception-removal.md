# ESLint 10 React-Plugin Peer Exception Removal

Status: Backlog (watchdog-enforced)
Date: 2026-05-28

## Why Parked

The ESLint 10 upgrade (2026-05) shipped while two direct devDependencies still
declared no ESLint `^10` peer range:

```jsonc
// node_modules/eslint-plugin-react/package.json
"peerDependencies": { "eslint": "... || ^9.7" }   // caps at 9
// node_modules/eslint-plugin-jsx-a11y/package.json
"peerDependencies": { "eslint": "... || ^9" }     // caps at 9
```

Bun only **warns** on a peer-version mismatch (it does not hard-fail like npm's
`ERESOLVE`), and ESLint does not enforce plugin peers at runtime (flat config
just imports the plugin object). Both plugins therefore install and run under
ESLint 10. We knowingly run them on an engine they do not yet declare support
for — a deliberate **peer exception**.

This is **not** an `overrides` entry. Bun `overrides` force a resolved
dependency *version*; they cannot widen a *peer* range, so an override here
would only freeze the plugin versions, not encode the exception. No `overrides`
entry was added for this.

## The Risk Being Tracked

Because nothing fails at install or lint time, there is no automatic signal for
when upstream catches up. Once both plugins ship an ESLint `^10` peer, the
exception is obsolete and we should drop the watchdog and bump the plugins —
but without enforcement that moment would pass silently and the exception would
rot.

Upstream trackers: `eslint-plugin-react` #3977; `eslint-plugin-jsx-a11y` #1075
/ PR #1081.

## Enforcement (so this cannot rot silently)

`scripts/check-eslint-react-peer-exception.sh` is a network-free watchdog that
reads each plugin's installed `peerDependencies.eslint` (via Bun's native JSON
parse + `Bun.semver.satisfies`) and **fails the moment BOTH plugins declare a
peer range that admits ESLint 10**. While at least one still excludes ESLint 10
it exits 0 (exception still load-bearing). It is wired into:

- `bun run audit:deps` (chained after `bun audit` and the fast-uri guard), and
- the CI **Audit dependencies** step, which runs `bun run audit:deps`
  (`.github/workflows/ci.yml`).

Its logic is smoke-tested by `scripts/test-check-eslint-react-peer-exception.sh`
(registered in `scripts/path-policy.ts`, `scripts/path-policy-smoke-subjects.ts`,
`scripts/path-policy-query.test.ts`, and `scripts/test-test-scripts.sh`).

## Removal Steps (when the watchdog fails)

1. Confirm both plugins now declare an ESLint 10 peer (the watchdog's failure
   message prints the two ranges; or check each
   `node_modules/<plugin>/package.json`).
2. Bump `eslint-plugin-react` and `eslint-plugin-jsx-a11y` in the root
   `package.json` to the versions that declare the ESLint 10 peer.
3. Run `bun install`, then `bun run audit:deps` to confirm no peer warnings
   remain.
4. Delete `scripts/check-eslint-react-peer-exception.sh`,
   `scripts/test-check-eslint-react-peer-exception.sh`, the
   `check:eslint-react-peer-exception` package script, the `audit:deps` wiring,
   the smoke-test registrations, this note, and its entry in
   `docs/agent_notes/backlog/README.md`.
