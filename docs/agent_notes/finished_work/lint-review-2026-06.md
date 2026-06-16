# Lint Review 2026-06 — Pack Summary

Status: Archive summary written at pack close-out (2026-06-12). The pack
folder `docs/agent_notes/backlog/lint-review-2026-06/` was deleted after
all 23 ordered leaves landed (merged via `feat/lint-improvements`,
1eb011d4). The individual leaves and the full evaluation-verdict register
are available in git history before the folder was removed.

## What the pack changed

- Scripts coverage inversion (sub-leaves 03a-03l): `scripts/**` is linted
  by default. The old ignore-by-default model with ~30 file-by-file
  re-includes is gone; the deliberate policy keeps that remain (drift-ai
  CLI options, codemod arity/literals, drained entrypoint floors) are
  commented in `eslint-config/script-configs.js`.
- Ratchet drain: the registry went from 37 ratchets to 9. Six are
  intentional zero floors carrying `zeroBaselineDisposition` lifecycle
  metadata; the only nonzero debt is the three e2e selector floors below.
- E2E selector debt ratchets (leaf 04): the e2e selector allowlist
  off-switch became three ratchet floors
  (`ratchet/local-e2e-prefer-role-selectors`,
  `ratchet/playwright-no-nth-methods-e2e`,
  `ratchet/playwright-prefer-native-locators-e2e`); clean e2e files keep
  the rules at normal-lint `error`. `playwright/no-raw-locators` was
  rejected as duplicate, weaker coverage of the local rule.
- Type-aware ESLint cache removal (leaf 06): local lint dropped `--cache`
  after reproducing a type-dependency stale-clean. Future CI cache
  adoption must not reintroduce per-file caching for type-aware rules
  unless it invalidates on imported type-graph changes (constraint carried
  in the successor pack's watchlist).
- Merge-base preflights (leaf 01): every `...HEAD` changed wrapper now
  preflights `git merge-base` and fails with a clear no-common-ancestor
  diagnostic instead of a confusing diff error.
- Local typecheck-before-lint ordering (leaf 02), matching CI's ordering
  rationale.
- Import-cycle verdict (leaf 05): adopt the existing
  `drift:ai --scope current --check import-cycles` sensor report-only;
  reject `import-x/no-cycle` (~40 s probes with no findings, slower and
  lower-signal than the sensor). Gating waits for zero runtime cycles —
  that work is the successor pack's leaves 04 and 05.

## Where the details live

- Leaves, the decision table, and the verdict register: git history before
  the folder removal (this summary's landing commit is the deletion
  point).
- Successor queue: `../backlog/lint-followups-2026-06/` — e2e selector
  drain, runtime import-cycle fix and gate decision, and the watchlist
  entries promoted at the 2026-06-12 re-triage. The carried-forward
  watchlist and a fresh verdict register live there.
