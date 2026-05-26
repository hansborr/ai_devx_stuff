# Lint Reference Readiness 02: Zero-Baseline Normal-Covered Rows

Completed on 2026-05-25.

Removed eight zero-baseline ratchets that `bun run lint:ratchet:zero-baseline`
reported as `normal-error`, which means normal ESLint already enforced the same
rule/options at `error` for every matched file:

- `ratchet/local-max-lines`
- `ratchet/local-max-lines-lint-coverage-map-check`
- `ratchet/local-max-lines-lint-rule-docs`
- `ratchet/simple-import-sort-imports-top-level-scripts`
- `ratchet/typescript-eslint-no-misused-promises-drift-ai-tests`
- `ratchet/typescript-eslint-no-misused-promises-script-tests`
- `ratchet/typescript-eslint-only-throw-error-drift-ai-tests`
- `ratchet/typescript-eslint-only-throw-error-script-tests`

Updated `lint-ratchet.baseline.json`, `harness.controls.json`, the generated
harness-control docs, and the harness-check fixture so no live inventory points
at the retired registry IDs.

`bun run lint:ratchet:update` needed the count-protection override because
registry removal leaves orphan baseline entries before the baseline is
rewritten:

```sh
bun run lint:ratchet:update -- --allow-worse --reason "retire zero-baseline ratchets covered by normal lint at error"
```

Post-removal zero-baseline audit summary: 36 zero-baseline ratchets, 0
normal-lint error-covered rows, 36 remaining lifecycle rows for later leaves.
