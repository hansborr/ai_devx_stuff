# Task 31: Ratchet Run Grouping

Date: 2026-05-26

## Investigation

`scripts/lint-ratchet-config.ts` currently has 36 entries in `lintRatchets`.
The current collector iterates that array and awaits `runEslint` once per
ratchet, so today's implementation performs 36 serial ESLint invocations.

Wall-time measurements used Bash `time -p` because `/usr/bin/time` is not
installed in the local container.

## Measurements

- `bun run lint:ratchet`: 25.97s, 26.34s, 26.27s real time.
- Observed `lint:ratchet` range: 25.97s to 26.34s.
- `bash scripts/test-lint-ratchet.sh`: 29.20s real time.

All measured `lint:ratchet` runs passed with zero regressions and zero
improvements.

## Grouping Analysis

Using a conservative compatibility key of rule source, `ruleId`, effective
parser profile, rule options, metric, mode, and target, the 36 current ratchets
would collapse to 25 independent ESLint invocations.

The multi-entry grouping opportunities are:

- `complexity`, `minimal-ts`, `{ max: 10 }`: 4 ratchets for codemods, drift-ai,
  eslint-rules, and lint-ratchet runtime sources.
- `local/max-lines`, `minimal-ts`, `{ max: 300, skipBlankLines: true,
  skipComments: true }`: 6 ratchets for the current max-lines policy slices.
- `regexp/no-unused-capturing-group`, `minimal-ts`, no options: 2 ratchets for
  eslint-rules and lint-coverage-map-check.
- `vitest/valid-expect`, `minimal-ts`, `{ maxArgs: 2 }`: 3 ratchets for
  codemod, drift-ai, and script tests.

`vitest/expect-expect` also has three `minimal-ts` ratchets with the same
`ruleId`, but their `assertFunctionNames` options differ. Treating those as one
simple grouped ESLint invocation would change rule behavior unless the grouping
implementation generated separate config blocks and mapped findings back to
ratchet ids by matched file scope.

## Recommendation

Do not implement grouping for task 31. The measured `lint:ratchet` wall time is
well under the roughly 60 second threshold, and the smoke test is also below 30
seconds. The available conservative grouping would reduce invocations from 36 to
25, but the current runtime does not justify the extra runner complexity,
cache-key changes, and per-ratchet result attribution work.

Close this task with the current measurements documented. Revisit grouping only
if the ratchet registry grows enough that `bun run lint:ratchet` approaches or
exceeds the 60 second local/CI budget.
