# 12 — Suppression allowlists buried in bash; hadolint pin ineffective (wrapper floats to latest)

Status: Done — hadolint pin made effective (`1edc16f3`) + suppression allowlists as data (`761f0d98`)
Track: T (tooling) · Priority: P2 · Size: M

## Evidence (verified 2026-07-11; adversarially re-triaged 2026-07-11 — hadolint claim upgraded after empirical check; re-verify before implementing)

- `scripts/eslint-disable-register.sh:23-35` — `BROAD_ALLOWLIST`, a
  hand-maintained `path|rule` glob list embedded in the script.
  `scripts/suppression-register.sh:27-30` — `TS_NOCHECK_ALLOWLIST`, same
  pattern. Triage note: every current entry resolves to a real file at HEAD,
  and a moved file fails the register loudly — the rot risk is stale entries
  lingering silently, plus the waiver inventory being undiscoverable outside
  the two scripts. The FAIL messages (`eslint-disable-register.sh:255`,
  `suppression-register.sh:274`) point contributors at the scripts as the
  place to add exceptions and must move with the lists.
- `scripts/lint-config-sensors.sh:432` (`--ignore DL3007`) and `:438`
  (`--ignore DL3008 --ignore DL3015 --ignore DL4006`) — hadolint waivers
  inline in the invocation (each has an adjacent rationale comment; low
  urgency).
- **The package.json hadolint pin is dead, not merely duplicated.**
  `package.json:16` declares top-level `"hadolint": "2.14.0"`, but the npm
  wrapper (`hadolint@0.4.2`, `node_modules/hadolint/dist/version.js`) reads
  `config.hadolint` from the cwd package.json — `const { config } = await
  parse(...)`; `config?.hadolint ?? 'latest'`. Verified empirically at HEAD:
  with a top-level `"hadolint": "2.12.0"` the wrapper resolves **2.14.0**
  (GitHub latest, via a network fetch on every invocation); with
  `"config": {"hadolint": "2.12.0"}` it honors 2.12.0. The repo's own sensor
  test fixture already uses the correct nested form
  (`scripts/tests/test-lint-config-sensors.sh:176`).
- `scripts/lint-config-sensors.sh:12` pins `HADOLINT_VERSION=2.14.0`, but it
  only names the cache file for the exec-bit workaround
  (`hadolint_cache_file`, `~:266-314`); it does not control which binary the
  wrapper downloads and runs.
- `scripts/doctor.sh:653-655` documents the shell pin as the single-sourced
  known-good ("read here, never re-pinned") and greps it at `:747` — that
  belief is false in effect, since the wrapper ignores both pins today.

Failure scenario (reachable): the pin is currently masked because GitHub
latest happens to be 2.14.0. On the next upstream hadolint release, every
lint run silently downloads and runs the new version (no commit chose it),
the shell cache lookup `hadolint-2.14.0` misses so the exec-bit workaround
stops applying, and the sensor lane can fail on fresh caches. Independently,
the per-invocation `latest` resolution makes the lint gate network-dependent:
offline, the wrapper throws before running the cached binary.

## Do

Two commits:

1. **Make the pin real and single-sourced.** Move the version under
   `"config": {"hadolint": "2.14.0"}` in `package.json` (the form the wrapper
   reads and the test fixture already uses). Derive `HADOLINT_VERSION` in
   `scripts/lint-config-sensors.sh` from that key (a `bun -e` read, mirroring
   doctor's `pkg_dep_version`), or keep the literal but add a fail-loud
   startup parity check. Update `scripts/doctor.sh` to read the known-good
   from `package.json` `config.hadolint` instead of grepping
   `^HADOLINT_VERSION=` (`:747`), and fix the single-source comment
   (`:653-655`).
2. **Allowlists as data.** Move `BROAD_ALLOWLIST` and `TS_NOCHECK_ALLOWLIST`
   into committed data files the scripts read — line-based `path|rule` text
   keeps the bash readers dependency-free; the max-lines-exceptions baseline
   is the model in spirit (diffable, one findable inventory of waivers).
   Update the two FAIL messages to point at the data files. Leave the
   hadolint `--ignore` flags inline; they carry rationale comments and are
   per-invocation policy, not a rotting list.

## Verify

```
bash scripts/tests/test-lint-config-sensors.sh
bun run lint:suppressions
bun run doctor          # lint-tools inventory reports the package.json pin as known-good
```

## Acceptance

The hadolint version has exactly one effective source (`package.json`
`config.hadolint`) that the wrapper, the sensor script, and doctor all read;
the wrapper no longer floats to `latest`. All suppression allowlist waivers
live in committed data files an adopter can find in one place, and the
register FAIL messages point there.
