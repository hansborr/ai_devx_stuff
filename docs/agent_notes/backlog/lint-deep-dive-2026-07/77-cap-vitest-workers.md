# 77. Cap Vitest workers and ratchet the test-slot reservation

Status: Done 2026-07-14 on `auto/vitest-worker-caps`.
Lens: pipeline · Area: test performance + OOM · Severity: high · Size: M
Theme: performance / memory · Source: follow-up to [leaf 73](73-lint-lane-memory-profile.md).

## Outcome

The four non-server Vitest projects now share a default six-worker ceiling.
`NON_SERVER_TEST_MAX_WORKERS` can lower that ceiling or raise it on CI or a
larger host up to 8, the largest elevated configuration measured here.
Admission charges 3,200 MB when the effective full-suite and changed-client
inputs are unset or positive values at or below 6, and the conservative pre-cap
5,580 MB bound when either effective input is elevated or malformed. Environment
values above 8 are charged at that bound until Vitest config parsing rejects
them. The native `VITEST_MAX_WORKERS` follows the same validation and reservation rules
and, matching Vitest itself, takes precedence when both worker variables are
valid and set. Both variables are validated even when native precedence makes
one ineffective. The root wrappers also validate `--maxWorkers <n>` and
`--maxWorkers=<n>` before classification or admission; Vitest's equivalent
`--max-workers` spelling is governed too. Installed Vitest 4.1.7 applies
`VITEST_MAX_WORKERS` after resolving CLI/config workers, so the matched effective
order is native env, then CLI, then `NON_SERVER_TEST_MAX_WORKERS`. Vitest does
not propagate global CLI `maxWorkers` into workspace project configs, so when
native env is absent the full-suite wrapper translates the validated CLI value
into `VITEST_MAX_WORKERS` before admission and dispatch. This makes CLI effective
for every non-server workspace project while preserving an inherited native
value. Root config retains a translation-origin marker long enough for project
config re-evaluation, then removes the synthetic native variable before Vitest
can globally override the server; the server remains at `SERVER_TEST_MAX_WORKERS=6`.
An explicitly inherited native value retains its prior global semantics.
`test:changed` uses the same translation for its ordinary and full-fallback
Vitest phases, while its client fast-lane phase deliberately forces
`MUSI_CLIENT_FAST_LANE_MAX_WORKERS` as a distinct native value. Values above 8
never dispatch. Repeated same- or mixed-spelling worker flags are rejected as
ambiguous because this Vitest version accumulates them into an array instead of
using the last value. The changed-client
`MUSI_CLIENT_FAST_LANE_MAX_WORKERS` input is validated to the same range before
its conversion to `VITEST_MAX_WORKERS`; its parent-visible effective value is
included in gate admission. The server keeps its existing independently
measured six-worker cap.

The selected cap reduced the current full test-slot peak from **5,499,576 KiB
(5,631.57 decimal MB)** to **3,115,396 KiB (3,190.17 decimal MB)**, a **43.35%**
reduction. Wall time moved from **243.377 s** to **230.337 s**, a **5.36%
improvement** in these passes. Against leaf 73's older 213.6 s reference, the
selected run is 7.84% slower, still below the 15% regression threshold.

The default `test` admission reservation is therefore **3,200 MB**, rounding
the 3,190.17 decimal-MB measured peak up to the table's coarse 100-MB boundary.
The elevated-override bound remains 5,580 MB because cap 8 measured 4,388.97 MB
and would exceed both the default reservation and the separate 1,024 MB safety
margin if it were charged at 3,200 MB. Cap 8 is also the maximum accepted
override because it is the only elevated setting with a measured peak; allowing
larger unmeasured worker pools would make a flat reservation unjustifiable.

## Method

Measurements reused leaf 73's `/tmp/musi-tree-rss.sh` process-group sampler:

- launch the command under `setsid`;
- poll `ps -e -o sid=,rss=` at about 0.2 s intervals;
- sum RSS for the session and record the peak instant and process count;
- kill the whole process group at
  `MUSI_MEASURE_RSS_CUTOFF_KB=8500000` (8,500,000 KiB) if necessary; and
- run the exact generated test-slot command, including its dot and JSON
  reporters:

```sh
MUSI_TOOL_MEMORY_ADMISSION_BYPASS=1 \
MUSI_MEASURE_RSS_CUTOFF_KB=8500000 \
/tmp/musi-tree-rss.sh <label> /tmp/musi-vitest-worker-measure \
  bun run test --reporter=dot --reporter=json \
  --outputFile.json=/tmp/musi-vitest-worker-measure/<label>.json
```

The profiling-only direct-tool bypass is necessary because direct admission
launches its child in another isolated process group. Without the bypass, the
session sampler sees only the admission wrapper instead of the Vitest tree.
The bypass does not alter gate admission semantics and was not committed.

All full-suite measurement passes ran one at a time on the same 16 GB RAM,
8 GB swap, 16-CPU worktree. The baseline was captured before config changes.
The sampler has the same limitations recorded in leaf 73: 0.2 s polling can
miss sub-interval spikes, and summed process RSS double-counts shared pages.

## Measurements

