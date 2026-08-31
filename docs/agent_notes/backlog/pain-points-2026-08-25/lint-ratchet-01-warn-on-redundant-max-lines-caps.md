# Warn on Redundant Max-Lines Exception Caps

Status: Implemented — the `unneeded` audit condition landed with one scoped
deviation: the engine-zone globs/cap moved into `maxLinesPolicy.engineZone`
(`eslint-config/max-lines-policy.js`) instead of importing
`maxLinesEngineZoneConfigs` into the script. Pulling `code-quality-configs.js`
into the strict scripts project first fails on TS7006 implicit-any for
`createRepoCodeQualityConfigs`'s untyped params (the file is checked lax under
`tsconfig.eslint-js.json`), and annotating those params then fails declaration
emit (TS9006/TS2883) on unnameable eslint-plugin types — so the zone data
moved to the already-scripts-safe policy module and the eslint zone config now
derives from it. The audit flags six stale entries in the live baseline —
removing them is an owner decision.
Date: 2026-08-25
Priority: P2
Size: S
Source: `lint-ratchet-and-source-policy.md` — "Exception baselines never expire
on their own"

## Problem

`eslint-config/max-lines-exceptions.baseline.json` grants selected files a
higher-than-default `local/max-lines` cap. When a later refactor shrinks a
capped file back under the default floor, the cap becomes dead headroom, but
nothing in the tooling says so.

`auditEntryCaps` in `scripts/max-lines-exceptions.ts:109-163` already audits
every entry against its own file on each `--check`/`--update` run and warns on
exactly two conditions: the file is missing (`kind === "missing"`, lines
122-129) and the cap is now *below* the file's current effective line count
(`effective > entry.cap`, lines 137-144). There is no check for the opposite
direction — a cap that is now *higher than it needs to be* because the file's
effective lines dropped at or under the default floor that would apply with no
exception at all. `lint:max-lines-exceptions:update` (line 31 of the same
file) only re-sorts and re-derives the `summary.count` field
(`formatMaxLinesExceptionsBaseline` in `scripts/max-lines-exceptions-core.ts`);
it does not remove or flag entries. An agent who deletes the stale entry by
hand and reruns `--update` sees a normal, silent success — there is no
`--update` diff and no warning to confirm the deletion was warranted or to
catch a similarly stale entry left behind. The note records a concrete
incident (CQ-143, 2026-08-20) where a ten-line-headroom entry outlived the
shrink that made it unnecessary and three reviewers had to hand-compute
effective lines to catch it.

Note the naming collision to avoid: `checkGeneratedExemptions`
(`scripts/max-lines-exceptions.ts:64-75`) already hard-errors on a "redundant
cap entry", but that means a *generator-exempt* path that also carries a
baseline entry — it never compares a cap against the file's current line
count. The condition proposed here is distinct; give it a different label
(e.g. `unneeded`/`headroom`) so the two are not confused in output or tests.

The default (no-exception) floor is not a single constant: `eslint-config/max-lines-policy.js:126`
sets the repo-wide `ratchetFloor.cap` to 300, but
`eslint-config/code-quality-configs.js:45-53` (`maxLinesEngineZoneConfigs`)
raises it to 500 for the lint-ratchet engine's own globs
(`scripts/lint-ratchet/**/*.ts`, `scripts/lib/baseline/**/*.ts`,
`tools/lint-ratchet/**/*.ts`). A redundancy check must compare each entry
against the floor that actually applies to its path, not a single hard-coded
number.

## Scope

- In `scripts/max-lines-exceptions.ts`, add a third audit condition to
  `auditEntryCaps` alongside the existing "missing" and "cap below effective"
  checks: for an entry whose file is readable, resolve the default cap that
  would apply to its path with no exception — `500` if the path matches any
  glob in `maxLinesEngineZoneConfigs[0].files` (imported from
  `../eslint-config/code-quality-configs.js`, matched with `minimatch`, the
  same library already used for the repo's canonical glob matching), otherwise
  `maxLinesPolicy.ratchetFloor.cap` (300, from
  `../eslint-config/max-lines-policy.js`, already imported). When the file's
  effective line count is at or under that resolved default, emit a `WARN:`
  detail line naming the entry's path, its current cap, the effective default
  cap, and the current effective count, and recommend removing the baseline
  entry (or keeping a smaller cap if renewed growth is expected). Add a
  matching summary-line bucket, following the existing `capBelow`/`missing`/
  `unreadable` counters and their summary lines at lines 116-118 and 146-160.
- This is a warning only, exactly like the two existing conditions — `--check`
  and `--update` both keep exit code 0 on a redundant entry. ESLint
  `local/max-lines` is still the only thing that fails a build; this audit
  only makes a stale entry visible instead of silent.
- Do not change what counts as "effective lines" (`computeEffectiveLineCount`
  is untouched), do not add an `--update` mode that auto-deletes redundant
  entries, and do not touch the `capBelow`/`missing`/`unreadable` conditions or
  their existing warning text. Do not generalize the zone-floor resolution
  into a public API; a small path-to-cap helper local to this file (or
  `max-lines-exceptions-core.ts`) is sufficient since only two zones exist
  today.
- Add focused cases to the existing `describe("cap-vs-effective audit", ...)`
  block in `scripts/max-lines-exceptions.test.ts:483-610`: an entry above the
  300-line default with effective lines now at/under 300 (redundant), an entry
  above the 500-line engine-zone default with effective lines now at/under 500
  and a path matching `tools/lint-ratchet/**/*.ts` (redundant, zone-aware), an
  entry whose effective lines sit strictly between the default floor and its
  own cap (not redundant — still needed), and confirmation that a
  `capBelow`-triggering entry does not also fire the new redundant warning.

## Verification

- `bun run test -- scripts/max-lines-exceptions.test.ts` covers the new cases
  above alongside the existing missing/unreadable/cap-below/normalization
  tests in the same file.
- `bun run lint:max-lines-exceptions` (the `--check` default) against the live
  baseline should still exit 0; run it with warnings surfaced to confirm no
  regression in the existing two warning conditions' wording.
