# 41. Root/package config registration has three hand-synced sources of truth — single-source it

Status: Done — config-surface manifest now drives shared-policy config lists, generated `tsconfig.configs.json`, and coverage-map status checking.
Lens: config architecture · Area: registration ergonomics · Severity: med · Size: M · Confidence: high
Theme: registration-burden · Source: Musi lint deep-dive 2026-07-04 (3 parallel Codex xhigh lanes + Claude verification agents); matches recorded field pain (memory: mutation config-file registration)

## Problem
Adding one typed root config file (a new `*.config.ts`, `stryker.*.mjs`,
etc.) requires coordinated edits in: (1) `eslint-config/shared-policy.js`
(`rootJsConfigFiles` / `rootAndPackageTsConfigFiles`), (2)
`tsconfig.configs.json` includes, and (3) the coverage map rows — with no
checker that cross-validates the three lists. Missing one produces
project-service lint errors, an unlinted config, or a stale coverage claim,
each discovered at a different gate. This burden is already recorded as
field pain (June 2026 memory note) and by AGENTS-level guidance existing at
all.

## Evidence
- `eslint-config/shared-policy.js:6-32` — the hand lists. Verified 2026-07-04.
- `eslint-config/config-file-configs.js:37-50` — consumption; `tsconfig.configs.json:14-27` — parallel include list; `docs/generated/lint-coverage-map.md:392-398` — parallel rows.
- Verification agent 2026-07-04: no checker relates the three.

## Proposed direction
One `config-surface.(json|ts)` manifest: each entry = path glob + language +
typed? + coverage status. Generate from it: the shared-policy arrays (or
replace them with a direct import), the `tsconfig.configs.json` include list
(generated-file pattern like `steps.generated.sh`, with a `--check` drift
mode in the gate), and either generate the coverage-map rows or teach the
coverage-map checker to cross-validate against the manifest. Registering a
new config becomes a one-entry diff with drift-checked derivation.

## Scope / caveats
- Follow the established generated-surface pattern (`generate-verify-steps.ts`
  + pre-commit staleness WARN) rather than inventing a new one.
- Do the generator + shared-policy first; the coverage-map integration can be
  a second commit (coordinate with leaf 60's checker work).
- Accepted limitation after the second-layer review: the coverage-map reverse
  check can detect omitted manifest entries only for tracked linted files named
  `*.config.{js,mjs,ts}`. The forward check remains manifest-driven and accepts
  arbitrary paths, but the reverse direction has no clean source of "this
  non-`.config.*` path is intended to be a config surface" until the coverage
  map carries section/intent metadata or the row generation becomes manifest
  owned. Escape conditions are: a future config surface with a non-`.config.*`
  name is omitted from `config-surface-manifest.json`, and the file is either
  absorbed by a broad linted row (so the reverse candidate filter never sees it)
  or by a broad non-linted row (so both manifest and reverse checks miss it).
  `docs:lint-coverage-map:audit` can still catch some ESLint-reach mismatches,
  but pre-commit does not run that audit mode.
