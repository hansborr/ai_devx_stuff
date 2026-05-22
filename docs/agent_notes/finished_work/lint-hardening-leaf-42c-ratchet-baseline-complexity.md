# Leaf 42c Ratchet Baseline Complexity

Date: 2026-05-21

Leaf 42c drained the remaining `scripts/lint-ratchet-baseline.ts` complexity
debt from `ratchet/core-complexity-lint-ratchet-runtime`.

Starting findings:

- `validateLintRatchetRegistry` — complexity 44
- `compareCurrentToBaseline` — complexity 30
- `parseBaselineTest` — complexity 29
- `validateBaselineAgainstRegistry` — complexity 18
- `newPathSeverityPayload` — complexity 16

Implementation notes:

- Kept public exports and signatures routed through
  `scripts/lint-ratchet-baseline.ts`.
- Split baseline comparison helpers into
  `scripts/lint-ratchet-baseline-compare.ts` and structural JSON parsing into
  `scripts/lint-ratchet-baseline-parse.ts`.
- Left registry and strict baseline validation helpers file-local in the main
  baseline module, with failure ordering and user-facing text preserved.
- Added the two helper files to
  `ratchet/core-complexity-lint-ratchet-runtime`, `tsconfig.scripts.json`, the
  ratchet smoke fixture copy list, changed-test dependency map, and the lint
  coverage map.

Baseline result:

- `ratchet/core-complexity-lint-ratchet-runtime.items` is now `{}`.
- `ratchet/local-max-lines-runtime` naturally lowered
  `scripts/lint-ratchet-baseline.ts` from 838 to 725 effective lines.

Verification:

- `bun run lint -- --max-warnings=0`
- `bun run lint:ratchet`
- `bun run lint:ratchet:check-baseline`
- `bash scripts/test-lint-ratchet.sh`
- `bash scripts/test-lint-changed.sh`
- `bun run lint:shell`
- `bun run lint:config-sensors`
- `bun run typecheck`
- `bun test scripts/lint-ratchet*.test.ts`
- `bun run docs:lint-coverage-map:check`
- `bun run docs:lint-coverage-map:check -- --staged`
- `MUSI_INTERACTIVE_TIMEOUT=900 bun run verify:changed`

`verify:changed` passed in 406s and emitted only the soft-budget warning.
