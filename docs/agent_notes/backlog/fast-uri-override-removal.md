# fast-uri Override Removal

Status: Backlog (watchdog-enforced)
Date: 2026-05-28

## Why Parked

The May 2026 dependency refresh added a root `overrides` entry pinning
`fast-uri` to `3.1.2`:

```jsonc
// package.json
"overrides": { "fast-uri": "3.1.2" }
```

This is **vulnerability remediation, not a supply-chain measure.** Upstream
chains — `ajv@8.18.0`, `@fastify/ajv-compiler`, `fast-json-stringify`,
`json-schema-resolver` — still hard-pin the vulnerable `fast-uri@3.1.0`
(published 2025-08-25; the advisory is fixed in 3.1.1/3.1.2). The override
force-resolves the patched 3.1.2 across the tree, which is why
`bun run audit:deps` reports clean.

The pin is intentionally **exact**, consistent with `bunfig.toml`'s
`exact = true` and `minimumReleaseAge = 604800`: an exact override also freezes
the transitive version so a future malicious `fast-uri` publish cannot slide in
via range resolution. A range (`^3.1.2`) would undermine both that freeze and
the lockfile-as-pin discipline, so do **not** loosen it.

## The Risk Being Tracked

Because `bun audit` is clean *because of* the override, the audit gate alone
cannot tell us when upstream has caught up. Once the chains above move off
3.1.0, the override stops doing remediation work and becomes a silent
version-freeze that could mask a future `fast-uri` patch.

## Enforcement (so this cannot rot silently)

`scripts/check-fast-uri-override.sh` is a network-free watchdog that fails the
moment the override is no longer load-bearing — i.e. when no package in
`bun.lock` still pins `fast-uri 3.1.0`. It is wired into:

- `bun run audit:deps` (chained after `bun audit`), and
- the CI **Audit dependencies** step (`.github/workflows/ci.yml`).

Its logic is smoke-tested by `scripts/test-check-fast-uri-override.sh`
(registered in `scripts/path-policy.ts` / `path-policy-smoke-subjects.ts`).

## Removal Steps (when the watchdog fails)

1. Confirm with `grep -F '"fast-uri": "3.1.0"' bun.lock` returning nothing
   (or `bun why fast-uri`).
2. Remove the `"fast-uri"` entry from the root `package.json` `overrides` block.
3. Run `bun install` to regenerate `bun.lock`.
4. Run `bun run audit:deps` to confirm the advisory stays clear without the
   override.
5. Delete `scripts/check-fast-uri-override.sh`,
   `scripts/test-check-fast-uri-override.sh`, the CI **Audit dependencies**
   step's watchdog comment, the `check:fast-uri-override` package script, the
   smoke-test registrations, and this note.
