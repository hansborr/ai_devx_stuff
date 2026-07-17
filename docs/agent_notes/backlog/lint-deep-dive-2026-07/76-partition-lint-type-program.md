# 76. The lint type program is monolithic — measure package partitioning

Status: Implemented 2026-07-14 in `d714f4ce`; final parity and measurements recorded
Lens: pipeline · Area: main lint lane / typescript-eslint · Severity: med-high · Size: M · Confidence: medium
Theme: performance · Source: [note 73](./73-lint-lane-memory-profile.md), ranked option 3

## Problem

Roughly 3.4 GB (about 80%) of cold lint's 4.27 GB peak is the persistent
typescript-eslint ProjectService program. Typecheck performs comparable type
work in 1.83 GB because project references partition it into independently
collectable programs. Before this leaf, lint retained one monolithic program;
the implemented lane now releases each of four sequential programs before
starting the next.

## Evidence

- [Note 73's decomposition](./73-lint-lane-memory-profile.md#what-dominates-the-427-gb-serial-peak-the-typescript-type-program)
  measures the parse floor and attributes the remaining peak to ProjectService.
- [Note 73 ranked option 3](./73-lint-lane-memory-profile.md#ranked-memory-reduction-options)
  estimates a 1.5–2 GB reduction but explicitly requires a dedicated
  measurement pass because partitioning may increase wall time.

## Do

1. Measure cold and warm peak RSS, wall time, diagnostics, and cache behavior
   for sequential per-package ESLint and scoped ProjectService/project-graph
   candidates.
2. Verify that root scripts/config files and cross-package type-aware rules keep
   identical coverage and diagnostics.
3. Record the selected design or a measured rejection before changing the gate.
4. If adopted, implement with focused cache/selection tests and update note 73
   with the comparable results.

## Measurement method

Measurements used note 73's `/tmp/musi-tree-rss.sh`: each command ran in a
`setsid` process group, and the sampler summed RSS for every process with that
session id at approximately 0.2 s intervals. Every heavy run set
`MUSI_MEASURE_RSS_CUTOFF_KB=8500000` (8,500,000 KiB, or 8.106 GiB) and was run
strictly one at a time. This is below note 73's 9,000,000 KiB maximum; the
cutoff did not fire. `scripts/lib/gate-env.sh` supplied the same 6144 MB Node
heap setting as the main lane. No candidate used ESLint `--concurrency`.

Cold runs started with an empty candidate-specific cache directory. Warm runs
immediately repeated the same command and cache. All runs used ESLint's current
`--cache-strategy content`, JSON output, and `--max-warnings=0`. The baseline
command shape was:

```sh
MUSI_MEASURE_RSS_CUTOFF_KB=8500000 /tmp/musi-tree-rss.sh \
  baseline-cold /tmp/musi-leaf76/results bash -lc '
    . scripts/lib/gate-env.sh
    exec ./node_modules/.bin/eslint --max-warnings=0 \
      --cache --cache-location /tmp/musi-leaf76/cache-baseline/.eslintcache \
      --cache-strategy content --format json \
      --output-file /tmp/musi-leaf76/baseline-cold.json .
  '
```

The sequential measurements used the same sampler around one shell that ran
the listed scopes serially. Each scope had a separate `.eslintcache`; sharing
one file would allow one invocation's reconciliation to discard another
scope's entries. The extra process in those rows is the small orchestration
shell plus the one active ESLint child, not parallel ESLint work.

The source tree for these measurements was `ad334a9a`. Raw sampler values are
KiB. This note uses binary GiB parentheticals, dividing KiB by 1,048,576; it
does not label a KiB/1,000,000 quotient as decimal GB.

## Candidate matrix

The current tree produced 2,169 ESLint result objects. Candidate scopes were
derived from that baseline result set so ignored files could not be
accidentally added and root/config files could not be dropped.

| Design | Cold wall | Cold peak RSS | Warm wall | Warm peak RSS | Correctness |
|---|---:|---:|---:|---:|---|
| Current serial lane | 76.572 s | 4,312,092 KiB (4.112 GiB) | 3.097 s | 447,888 KiB (0.427 GiB) | baseline: 2,169 files, 0 diagnostics |
| Package-source sequential | 76.549 s | 3,429,284 KiB (3.270 GiB) | 6.185 s | 447,096 KiB (0.426 GiB) | exact JSON parity |
| Project-boundary sequential | 205.443 s | 2,905,468 KiB (2.771 GiB) | 12.257 s | 446,584 KiB (0.426 GiB) | exact JSON parity |
| Explicit `parserOptions.project` graph | 97.618 s | 4,277,456 KiB (4.079 GiB) | 3.301 s | 475,904 KiB (0.454 GiB) | **FAIL:** 1,109 diagnostics instead of 0 |

`Package-source sequential` used four disjoint scopes: shared `src` (128
files), server `src` (437), client `src` (694), and the non-source remainder
(910). Keeping package config files in the remainder is required: a naive
package-prefix split made `packages/shared/vitest.config.ts` lose its dedicated
default project and produced a ProjectService parse error. Compared with the
baseline, the corrected design saves 882,808 KiB (20.5%) cold with unchanged
cold wall, but adds 3.088 s (99.7%) to every fully warm run because four ESLint
processes must load before their cache hits can be recognized.

`Project-boundary sequential` split the remainder further according to the
existing parser projects: shared `src` (128), server `src` (437), client `src`
(694), scripts (739), E2E (46), server scripts/prisma seed (3), config-project
files (12), and the remaining JS/JSON/config surfaces (110). It saves
1,406,624 KiB (32.6%) cold, but adds 128.871 s (168%) cold and 9.160 s (296%)
warm. Its eight cache files total approximately the same size as the baseline
cache; the 0.426 GiB warm peak confirms cache hits avoid constructing the type
program, while repeated ESLint/plugin startup causes the wall regression.

The explicit-project candidate kept one ESLint process and overrode shared,
server, client, and config scopes with their corresponding tsconfigs while
preserving the existing scripts/E2E overrides. It did not reduce cold memory
meaningfully, made cold wall 27% slower, and—critically—does not reproduce
ProjectService's project-reference semantics. Client imports whose types cross
the server/shared boundaries became unresolved, producing 1,109 findings such
as `@typescript-eslint/no-unsafe-assignment`, `no-unsafe-call`, and
`no-unsafe-member-access`. Its warm row is recorded for completeness, but it
is not a valid green-lane cache result (ESLint exited 1 in both runs).

## Candidate reproduction

The four-way input lists were generated from the baseline result set with this
exact classifier (the `sed` makes ESLint's absolute JSON paths repo-relative):

```sh
rm -f /tmp/musi-leaf76/*.files
jq -r '.[].filePath' /tmp/musi-leaf76/baseline-cold.json \
  | sed "s#^$PWD/##" \
  | awk '
      /^packages\/shared\/src\// {
        print > "/tmp/musi-leaf76/shared.files"; next
      }
      /^packages\/server\/src\// {
        print > "/tmp/musi-leaf76/server.files"; next
      }
      /^packages\/client\/src\// {
        print > "/tmp/musi-leaf76/client.files"; next
      }
      { print > "/tmp/musi-leaf76/remainder.files" }
    '
```

The cold four-way measurement deleted its cache and ran the following. The
warm measurement repeated it without the `rm`, using label `sequential-warm`
and warm output names.

```sh
rm -rf /tmp/musi-leaf76/cache-sequential
mkdir -p /tmp/musi-leaf76/cache-sequential
MUSI_MEASURE_RSS_CUTOFF_KB=8500000 /tmp/musi-tree-rss.sh \
  sequential-cold /tmp/musi-leaf76/results bash -lc '
    . scripts/lib/gate-env.sh
    set -e
    for scope in shared server client remainder; do
      mapfile -t files < "/tmp/musi-leaf76/${scope}.files"
      ./node_modules/.bin/eslint --max-warnings=0 --cache \
        --cache-location "/tmp/musi-leaf76/cache-sequential/${scope}.eslintcache" \
        --cache-strategy content --format json \
        --output-file "/tmp/musi-leaf76/sequential-${scope}.json" \
        "${files[@]}"
    done
  '
```

The eight-way classifier replaced the four-way `awk` body above with:

```awk
/^(knip|playwright|vitest|vitest\.slow)\.config\.ts$/ ||
/^(packages\/(client\/(vite|vitest)|server\/(prisma|vitest|vitest\.mutation)|shared\/vitest)|scripts\/vitest|eslint-rules\/vitest)\.config\.ts$/ {
  print > "/tmp/musi-leaf76/config.files"; next
}
/^packages\/shared\/src\// {
  print > "/tmp/musi-leaf76/shared.files"; next
}
/^packages\/server\/src\// {
  print > "/tmp/musi-leaf76/server.files"; next
}
/^packages\/client\/src\// {
  print > "/tmp/musi-leaf76/client.files"; next
}
/^scripts\// {
  print > "/tmp/musi-leaf76/scripts.files"; next
}
/^e2e\// {
  print > "/tmp/musi-leaf76/e2e.files"; next
}
/^packages\/server\/(scripts\/|prisma\/seed)/ {
  print > "/tmp/musi-leaf76/server_aux.files"; next
}
{ print > "/tmp/musi-leaf76/plain.files" }
```

It used the same serial loop with scopes `shared server client scripts e2e
server_aux config plain` and one cache/output file per scope.

The rejected explicit-project run used a temporary flat config that appended
these overrides to the current config:

```js
import currentConfig from "./eslint.config.js";

const repoRoot = import.meta.dirname;
const explicitProject = (files, project) => ({
  files,
  languageOptions: {
    parserOptions: {
      projectService: false,
      project,
      tsconfigRootDir: repoRoot,
    },
  },
});

export default [
  ...currentConfig,
  explicitProject(
    ["packages/shared/src/**/*.{ts,tsx}"],
    "./packages/shared/tsconfig.json",
  ),
  explicitProject(
    ["packages/server/src/**/*.{ts,tsx}"],
    "./packages/server/tsconfig.json",
  ),
  explicitProject(
    ["packages/client/src/**/*.{ts,tsx}"],
    "./packages/client/tsconfig.json",
  ),
  explicitProject(
    [
      "knip.config.ts",
      "playwright.config.ts",
      "vitest.config.ts",
      "vitest.slow.config.ts",
      "packages/client/vite.config.ts",
      "packages/client/vitest.config.ts",
      "packages/server/prisma.config.ts",
      "packages/server/vitest.config.ts",
      "packages/server/vitest.mutation.config.ts",
      "packages/shared/vitest.config.ts",
      "scripts/vitest.config.ts",
      "eslint-rules/vitest.config.ts",
    ],
    "./tsconfig.configs.json",
  ),
];
```

Its measured command was the baseline command with
`--config .leaf76-project-graph.config.mjs --ignore-pattern
.leaf76-project-graph.config.mjs` and its own cache/output paths.

Cache-file sizes after the warm runs were:

| Design/scope | Cache bytes |
|---|---:|
| Baseline | 1,044,864 |
| Four-way: shared / server / client / remainder | 112,352 / 206,839 / 331,748 / 383,901 |
| Four-way total | 1,034,840 |
| Eight-way: shared / server / client / scripts | 112,352 / 206,839 / 331,748 / 313,345 |
| Eight-way: E2E / server auxiliary / config / plain | 18,016 / 1,198 / 4,639 / 44,875 |
| Eight-way total | 1,033,012 |

## Coverage and diagnostic parity

The baseline and both green sequential candidates were canonicalized by
sorting the complete ESLint JSON result objects by `filePath`. `cmp` reported
byte equality, and all three canonical files had SHA-256:

```text
d873a517a0c9c8f17226f7a4ce95edda4c5f85b0d7dc7f04a2d8bb2ce2da8d13
```

This compares the full result objects, not only exit status or diagnostic
counts. The shared result set includes all package sources plus 739 scripts,
46 E2E files, 64 `eslint-rules` files, 16 `eslint-config` files, and the root
configs/tsconfigs/JSON surfaces. The sequential designs retain the unchanged
ProjectService config for each package source scope, including the client
scope whose type-aware rules traverse server/shared references. The rejected
explicit-project result also contained the same 2,169 file paths, but its
1,109-diagnostic delta proves that file-count parity alone is insufficient.

The parity check shape was:

```sh
jq -S 'sort_by(.filePath)' baseline-cold.json > baseline.canonical.json
jq -s -S 'add | sort_by(.filePath)' candidate-scope-*.json \
  > candidate.canonical.json
cmp baseline.canonical.json candidate.canonical.json
sha256sum baseline.canonical.json candidate.canonical.json
```

## Decision

**Adopt the four-way package-source design.** The implementation landed in
`d714f4ce` after explicitly weighing its recurring cost against the
repository's memory-admission benefit.

The recurring cost is 3.088 s inside every fully warm lint slot (3.097 s to
6.185 s) because four ESLint processes must start and consult their caches.
That cost is always exposed by serial full `verify`. It is not uniformly on the
parallel commit-gate critical path: 28 completed `parallel-precommit`
`run-meta.json` records from July 9–14 available on the host had lint finish
before another slot in 19 runs and finish with the wrapper in 9; equality of
the recorded lint and wrapper `end_time` defined “finish with the wrapper.” The
metadata does not record cache state, so a nonzero 4–14 s lint duration was
used only as a warm/changed heuristic: all six such samples were hidden behind
a slower slot. This does not make the cost free—inputs and cache states vary,
and a future warm lint can still finish last—but it shows the gate normally
overlaps that startup cost rather than adding all 3.1 s to commit wall time.

The benefit is 882,808 KiB (0.842 GiB, or 0.904 decimal GB) less cold RSS with
no cold-wall penalty and exact diagnostic/file parity. Under
`scripts/verify/memory-budget.sh`, adoption replaces the prior 4,270 MB lint
reservation with 3,700 MB. The final 3,545,060 KiB peak converts to 3,630.14
decimal MB and rounds up under the table's coarse 100 MB convention. That
570 MB smaller reservation widens the headroom band in which lint can co-admit
with another worktree or gate slot. For a concrete admission-equation example,
with 10,400 MB available, the 1,024 MB safety margin and
live test (3,200 MB) plus ratchet (2,210 MB) reservations leave 3,966 MB before
their trees accrue material RSS.
4,270 MB > 3,966 MB, so the prior lint reservation waits;
3,700 MB ≤ 3,966 MB, so the adopted lint reservation admits. This scheduling
benefit—not an assertion that lint alone will OOM the host—is the safety value
of the reduction on a 16 GB machine.

The measured 20.5% cold reduction and improved co-admission outweigh the small
absolute warm cost, especially because completed warm-like pre-commit samples
show that cost was hidden and cold wall is neutral. The eight-way and explicit-
project candidates remain rejected for their documented wall and correctness
failures. The adopted runner keeps targeted `lint:changed` invocations focused;
full scans and escalations run all four partitions, while changed-file sets
classify each path and run only their nonempty owning partitions sequentially.

## Final implementation verification

The final-tree comparison used the same 8,500,000 KiB cutoff and process-tree
sampler as the spike. The monolithic reference ran the pre-change command shape
against the implementation tree:

```sh
MUSI_MEASURE_RSS_CUTOFF_KB=8500000 /tmp/musi-tree-rss.sh \
  final-monolithic-cold /tmp/musi-leaf76-final/results bash -lc '
    . scripts/lib/gate-env.sh
    exec ./node_modules/.bin/eslint --max-warnings=0 --cache \
      --cache-location /tmp/musi-leaf76-final/cache-monolithic/.eslintcache \
      --cache-strategy content --format json .
  '
```

The implemented cold run used the production runner and an empty isolated
cache root; the warm run immediately repeated it without deleting that root.
This is the exact historical measurement command:

```sh
PATH="$PWD/node_modules/.bin:$PATH" \
MUSI_MEASURE_RSS_CUTOFF_KB=8500000 \
MUSI_ESLINT_MAIN_CACHE_ROOT=/tmp/musi-leaf76-final/cache-implemented \
  /tmp/musi-tree-rss.sh final-implemented-cold \
    /tmp/musi-leaf76-final/results \
    bash scripts/eslint-main.sh --full --format json
```

The round-3 interface hardening subsequently made `--full` accept no forwarded
ESLint arguments: positional targets could broaden every partition,
`--output-file` could be overwritten, and JSON stdout would be four arrays.
The production no-argument path measured above is unchanged. Current parity
collection uses the diagnostic-only single-partition interface and then the
same `jq -s` aggregation shown below:

```sh
for partition in shared server client remainder; do
  bash scripts/eslint-main.sh --partition "$partition" --format json
done
```

| Final-tree run | Wall | Peak RSS | Result |
|---|---:|---:|---|
| Monolithic reference, cold | 79.147 s | 4,293,960 KiB (4.095 GiB) | 2,169 files, 0 diagnostics |
| Implemented four-way, cold | 78.254 s | 3,545,060 KiB (3.381 GiB) | 2,169 files, 0 diagnostics |
| Implemented four-way, warm | 6.194 s | 461,580 KiB (0.440 GiB) | four cache hits; identical JSON |

The implementation is modestly above the prototype: +3.38% cold peak, +2.23%
cold wall, +3.24% warm peak, and +0.15% warm wall. Those differences are
inside note 73's ±5% sampler band rather than a material divergence. Against
the final-tree monolith, the adopted lane removes 748,900 KiB (17.4%) from the
cold peak without a wall penalty.

The implemented runner invocation wrote four JSON arrays to the sampler log.
Canonicalizing the monolithic array and that four-array stream produced
byte-identical files:

```sh
jq -s -S 'add | sort_by(.filePath)' final-monolithic-cold.log \
  > monolithic.canonical.json
jq -s -S 'add | sort_by(.filePath)' final-implemented-cold.log \
  > implemented.canonical.json
cmp monolithic.canonical.json implemented.canonical.json
sha256sum monolithic.canonical.json implemented.canonical.json
```

Both hashes were
`d873a517a0c9c8f17226f7a4ce95edda4c5f85b0d7dc7f04a2d8bb2ce2da8d13`.
The warm result had the same hash. The final shared/server/client/remainder
cache files retained their prototype sizes: 112,352 / 206,839 / 331,748 /
383,901 bytes. Focused smoke coverage proves scope selection/order, remainder
coverage, distinct whole-graph-salted cache entries, continued collection
after a diagnostic failure, exit 1/2 propagation, full-scan escalation, and
the static ESLint concurrency prohibition. The measured peak updates the lint
admission reservation from 4,270 MB to 3,700 MB. `lint:changed` now uses the
same partition classifier and caches, so its multi-package path is also bounded
by the sequential design rather than inheriting one monolithic ESLint process.

## Acceptance

- [x] Candidate measurements use note 73's process-tree RSS method and safety
  cutoff.
- [x] Diagnostic and file-coverage parity are demonstrated.
- [x] The decision includes cold/warm memory and wall-time tradeoffs.
- [x] No implementation is folded into leaf 74 or 75.

## Verify

The baseline and sequential commands, classifiers, explicit-project config,
cache sizes, cutoff, final implementation measurements, and exact JSON parity
check are recorded above. Focused verification is
`scripts/tests/test-lint-dist-preflight.sh`,
`scripts/tests/test-lint-changed.sh`, and `bun run harness:check`, followed by
the normal commit gate.