| Configuration | Wall | Peak RSS | Decimal MB | Peak processes | Result |
|---|---:|---:|---:|---:|---|
| Leaf 73 historical reference (uncapped client/shared) | 213.6 s | 5.58 GB | 5,580 MB | ~21 | passed |
| Current cold-ish baseline, uncapped group 0 | 243.377 s | 5,499,576 KiB | 5,631.57 MB | 26 | 10,594 tests passed |
| Candidate: group-0 cap 8 | 221.217 s | 4,286,104 KiB | 4,388.97 MB | 13 | 10,601 tests passed |
| **Selected: group-0 cap 6** | **230.337 s** | **3,115,396 KiB** | **3,190.17 MB** | **9** | **10,601 tests passed** |

The seven-test count increase in candidate runs is the new worker-cap helper
suite; it does not represent a production-suite behavior change. A later
plumbing assertion raised that focused suite from seven to eight tests, and the
commit gate's full test slot passed with that final form.

Relative to the current baseline, cap 8 saved 22.06% peak RSS and improved wall
time 9.11%. Cap 6 saved 43.35% peak RSS and improved wall time 5.36%. Relative
to cap 8, cap 6 saved another 27.31% peak RSS for 4.12% more wall time. That is
a strong memory trade for a small timing cost, so 6 is the default.

An initial attempt to give client, shared, scripts, and eslint-rules different
caps was rejected before tests ran: Vitest 4 requires projects with the same
`sequence.groupOrder` to have the same `maxWorkers`. Assigning separate sequence
groups would serialize projects and change the scheduling model, so the four
group-0 projects instead consume one shared value. Server remains in group 1
with `SERVER_TEST_MAX_WORKERS=6`; these measurements did not justify changing
that already profiled cap.

## Verification

- TDD red: the focused helper test first failed because the parser module did
  not exist; the measured-default plumbing assertion then failed while the
  candidate default was still 8.
- `bun run test:scripts:file -- scripts/vitest-worker-count.test.ts` passed with
  seventeen tests.
- `bun run typecheck` passed.
- `bun run docs:lint-coverage-map:check` passed.
- Both measured candidates passed the complete generated test-slot command.
- Reservation policy tests pin 3,200 MB for unset/default/lower worker counts,
  5,580 MB admission for elevated, malformed, or unknown values, and parser
  rejection above the measured-safe maximum of 8. Native-only values 8 and 60,
  native precedence, and validation of an ineffective configured value are
  covered explicitly. CLI value 8 charges 5,580 MB and reaches Vitest, CLI value
  60 is rejected before dispatch, and native-env precedence is pinned in both
  directions: native 8 plus CLI 4 charges 5,580 MB, while native 4 plus CLI 8
  charges 3,200 MB. Same-spelling and mixed-spelling repeated CLI flags are
  rejected before dispatch. Configured 8 plus CLI 4 translates CLI to native 4
  for both full-suite dispatch branches and books 3,200 MB. The changed-client
  path uses 4 by default and its focused override uses 2; inherited value 8
  charges the gate at 5,580 MB, while 60 and empty values are rejected before
  the changed test command dispatches. Changed ordinary/fallback phases inherit
  translated CLI, but the client fast lane forces its separate configured cap.
  A translated CLI 8 resolves to 8 for all four group-0 projects and 6 for the
  server project; the installed Vitest resolver was also checked directly.
- The worker-cap commit gate passed the full `test` and `scripts` slots before
  the repository-wide fast-commit marker was enabled for the final retry.

## Decision

Keep the non-server cap at 6 and the server cap at 6. Use
`NON_SERVER_TEST_MAX_WORKERS=<1..8>` only when a host-specific run has enough
memory to justify higher concurrency; admission automatically uses the 5,580 MB
pre-cap bound for 7 or 8. Treat `VITEST_MAX_WORKERS` as the native-precedence
alias under the same contract, not as an unbounded escape hatch. CLI
`--maxWorkers` is the next-precedence spelling and is subject to that same range
and reservation; the full-suite and changed-test ordinary/fallback paths
translate it to native env only when the caller did not set
`VITEST_MAX_WORKERS`. The translation marker scopes that synthetic value to
non-server projects, preserving server 6. Keep
`MUSI_CLIENT_FAST_LANE_MAX_WORKERS` at 4 unless a
changed-client run specifically benefits from tuning; 7 or 8 intentionally
charges the elevated reservation. Keep the default `test` reservation at 3,200
MB; all other admission entries and default-run admission semantics remain
unchanged.

This precedence and ambiguity contract depends on installed Vitest 4.1.7. Any
Vitest upgrade must re-audit precedence and repeated-option parsing at these
relocatable runtime landmarks:

- `resolveConfig` in the `coverage.*` chunk, where native
  `VITEST_MAX_WORKERS` overrides resolved CLI/config workers;
- `resolveProjects` / `resolveMaxWorkers` in the `cli-api.*` chunk, where the
  workspace override allowlist and project-vs-global worker choice determine
  whether CLI reaches project configs; and
- CAC/mri `toVal` in the `cac.*` chunk, where repeated option values accumulate.

Then rerun the worker parser and admission smoke tests before accepting the
upgrade. The repository's dependency-freshness check only detects whether
`node_modules` matches `bun.lock`; it does not validate dependency CLI semantics,
so leaf 77 is the upgrade-review pointer.
