# Log

Curated recent history. Do not use this file as an archive for every landed
task; keep only entries that help orient future sessions. Current state lives
in `STATUS.md`, and the active queue lives in `NEXT.md`.

Newest on top.

---

- 2026-05-24: Codex git-commit post-hook timeout handling now treats empty,
  signal, and timeout-shaped commit responses as uncertain instead of generic
  output. The summary says the commit may still be running and may still land,
  and points the agent at `commit-timeout-status.sh` to check whether HEAD
  moved, wait up to 240s for the pre-commit lock, and rerun that status command
  if the lock remains held. Claude's `git-commit-quiet.sh` timeout denial uses
  the same guidance, and `test-ai-hooks` is now selected for `.claude/hooks/`
  changes.
- 2026-05-23: Pre-commit 240s budget review follow-ups on
  `fix/lint-alignment-gaps`. Implemented five slices: (1) shared
  `scripts/process-tree.sh` for recursive process-tree cleanup on timeout,
  (2) `verify --parallel` / `bun run verify:parallel` for full-parallel
  verification within the 240s budget, (3) pre-commit always runs
  `test:scripts:changed` instead of maintaining a separate trigger regex,
  (4) smart deletion classification — only `.husky/` and `scripts/` deletions
  force full smoke fallback, and (5) focused tests for all new behaviors.
  Details: `finished_work/precommit-240-budget-review-followups.md`.
- 2026-05-23: Pre-commit 240s budget follow-up on
  `fix/lint-alignment-gaps`. Changed-mode verify now runs the local gate in
  parallel (`parallel-verify-changed`), verify/pre-commit defaults returned to
  hard=240s / warn=210s, and both paths pass staged changed files into
  `test:scripts:changed` when there are no staged deletions. The heavy
  ratchet smoke was narrowed so type-assertion fixture cases use a one-rule
  registry instead of the live full ratchet matrix (`test-lint-ratchet.sh`
  `4m46s -> 1m54s`). Measured `FORCE_VERIFY=1 bun run verify:changed` at
  `199s` and `FORCE_VERIFY=1 .husky/pre-commit` at `204s`. Details:
  `finished_work/precommit-240-budget-followup.md`.
- 2026-05-23: Lint-ratchet sharing backlog complete on
  `feature/lint-ratchet-sharing-backlog` (33 commits, Leaves 01-07). Added
  strict improvement enforcement, portable adoption guide, CI workflow parity
  with diagnostics/artifacts/step-summary/sticky-PR-comments, baseline summary
  command, PR comment report formatter, check-registry preflight validator, and
  MIT license + sync to `ai_devx_stuff` reference repo.
- 2026-05-21: Baseline drain batch on
  `feature/lint-hardening-baseline-drain-audit` (merged `9d0d1f9b`).
  Four focused commits drained 39 ratchet items
  (`lint:ratchet` `128 -> 89`): magic-numbers in top-level scripts
  `15 -> 0`, `require-await` in `scripts/code-intel.test.ts` `11 -> 0`,
  codemod-test `only-throw-error` + `expect-expect` `12 -> 0`, and
  `scripts/drift-ai.ts:249` `parseArgs` complexity `49 -> 6` (file
  max `49 -> 18`). CLI behavior preserved byte-for-byte for spot-checked
  entrypoints; codex review found no regressions. Audit:
  `/tmp/codex-drain-audit-report.md`. Details:
  `finished_work/baseline-drain-batch.md`.
- 2026-05-22: Pre-commit perf Leaf 5 added a non-wiped run-meta history
  archive for pre-commit and verify. After wrapper meta is combined,
  `$LOG_DIR/run-meta.json` is copied to
  `${MUSI_VERIFY_HISTORY_DIR:-/tmp/musi-verify-history}/<unix-ts>-<mode>-<exit_code>.json`
  on success, failure, and signal/timeout paths, with
  `${MUSI_VERIFY_HISTORY_LIMIT:-50}` retention and warning-only failure
  handling. `bun run verify:history` prints recent rows with `--limit N`.
  Details: `finished_work/precommit-run-meta-history-leaf-5.md`.
- 2026-05-21: Pre-commit perf Leaf 3 made the Vitest JSON timing sidecar
  opt-in for pre-commit via `MUSI_CAPTURE_TEST_TIMINGS=1`. Default
  pre-commit `test:changed` now records and runs the dot-only command, avoiding
  the measured ~10s full-suite overhead (`118.90s` dot+json vs `107.90s`
  dot-only, with a 2.08 MB sidecar). Manual verify still captures the JSON
  sidecar for diagnostics, and `verify:logs slow-tests` keeps its existing
  missing-sidecar guidance for pre-commit-only runs. Details:
  `finished_work/precommit-vitest-json-sidecar-leaf-3.md`.
- 2026-05-21: Pre-commit perf Leaf 2 parallelized the root lint composite and
  `lint:changed` full/check paths. `scripts/parallel-runner.sh` now provides
  tagged child output, `INT`/`TERM` cleanup, reader reaping, and aggregated
  failure reporting for ShellCheck, config sensors, and ESLint. `scripts/lint.sh`
  keeps the leading `--` separator behavior and forwards remaining args only to
  ESLint; ESLint cache and `--max-warnings=0` are unchanged. Timed
  `bun run lint` passed at `real 0m6.158s` versus the perf report's `11.37s`
  sequential composite. Details:
  `finished_work/precommit-lint-parallelization-leaf-2.md`.
- 2026-05-21: Pre-commit perf Leaf 1 parallelized the root `typecheck`
  script. `scripts/typecheck.sh` now runs `tsc -b` and
  `tsc -p tsconfig.scripts.json` concurrently, labels streamed output by
  command, aggregates both exit codes, and traps `INT`/`TERM` to kill/reap both
  child TypeScript checks. `typecheck:watch` is unchanged. Timed
  `bun run typecheck` passed at `real 0m5.126s` versus the perf report's
  `6.90s` sequential composite. Details:
  `finished_work/precommit-typecheck-parallelization-leaf-1.md`.
- 2026-05-21: Leaf 42c drained `scripts/lint-ratchet-baseline.ts` from
  `ratchet/core-complexity-lint-ratchet-runtime`. The five starting findings
  (`validateLintRatchetRegistry` 44, `compareCurrentToBaseline` 30,
  `parseBaselineTest` 29, `validateBaselineAgainstRegistry` 18, and
  `newPathSeverityPayload` 16) now sit under the cap through file-local helper
  extraction plus `scripts/lint-ratchet-baseline-compare.ts` and
  `scripts/lint-ratchet-baseline-parse.ts`. Public API, behavior, and
  user-facing text are unchanged. The runtime complexity item map is now empty;
  the same file's runtime max-lines entry lowered from 838 to 725 effective
  lines. Details:
  `finished_work/lint-hardening-leaf-42c-ratchet-baseline-complexity.md`.
- 2026-05-21: Leaf 42b drained `scripts/lint-ratchet.ts` from
  `ratchet/core-complexity-lint-ratchet-runtime`. `parseArgs` (22) now uses
  file-local flag walking helpers, and `addFinding` (13) delegates the two
  metric merges to small helpers. Public behavior, CLI error text, and
  baseline shape are unchanged. The refreshed baseline removed the file's
  runtime complexity item; `scripts/lint-ratchet-baseline.ts` remains for the
  next sub-leaf. Details:
  `finished_work/lint-hardening-leaf-42b-ratchet-script-complexity.md`.
- 2026-05-21: Leaf 42a drained `scripts/lint-ratchet-metrics.ts` from
  `ratchet/core-complexity-lint-ratchet-runtime`. The three over-cap functions
  (`parseComplexitySeverityMessage` 15, `validateMetricItem` 15, and
  `parseComplexityFunction` 14) were split into file-local helpers while
  preserving public exports, validation order, errors, and return shapes. The
  refreshed baseline removed the file's runtime complexity item; the other two
  runtime files remain for later sub-leaves. Details:
  `finished_work/lint-hardening-leaf-42a-ratchet-metrics-complexity.md`.
- 2026-05-21: Codex review P2 follow-up for Leaf 41d tightened the
  coverage-map staged-content gate. `scripts/lint-coverage-map-check.ts` now
  accepts `--staged` and reads the map via `git show :...`; `verify --changed`
  and `.husky/pre-commit` use that staged path, while full verify still reads
  the worktree. A temp-repo Vitest regression catches the stale staged map /
  fixed worktree map failure mode. Details:
  `finished_work/lint-hardening-leaf-41e-coverage-map-staged.md`.
- 2026-05-21: Leaf 41d ShellCheck install-path follow-up swapped ShellCheck
  from the pinned npm wrapper to the system `shellcheck` binary on `PATH`
  (`apt install shellcheck`; this container reports `/usr/bin/shellcheck`
  0.9.0, down from the wrapper's upstream 0.11.0). `lint-shell.sh` now fails
  with the apt hint when shellcheck is missing, while `doctor.sh` reports the
  same gap as WARN and continues. The smoke fixtures still pass with ShellCheck
  0.9.0. `actionlint`, `taplo`, and `hadolint` stay on their npm wrappers
  because they are not available from the Debian/Ubuntu main repos. Details:
  `finished_work/lint-hardening-leaf-41d-shellcheck-system-binary-followup.md`.
- 2026-05-21: Codex review P2 follow-up for Leaf 41c fixed the first-run
  `hadolint@0.4.2` wrapper cache failure on the config sensors probe branch.
  Fresh installs could download `hadolint-2.14.0` with mode 0644 and fail the
  immediate spawn with `EACCES`; `lint-config-sensors.sh` now primes the
  wrapper only when the cache is missing, chmods the downloaded binary, then
  invokes hadolint normally. The smoke test no longer injects a pre-chmodded
  cache binary, so it exercises the production wrapper path. `actionlint` and
  `taplo` were checked and do not have the same lazy executable download shape.
  Details:
  `finished_work/lint-hardening-leaf-41c-hadolint-prime-followup.md`.
- 2026-05-21: Leaf 41c yamllint install-path follow-up swapped yamllint from
  the repo-local Python venv to the system `yamllint` binary on `PATH`
  (`apt install yamllint`, version >=1.29.0; this container reports
  `/usr/bin/yamllint` 1.29.0). `lint-config-sensors.sh` now fails with the apt
  hint when yamllint is missing, while `doctor.sh` reports the same gap as WARN
  and continues. `actionlint`, `taplo`, and `hadolint` stay on their npm
  wrappers because they are not in the Debian/Ubuntu main repos. No
  `.yamllint.yml` rule-profile changes were needed. Details:
  `finished_work/lint-hardening-leaf-41c-yamllint-system-binary-followup.md`.
- 2026-05-21: Codex review P2 follow-up for Leaf 41c fixed the
  `node-actionlint` wrapper argv gap from `aca65e31`. The pinned wrapper calls
  `run(args[0])`, so `run_actionlint()` now invokes the wrapper once per
  collected workflow file, echoes each path, and accumulates failures before
  returning nonzero. A regression smoke fixture with valid `ci.yml` plus invalid
  `zz-bad.yml` catches the former bad-second-workflow pass. `yamllint`,
  `taplo`, and `hadolint` were checked for native multi-file argv support and
  left unchanged. Details:
  `finished_work/lint-hardening-leaf-41c-actionlint-wrapper-followup.md`.
- 2026-05-21: Leaf 41c workflow/config sensors added
  `bun run lint:config-sensors` over GitHub workflows, maintained YAML,
  TOML configs, and Dockerfiles. Install paths: `@tktco/node-actionlint@1.6.0`,
  system `yamllint` from `PATH` (`apt install yamllint`, version >=1.29.0),
  `@taplo/cli@0.7.0`, and `hadolint@0.4.2` with upstream Hadolint pinned to
  2.14.0. Full `bun run lint`
  now runs ShellCheck, config sensors, then ESLint; `lint:changed` and
  pre-commit relevance include workflow/YAML/TOML/Dockerfile paths. Findings
  were limited to two long Codex skill YAML prompt lines plus low-value
  hadolint warnings handled by narrow ignores; no ratchet baseline was added.
  Details: `finished_work/lint-hardening-leaf-41c-config-sensors.md`.
- 2026-05-21: Leaf 41 root/package config-file linting sub-batch B brought the
  maintained TS config files under normal ESLint with exact re-includes from
  `**/*.config.{js,mjs,ts}`, a dedicated `tsconfig.configs.json`, and a
  project-service config block with `local/max-lines` disabled. The first full
  lint run found three import-sort autofixes, one Playwright retry literal, and
  three Vitest slow-project config imports that needed `await` before spread; no
  ratchet or baseline update was needed. Changed-gate relevance now explicitly
  covers `knip.config.*`, `playwright.config.*`, and Prisma config paths. The
  Root/package config block is done. Details:
  `finished_work/lint-hardening-config-files-ts-coverage.md`.
- 2026-05-21: Converted
  `ratchet/core-complexity-top-level-scripts` from `message-count` to
  `complexity-severity`, closing the Batch 2 review gap where the Leaf 38
  top-level scripts ratchet was the lone core `complexity` holdout. The
  refreshed baseline has one severity item:
  `scripts/sensor-blob-size.ts` count 1 / maxComplexity 11; the other three
  files in scope have zero complexity findings. No function exceeded the
  >30 follow-up threshold. Details:
  `finished_work/lint-hardening-top-level-scripts-complexity-severity.md`.
- 2026-05-21: Codex review P2 follow-up for commit `45c47264` fixed
  `complexity-severity` new-path regression payloads. Live runtime current
  items from `collectCurrentById` do not populate `maxComplexity`, so
  `newPathSeverityPayload` now reports `currentComplexity` and `line` from the
  highest-complexity `perFunction` entry instead of the first source-order
  diagnostic, while keeping a `maxComplexity` fallback for structural paths.
  Focused Vitest coverage pins the multi-diagnostic live path and fallback.
  Details:
  `finished_work/lint-ratchet-newpath-maxcomplexity-fix.md`.
- 2026-05-21: Added
  `ratchet/core-complexity-lint-ratchet-runtime`, an opportunistic Batch 2
  review follow-up that locks `complexity-severity` ceilings for
  `scripts/lint-ratchet-baseline.ts`, `scripts/lint-ratchet-metrics.ts`, and
  `scripts/lint-ratchet.ts` while those files stay excluded from normal
  `bun run lint`. The baseline captured counts/maxes of 5/44, 3/15, and 2/22
  respectively; `validateLintRatchetRegistry` at complexity 44 is a separate
  follow-up candidate. Details:
  `finished_work/lint-hardening-lint-ratchet-runtime-complexity-coverage.md`.
- 2026-05-21: Leaf 41 Batch 2 metric-alignment review fix-up landed six
  requested hardening fixes for `complexity-severity` and
  `effective-line-count`: structural count-only migration coverage for
  complexity baselines, `messageId === "complex"` parser guarding,
  severity payloads on new-path regressions and ratchet envelopes, duplicate
  complexity-identity collision preservation, structured smoke assertions for
  severity fields, and a baseline refresh limited to
  `scripts/lint-ratchet-baseline.ts` line ceiling shrinkage. Verification
  passed the full requested gate list from focused vitest through lint and
  typecheck.
- 2026-05-21: Leaf 38 codex-review P2 follow-up widened every
  `*-top-level-scripts` ratchet to the full four-file Leaf 38 set:
  `scripts/db-status.ts`, `scripts/harness-emit-envelope.ts`,
  `scripts/sensor-blob-size.ts`, and `scripts/sensor-blob-size.test.ts`.
  `core-no-magic-numbers-top-level-scripts` includes the test in `files` and
  excludes it via `ignores`; the other six ratchets apply to all four files.
  `lint-ratchet:update` refreshed only scope metadata/config hashes, with all
  seven affected counts unchanged (1, 11, 1, 1, 1, 6, 1; live registry remains
  99). Probe proof staged a temporary 11-branch complexity function in
  `scripts/db-status.ts`; `bun run lint:ratchet` failed with one
  `ratchet/core-complexity-top-level-scripts` regression, then passed after the
  probe was reverted. Details:
  `finished_work/lint-hardening-leaf-38-top-level-scripts.md`.
- 2026-05-20: Leaf 38 adopted `scripts/db-status.ts`,
  `scripts/harness-emit-envelope.ts`, `scripts/sensor-blob-size.ts`, and
  `scripts/sensor-blob-size.test.ts` into `tsconfig.scripts.json` and the
  scripts-project parser mapping. The top-level script floor adds seven
  ratchets (`core-complexity`, `core-no-magic-numbers`,
  `core-preserve-caught-error`, `simple-import-sort/imports`,
  `@typescript-eslint/no-unsafe-argument`,
  `@typescript-eslint/restrict-template-expressions`, and
  `@typescript-eslint/unbound-method`) for 22 current findings, raising the
  live ratchet baseline to 99. Typecheck adoption required changing
  `db-status.ts` to a `.js` import specifier and sorting a copied array in
  `sensor-blob-size.ts`. Details:
  `finished_work/lint-hardening-leaf-38-top-level-scripts.md`.
- 2026-05-20: Leaf 41 Batch 5 added core ESLint rule-source support to the
  lint ratchet runner without adding any live core ratchet entries. The new
  `source: { kind: "core" }` path supports both parser profiles, validates
  bare built-in rule ids, hashes the installed ESLint package version with the
  core rule identity, and emits generated configs with no plugin import or
  `plugins` block. Verification passed:
  `bun run lint:ratchet`, `bun run lint:ratchet:check-baseline`,
  `bash scripts/test-lint-ratchet.sh`,
  `bun test scripts/lint-ratchet-baseline.test.ts`,
  `bun run harness:check`, `bun run docs:harness-controls:check`,
  `bash scripts/test-harness-check.sh`, and `FORCE_VERIFY=1 bun run typecheck`.
  Details:
  `finished_work/lint-hardening-leaf-41-core-rule-source-support.md`.
- 2026-05-20: Leaf 41 Batch 1 added
  `ratchet/local-max-lines-codemods`, scoped to
  `scripts/codemods/**/*.ts` while excluding fixtures and codemod test files.
  The initial `lint-ratchet.baseline.json` ceiling is six current
  production-codemod `local/max-lines` findings. Harness controls regenerated
  for the fourth ratchet. Verification passed:
  `bun run lint:ratchet`, `bun run lint:ratchet:check-baseline`,
  `bash scripts/test-lint-ratchet.sh`, `bun run harness:check`, and
  `bun run docs:harness-controls:check`. Details:
  `finished_work/lint-hardening-leaf-41-codemods-max-lines-ratchet.md`.
- 2026-05-20: Landed the load-bearing Leaf 41 coverage map at
  `docs/agent_notes/backlog/lint-followups/lint-coverage-map.md` on
  `feature/lint-hardening-review-followup` via merge `b3c0ca0c`
  (`feature/lint-hardening-leaf-41-coverage-map` was probe-branch
  `40d7feac` + codex-review refinement `21a8a1d3`, then `--no-ff` merge
  and branch deletion). The committed map enumerates every tracked file
  family with a status in `{linted, ratcheted, proposed, pending-leaf,
  excluded, not-code}`; no `unknown` rows remain. A codex review on the
  initial draft surfaced two P2 findings (parseable scripts mis-marked
  as parser-blocked, and `scripts/vitest.config.ts` mis-shelved as a
  fixture) that landed before the merge. Next Leaf 41 step is small
  measured ratchet/floor batches against this frozen scope, starting
  with whichever 2–3 ratchets give the highest signal.
- 2026-05-20: Pinned the Leaf 41 coverage-map artifact path to
  `docs/agent_notes/backlog/lint-followups/lint-coverage-map.md` and added a
  placeholder there so future ratchet/floor cycles update one diffable map
  instead of re-deriving inventories in sibling locations.
- 2026-05-20: Reviewer feedback tightened the Leaf 41 expansion: the first
  deliverable is now a committed coverage-map artifact derived from
  `git ls-files` plus actual ESLint/ratchet scope matching, not a narrative
  inventory from memory. The map must drive temporary `unknown` classifications
  to zero before ratchet/floor batches begin. Non-ESLint floors remain in scope,
  but ShellCheck/actionlint/YAML/TOML/JSON/package-metadata tool setup should
  split into named child leaves when it is more than a narrow same-cycle change.
- 2026-05-20: Human clarified the Leaf 41 goal is first to set up
  ratchets/floors everywhere reasonable, even in areas not intended for
  immediate cleanup. The handoff now names additional overlooked surfaces:
  `eslint-rules/**/*.js`, shell scripts and hooks, root/package config files,
  workflow/agent/devcontainer configs, package/workspace automation metadata,
  `scripts/sensor-blob-size.ts`, and
  `scripts/codemods/lib/trpc-shared-schema.ts`. Leaf 41 now treats Leaves 30-40
  as seed inputs rather than the full boundary and allows floor-only batches
  before later drain work.
- 2026-05-20: Ratchet-first handoff follow-up after reviewer discussion
  clarified that ratchets are migration floors, not indefinite parking. Leaf 41
  now says to add ratchets in small measured batches, re-measure runtime after
  each batch, make standalone script project/parser decisions before ratcheting,
  avoid overlapping same-rule/file `drift-ai` ratchets, and treat bug-class
  findings such as `vitest/expect-expect` and non-`Error` throws as fix-soon
  drains. Also cleaned stale PR 3 header/status wording, marked Leaf 06 resolved
  in the follow-up index, refreshed resolved Leaf 22/23 future-tense prose, and
  updated the verdict register date.
- 2026-05-20: Ratchet-first planning review follow-up refreshed the lint
  handoff docs after human clarification. Decisions recorded: new ratchets stay
  in local/pre-commit enforcement even if runtime grows; core ESLint rule
  support can be the first Leaf 41 phase when complexity/max-params are the
  right guard; zero-finding ratchets need matched-file proof, preferably a
  temporary-violation probe that is reverted before commit; script/test
  max-lines debt should use narrow script-family ratchet IDs rather than
  broadening the default package-oriented ratchet. Stale statuses for Leaves 07,
  22, and 23 were marked resolved, PR 3b final merge-back was clarified as
  `b0876f0c` (`9431308f` remains prep-branch ancestry), and Leaves 30-40 now
  list ratchet/baseline/manifest/doc verification gates.
- 2026-05-20: Leaf 19 re-probed the slice 4 `scripts/code-intel.ts`
  deferral after the autonomous loop fired again. Confirmed the
  deferral stands: 10 lint errors surface
  (`simple-import-sort/exports` × 1 autofixable, plus 9
  `@typescript-eslint/consistent-type-imports` on the `typeof
  import("./code-intel/*.js")` annotations at lines 21–29 — these
  are not autofixable). Adopting the file would require manually
  rewriting all 9 module type aliases to top-level
  `import type * as X from "./y.js"` declarations, a structural
  source change beyond the autonomous slice's three-narrow-config-
  additions pattern. No commits landed; the
  `feature/lint-hardening-leaf-19-code-intel-typeof-import-rewrite`
  branch was deleted. Note recorded in
  `backlog/lint-followups/19-scripts-eslint-remaining-families.md`
  under "Re-probe (2026-05-20)".
- 2026-05-19: Leaf 19 probed four codemod test files
  (`scripts/codemods/{concurrency-guard,expand-barrel,structured-logging-fix,trpc-shared-schema-codemod}.test.ts`,
  191–234 lines each, all already in `tsconfig.scripts.json`) and
  deferred them. Full lint surfaced 20 errors in repeating shapes:
  `@typescript-eslint/no-confusing-void-expression` (arrow void
  returns), `@typescript-eslint/only-throw-error` (throw literal),
  `vitest/expect-expect` (codemod-shape tests without inline
  asserts), and one autofixable `simple-import-sort/imports`. The
  expect-expect and throw-error repairs change test semantics; the
  void-expression brace fixes need per-site review. Folds into
  Leaf 11's parked codemod-coverage decision or a future
  test-quality leaf. No commits landed; the work branch was
  deleted. Details:
  `finished_work/lint-hardening-leaf-19-scripts-codemod-test-files-deferral.md`.
- 2026-05-19: Leaf 19 probed three top-level `scripts/*.ts` files
  under the 300-line ceiling (`db-status.ts` 102, `harness-emit-envelope.ts`
  172, `sensor-blob-size.test.ts` 195) and deferred them. All three
  failed the lint probe immediately with a `parserOptions.project`
  "file not found" error: none appear in `tsconfig.scripts.json` or
  any other root tsconfig — they're standalone Bun scripts outside
  the TypeScript project graph. Adoption requires modifying
  `tsconfig.scripts.json` first, a project-shape decision the
  autonomous slice declined. No commits landed; the unused work
  branch was deleted. Details:
  `finished_work/lint-hardening-leaf-19-scripts-top-level-non-scripts-tsconfig-deferral.md`.
- 2026-05-19: Leaf 19 slice 5 extended ESLint coverage to three
  `scripts/drift-ai/**` files: `errors.ts` (6), `scope.ts` (62), and
  `scope.test.ts` (44) — the under-ceiling modules that probe clean
  once the directory is unignored. Config-only adoption: a new
  `!scripts/drift-ai/` directory unignore (codex review P2 on the
  initial commit caught that file-level negations silently bypass
  the full-repo lint walk without it), three file-level exemptions,
  parser-options block entries, and `local/type-assertion-boundary`
  block entries. Four more under-ceiling files
  (`current-inventory.ts`, `current-inventory.test.ts`,
  `harness-freshness.test.ts`, `comments.ts`) exposed real findings
  after the directory walk started working
  (autofixable `simple-import-sort`, `explicit-function-return-type`,
  and `complexity` 21 + `restrict-template-expressions`); carved
  out for a future budgeted leaf. Nine larger `drift-ai/` files
  (332–696 lines) also remain parked pending splits or warn-only
  overrides. Full `bun run lint`, `bun run typecheck`, and
  `bun run test:scripts:changed` all pass. Details:
  `finished_work/lint-hardening-leaf-19-scripts-drift-ai-small-modules-adoption.md`.
- 2026-05-19: Leaf 19 slice 4 extended ESLint coverage to two
  additional `tsconfig.scripts.json` inputs: `scripts/code-intel-server.ts`
  (4 lines, the entrypoint sibling of the already-linted
  `code-intel/**/*.ts` cohort) and `scripts/logs-audit.test.ts`
  (273 lines, a script-side test). Both files probed at 0 ESLint
  findings before adoption, so only the standard three narrow
  `eslint.config.js` additions landed (ignore exemption, scripts
  parser-options block, `local/type-assertion-boundary` block).
  `scripts/code-intel.ts` (136 lines) was probed alongside the pair
  but carved out — its 9
  `@typescript-eslint/consistent-type-imports` violations on
  `typeof import("./code-intel/...")` annotations would need a
  structural rewrite to top-level `import type` declarations, which
  the autonomous slice declined to make on its own. Full
  `bun run lint`, `bun run typecheck`, and `bun run test:scripts:changed`
  all pass. Details:
  `finished_work/lint-hardening-leaf-19-scripts-code-intel-server-and-logs-audit-test-adoption.md`.
- 2026-05-19: Leaf 19 slice 3 extended ESLint coverage to
  `scripts/lint-ratchet-config.ts`, the central configuration module for
  the PR 4 lint ratchet. The file had 0 ESLint findings before adoption
  (166 lines, well under the 300 `local/max-lines` ceiling), so only
  three narrow `eslint.config.js` additions landed: ignore exemption,
  scripts parser-options block, and `local/type-assertion-boundary`
  block. Full `bun run lint`, `bun run typecheck`, and
  `bun run test:scripts:changed` all pass. Details:
  `finished_work/lint-hardening-leaf-19-scripts-lint-ratchet-config-adoption.md`.
- 2026-05-19: Leaf 19 slice 2 probed `scripts/generate-harness-controls.ts`
  as the next sibling candidate for the linted scripts subset. The probe
  surfaced two findings — `resolveNonLintControl` cyclomatic complexity 13
  vs the 10 ceiling, and 384 effective lines vs the 300 `local/max-lines`
  ceiling. The `local/max-lines` diagnostic itself offers either a
  structural split or a targeted warn-only override; both are local debt
  decisions the autonomous slice declined to make on its own. Defer
  until a leaf with explicit budget picks the repair. The temporary
  `eslint.config.js` probe was reverted; no production or config changes
  landed. Details:
  `finished_work/lint-hardening-leaf-19-scripts-generate-harness-controls-deferral.md`.
- 2026-05-19: Leaf 19 slice 1 extended ESLint coverage to one additional
  `tsconfig.scripts.json` input, `scripts/lint-rule-docs.ts` — the shared
  loader behind the PR 1 `meta.docs` contract, consumed by
  `scripts/generate-lint-guidance.ts` (already linted),
  `scripts/generate-harness-controls.ts`, and `scripts/lint-agent.ts`. The
  file had 0 ESLint findings before adoption, so only three narrow
  `eslint.config.js` additions landed: ignore exemption, scripts
  parser-options block, and `local/type-assertion-boundary` block. Full
  `bun run lint`, `bun run typecheck`, and `bun run test:scripts:changed`
  all pass. Remaining script families (codemods, drift-ai, logs-audit,
  top-level utilities) stay parked. Details:
  `finished_work/lint-hardening-leaf-19-scripts-lint-rule-docs-adoption.md`.
- 2026-05-19: Leaf 21 inventoried the assertion-quality local rule candidate
  after the Zod parse helper migration. The refreshed probes found 38
  `expectParseSuccess` / `expectParseFailure` helper files, 0 raw
  `.safeParse(...).success` test assertion sites, 0
  `.safeParseAsync(...).success` rows, and one production-only
  `packages/shared/src/schemas/map-inputs.ts` Zod `.refine(...)` predicate
  that would be a false positive. Broader `.success` test assertions are tRPC
  response-body checks or a `toast.success` spy, and the remaining Zod
  `.success` guards are post-helper narrowing for data/error detail
  assertions. Verdict: defer the local rule until a real regression or wider
  parse-result helper surface appears. Details:
  `finished_work/lint-hardening-leaf-21-assertion-quality-inventory.md`.
- 2026-05-19: Leaf 14c adopted the raw global `fetch` restricted primitive
  slice for client/server source. The inventory over production
  `packages/shared/src/**`, `packages/server/src/**`,
  `packages/client/src/**`, and `scripts/**` found 0 shared rows, 0 script
  rows, 0 server global fetch sites (the three server `rg` rows are a
  shadowing DI parameter named `fetch`), and two sanctioned client bare
  globals: the auth-token refresh endpoint in `packages/client/src/lib/trpc.ts`
  and multipart map-image upload in
  `packages/client/src/hooks/use-map-image-upload.ts`. `no-restricted-globals`
  now bans raw global `fetch` in client/server source with those two boundary
  files on the allowlist. Details:
  `finished_work/lint-hardening-leaf-14c-raw-fetch-adoption.md`.
- 2026-05-19: Leaf 14b adopted the raw `process.env` restricted primitive
  slice over production `packages/shared/src/**`, `packages/server/src/**`,
  and `scripts/**`, excluding tests, test helpers, and generated server
  Prisma code. Initial probe found 0 shared rows, one unsanctioned server
  production read (`packages/server/src/prisma/client.ts`
  `DATABASE_POOL_MAX`), the sanctioned env helper default source, the
  db-status admin display reads, and two child-process spawn pass-through
  scripts. `DATABASE_POOL_MAX` is now an optional positive integer in
  `loadServerEnv`, Prisma consumes `serverEnv.databasePoolMax`, and
  `no-restricted-syntax` bans `process.env` member access outside named
  allowlist sites. Details:
  `finished_work/lint-hardening-leaf-14b-process-env-adoption.md`.
- 2026-05-19: Leaf 14a inventoried raw clock primitives
  (`Date.now()`, `new Date(`) over production `packages/shared/src/**`
  and `packages/server/src/**`, excluding tests and test helpers. Final
  probe: 0 shared rows, 20 server rows after the explicit
  `*-test-helper.ts` exclude; the legacy probe shape reports 22 server
  rows because `level-up-test-helper.ts` contributes two false-positive
  test-helper rows. Production buckets: 7 input-date-parsing /
  3 persisted-now-write / 3 expiry-computation / 3 expiry-comparison /
  2 rate-limit-window / 2 logging-timestamp / 0 other. Verdict: defer a
  raw clock primitive ban until a sanctioned `Clock` helper exists, since
  a naive `new Date(` ban would flag parsed input dates and the genuine
  clock reads need `Clock.now()` / `Clock.nowMs()` threaded through server
  context/service factories before a diagnostic can name the repair path.
  Details:
  `finished_work/lint-hardening-leaf-14a-clock-primitives-inventory.md`.
- 2026-05-19: Leaf 15b re-inventoried
  `react/jsx-no-leaked-render` over `packages/client/src/**/*.tsx`.
  87 findings across 38 files matched the previous total; a 35-site
  sample classified as 3 attribute-boolean / 0 string-array-length /
  9 nullable-object / 9 truthy-string / 0 actual-bug / 14 other.
  Verdict: defer the rule for this client TSX scope — current findings
  are React-safe attribute, nullable-object, optional-string, and
  boolean/comparison guards, and `eslint-plugin-react@7.37.5` still has
  no `allowExpressions` option. No production rewrite landed. Details:
  `finished_work/lint-hardening-leaf-15b-jsx-no-leaked-render-inventory.md`.
- 2026-05-19: Leaf 15 re-inventoried
  `react-hooks/set-state-in-effect` over `packages/client/src/**/*.{ts,tsx}`.
  24 findings classified as 11 dialog-reset / 6 props-to-local-state /
  5 external-system-sync / 0 derived-state / 0 cleanup-reset / 2 other.
  Verdict: defer the rule for this client source scope — the rule still
  cannot distinguish intentional dialog draft resets, props-to-local draft
  sync, external resource/socket bridges, and state-machine resets from its
  target bug class. No production rewrite landed. Details:
  `finished_work/lint-hardening-leaf-15-react-set-state-in-effect-inventory.md`.
- 2026-05-19: Leaf 13b re-inventoried `no-param-reassign` with
  `{ props: true }` over scripts plus shared/server/client source
  scopes. 17 findings classified as 9 intentional-helper-state /
  4 canvas-mutation / 2 accumulator / 1 prisma-update-input /
  1 mock-state / 0 other. Verdict: defer the option for this scope —
  every current hit is an intentional mutation boundary, with no
  surfaced bug or small production rewrite candidate. Details:
  `finished_work/lint-hardening-leaf-13b-no-param-reassign-props-inventory.md`.
- 2026-05-19: Leaf 13a re-inventoried `no-await-in-loop` over
  `packages/server/src/services/**`. 7 findings classified as 3
  intentional-sequential / 1 promise-all-safe / 3 transaction-boundary.
  Verdict: defer the rule for this family — Prisma `$transaction`
  serialization and ordered post-commit fan-out dominate. No production
  rewrite landed. Details:
  `finished_work/lint-hardening-leaf-13a-no-await-in-loop-services-inventory.md`.
- 2026-05-19: Leaf 27 doc-only status flip — the
  `ratchet/local-type-assertion-boundary` ignore for
  `scripts/codemods/fixtures/**` had already landed in `49d3149b` during
  the boundary drain; refreshed the leaf doc to point at that commit.
- 2026-05-19: Leaf 10a re-triaged `vitest/no-conditional-expect`. 55
  findings classified as 5 bug / 6 safeParse / 20 unreachable / 16
  concurrency / 8 other. Verdict: defer the rule, fix the 5 bugs. Bug
  fixes thread a bounded mid-roll RNG (`midRng = (min, max) =>
  Math.floor((min + max) / 2)`) into two `combat-actions.test.ts`
  hit-path tests so natural-1 branches no longer silently skip
  assertions. Codex review caught an unbounded `() => 10` first pass
  that violated the dice `[min, max]` contract; bounded fix landed in
  `dafe67e2`. Details:
  `finished_work/lint-hardening-leaf-10a-vitest-conditional-expect-inventory.md`.
- 2026-05-19: Four post-merge harness cleanups on top of the Leaf 06
  merge — `f0bef95e` merge-base preflight, `2f3068ab` doctor BLOCK→warn
  severity, `8391976a` lint:agent:changed repo-root chdir, `517879e7`
  harness-emit-envelope `--output` validation. Each delegated to a
  separate codex exec per the prompt-size rule; post-fix codex review
  came back clean.
- 2026-05-19: Stale leaf doc cleanup — Leaves 24 and 28 already
  resolved in followup history; flipped their status markers to point
  at the resolution commits (`d4bc777f` for the TanStack Query slice,
  `2a56f0bc`/`565f9080` for the homebrew armor builder).
- 2026-05-19: Leaf 29.2 spell-filter-bar and monster-ability-scores
  helper sibling unit tests landed; helpers exported alongside test
  coverage.
- 2026-05-19: Leaves 01, 02, 26 verified as already landed in followup
  history; refreshed their status markers to reference the
  implementation commits.
- 2026-05-19: Prepared `local/type-assertion-boundary` client batch 5a.
  Labeled all 40 current one-count client findings and one additional
  `entry-dialog.tsx` Radix Select boundary to hit the requested 82 -> 41
  ratchet target. The remaining 41 findings are still isolated to
  `packages/client/src/components/homebrew/entries/entry-dialog.tsx`.
  Verification: `lint:fix`, cold-cache `lint:ratchet`, `typecheck`,
  `test:changed`, and `lint:ratchet:update`. Details:
  `finished_work/local-type-assertion-boundary-batch-5a.md`.
- 2026-05-19: Prepared `local/type-assertion-boundary` server batch 4a.
  Labeled three framework boundaries around Fastify/socket.io runtime
  typing, labeled two test-only tRPC response envelope unwrap helpers, and
  replaced the map layer Prisma JSON cast with the sanctioned `fromJson`
  helper. Cold-cache `lint:ratchet` now reports 91 current findings, 0
  regressions, and blocking=0. Verification: `lint:fix`, cold-cache
  `lint:ratchet`, `typecheck`, and `test:changed`. Details:
  `finished_work/local-type-assertion-boundary-batch-4a.md`.
- 2026-05-19: Prepared `local/type-assertion-boundary` script batch 3c.
  Removed the `db-status` catch cast and redundant `logs-audit` JSON cast,
  labeled the `pgexec` multi-statement driver assertion as `framework`, and
  labeled the guarded `harness-check` manifest cast as `interop`. Cold-cache
  `lint:ratchet` now reports 97 current findings, not the promoted target of
  98, because the `harness-check` chained assertion contained two nested
  `TSAsExpression` nodes covered by one boundary comment. Verification:
  `lint:fix`, cold-cache `lint:ratchet`, `typecheck`, `test:changed`, and
  `git diff --check`. Details:
  `finished_work/local-type-assertion-boundary-batch-3c.md`.
- 2026-05-19: Prepared `local/type-assertion-boundary` client batch 3b.
  Removed all 12 target casts across notes, NPC monster filters, homebrew
  monster ability scores, spell add/filter UI, and API base URL handling.
  The Vite env read now uses a client ambient env declaration instead of a
  chained cast. No boundary labels or new latent-bug leaves were needed.
  Verification: `lint:fix`, temp-index `lint:changed`, `typecheck`,
  `test:changed`, and cold-cache `lint:ratchet`; ratchet count is now 102.
  Details: `finished_work/local-type-assertion-boundary-batch-3b.md`.
- 2026-05-19: Added four more lint follow-up leaves to
  `backlog/lint-followups/`: Leaf 22 for explicit third-party/type-aware
  ratchet support, Leaf 23 for a scoped
  `@typescript-eslint/strict-boolean-expressions` ratchet candidate, Leaf 24
  for the deferred TanStack Query `prefer-query-options` strict rule, and
  Leaf 25 for the mocked-database test-boundary footgun from the original
  hardening index. Updated the index and cross-linked Leaf 10 to clarify that
  the `vitest/no-conditional-expect` bug-triage slice already exists there,
  bringing the lint follow-up index to 25 leaves.
- 2026-05-19: Organized remaining lint follow-up work into
  `backlog/lint-followups/` with a `00-index.md` promotion guide and initial 21
  focused leaves. The new folder covers ratchet infrastructure, PR 3b JSON
  emitters, type-assertion ratchet debt, next-ratchet candidates, staged
  changed-gate correctness, test-quality follow-ups, script ESLint coverage,
  deferred TypeScript/core/React/restricted-primitive rules, structural
  sensors, generated lint guidance, package manifest policy, assertion-quality
  lint, and watchlist-only plugin areas. Existing `lint-hardening/` and
  `lint-ratchet-followups.md` notes remain provenance.
- 2026-05-17: Lint-hardening review follow-up Tier 2 PR 3a —
  Machine-Readable Diagnostics, `lint:agent` slice (`93ea96a6`
  harness-diagnostics Zod schema, `5b6bd434` shared `lint-rule-docs.ts`
  loader, `372a4872` `scripts/lint-agent.ts`). New `harness-diagnostics`
  envelope (version `"1"`) lives in
  `packages/shared/src/schemas/harness-diagnostics.ts` with control-id
  regex `^[a-z][a-z0-9-]*(?:\/[a-z0-9-]+)+$/u`, severity ∈
  {block, warn, info}, repairKind ∈ {autofix, suggestion, codemod,
  manual}, and a `.superRefine` invariant that ties `summary.blocking|
  warning|info|byControl` to the actual `findings` array. `lint:agent`
  spawns `node_modules/.bin/eslint --format=json`, re-projects PR-1
  `meta.docs` onto local-rule findings, synthesizes a
  `lint/parser-error` block-severity finding for fatal parser
  diagnostics (so they no longer get silently dropped — codex P2 fix),
  skips non-local findings with a stderr count, exits 1 on blocking.
  Wired into `package.json` (`lint:agent`), `harness-check.ts`
  EXEMPT_SCRIPTS (it re-projects existing per-rule controls, not a new
  control), and `test:scripts` with a new
  `test-lint-agent.sh` smoke covering happy-path, all three repair
  kinds, and the parser-error path. Details:
  `in_progress/lint-hardening-review-followup-pr-3-machine-readable-diagnostics.md`
  (status block documents 3a/3b split). PR 3b — `--json` modes on
  `doctor`, `verify:logs`, `module:index:check`,
  `migration-safety-scan` — deferred for right-sizing.
- 2026-05-17: Lint-hardening review follow-up Tier 2 PR 2 — Harness
  Manifest + Generated Map (`0d82461a`). `harness.controls.json` declares
  55 controls across 9 kinds (18 lint rules, 5 sensors, 6 verify wrappers,
  5 doctor checks, 4 drift scopes, 3 doc generators, 1 logs audit, 5
  codemods, 8 hooks) using PR 1's `meta.docs` vocabulary; lint-rule fields
  are re-projected from each rule's own metadata so there is one source
  of truth. `scripts/generate-harness-controls.ts` writes
  `docs/generated/harness-controls.md`; `scripts/harness-check.ts` asserts
  manifest / live-tree / package.json parity with a widened
  `CONTROL_PREFIX_PATTERN` (`sensor|verify|codemod|drift|logs|doctor|module|docs|db|worktree|harness|lint:`)
  and a named `EXEMPT_SCRIPTS` set. Wired into doctor, CI (harness:check
  before docs:harness-controls:check), and `test:scripts` with two new
  fixture-based smokes. Retires Leaf 25 sensor-half. Details in
  `finished_work/lint-hardening-review-followup-pr-2-harness-manifest.md`.
- 2026-05-17: Lint-hardening review follow-up Tier 2 PR 1 — Local Lint Rule
  Contract (`acee0f7f`). All 18 `local/*` rules carry a validated
  `meta.docs` contract (description, principle, category, pairedGuide,
  repairKind, repairCommand iff codemod). Generator enforces; vitest
  contract test enforces both metadata shape and Why/How diagnostic
  wording on every rule. Retires Leaf 25 (subset adopted; sensor half
  deferred to PR 2). Details in
  `finished_work/lint-hardening-review-followup-pr-1-rule-contract.md`.
- 2026-05-17: Lint-hardening review follow-up Tier 1 bundle —
  six small fixes from the post-merge review of Leaf 12 Pass C, on branch
  `feature/lint-hardening-review-followup`. Verified with the six standard
  gates plus `verify:changed`.
  - Item 1 (`ad069759`): deleted dead `sorceryPoint.use`/`recover` tRPC
    procedures + support (service commands, input schemas, tests, mutation-log
    cases, client mock-trpc entries). Kept `sorceryPointResultSchema`
    (`flexibleCastingResultSchema` extends it) and the React
    `useSorceryPoints` hook. Adjacent Knip cleanup deleted the stale Leaf 12
    scout and un-exported `PathIgnored` in harness-freshness.
  - Item 2 (`dbeb45ff`, `e0b8ed82`): `type-assertion-boundary` ESLint rule
    now accepts JSDoc inline + multi-line shapes, `.spec.ts`,
    same-line-before and one-blank-line-above positions; allowed-category
    list is built from the `ALLOWED_CATEGORIES` set.
  - Item 3 (`b74fd7d4`, `944779fc`): `test-generate-lint-guidance.sh` rewritten
    as a drift smoke (snapshot + mutate + assert --check fails + trap-restore).
    CI now runs `docs:lint-guidance:check` after Lint.
  - Item 4 (`e28fcc54` then `39b0f4ca`): commitlint trailer widening tried
    then reverted. Scout premise was wrong — `@commitlint/parse@21.0.1`
    already routes `Fixes:`/`Closes:`/`Refs:`/`BREAKING CHANGE:` to
    `parsed.footer`; widening regressed `Why:`-style body paragraphs.
  - Item 5 (`057155e7`, `efd23ec2`): `sensor-blob-size` emits `BLOCK:` for
    block-severity findings; `doctor.sh` counts both `WARN:` and `BLOCK:`.
  - Item 6 (`ea6f43cd`): six shared schema test files bind
    `expectParseSuccess(result)`'s return value and drop redundant
    `if (result.success)` guards.
- 2026-05-17: Leaf 12 Pass C — landed local/type-assertion-boundary
  at error for e2e/**/*.ts and the linted scripts subset
  (code-intel, drift, generate-lint-guidance). 11 legitimate
  json/interop boundary casts received parseable comments. 321
  findings in packages/* are deferred — they need code rewrites,
  not comments.
- 2026-05-17: Leaf 12 Pass A — landed local/type-assertion-boundary
  rule + tests, wired as plugin but not yet enabled. Pass B will
  inventory violations and adopt at error for a narrow first scope.
- 2026-05-17: Leaf 18 fix pass — `drift:ai harness-freshness` now ignores
  backtick paths matched by Git ignore rules, including generated
  `reports/mutation/*` references, and `sensor:blob-size --block` now fails
  only on block-severity findings.
- 2026-05-17: Leaf 18 — landed harness inventory freshness sensor
  (`bun run drift:ai harness-freshness`) and staged blob-size sensor
  (`bun run sensor:blob-size`). Both WARN-only, surfaced via
  doctor. ASCII / smart-character sensor explicitly rejected by user.
- 2026-05-17: Leaf 21 Pass 2b Fix C — landed Sites 2/3/4/11
  rewrites (level-heading, preamble-header, section-header) and
  promoted regexp/no-super-linear-backtracking,
  no-misleading-capturing-group, no-contradiction-with-assertion
  from `off` to `error`. Pass 2b closed.
- 2026-05-17: Leaf 21 Pass 2b Fix B — rewrote the spell-parser
  `FIELD_BOUNDARY_LOOKAHEAD` cluster (Sites 6-9) with one generic inline
  marker scanner. Added parser characterization tests for near-marker values,
  singular/plural component boundaries, and Fly-style appended duration prose.
  Deferred regexp rules remain off; 4 sites remain.
- 2026-05-17: Leaf 21 Pass 2b Fix A — rewrote 3 warm-up deferred regexp
  sites with tests first: monster comma pairs, rules glossary headers, and
  code-intel gitfile parsing. Deferred regexp rules remain off until the
  remaining 8 sites are clean.
- 2026-05-17: Leaf 7b — knip dead-export sweep. Triaged 161 findings:
  5 deleted, 41 carved out (intentional surface), 115 dual-use export
  drops. @commitlint/cli + @commitlint/types declaration fixes.
- 2026-05-17: Leaf 9 Pass A — promise-function-async adopted at error.
  3 override blocks (test files, mock-trpc factories, dynamic-import
  loaders) + 22 code/helper files updated for production/helper fixes.
  strict-boolean-expressions was deferred at that point (423 case-by-case,
  later partially ratcheted for shared in Leaf 23).
- 2026-05-17: Leaf 19 Pass 2 — eslint-plugin-import-x adopted at error.
  Tiered file-glob: strict packageDir for src, root fallback for
  tests/test-helpers. prettier added to packages/server devDeps to
  resolve seed-generator findings.
- 2026-05-16: Leaf 24 — backlog housekeeping; both sort-comparator
  follow-up sites were already fixed in commit `0652826e`. Doc-only
  close-out; underlying rule remains unadopted.
- 2026-05-16: Leaf 15 — Zod parse helpers
  (`expectParseSuccess` / `expectParseFailure`) added in
  `packages/shared/src/test/parse-helpers.ts`; 679 current parse-result
  boolean assertion sites migrated across shared/server/client.
- 2026-05-16: Leaf 23 — generated lint guidance spike landed for
  3 local rules; decision (keep/drop/fold) pending after rule diffs.
- 2026-05-16: Leaf 22 — local-rule message-guidance test extended
  to cover every eslint-rules/* diagnostic; classified guidance
  vs policy; convention documented in
  docs/guides/local-eslint-rules.md.
- 2026-05-16: Leaf 11 - process.exit() banned outside a 6-file
  CLI/bootstrap allowlist via no-restricted-syntax; remaining
  restricted-primitive candidates (raw fetch, env reads, Date.now, timers)
  deferred to a follow-up slice.
- 2026-05-16: Leaf 21 Pass 2a - eslint-plugin-regexp recommended adopted;
  9 mechanical findings cleaned (8 auto-fixed, 1 hand-fixed); 3 rules
  (no-super-linear-backtracking, no-misleading-capturing-group,
  no-contradiction-with-assertion) deferred to Pass 2b for parser semantic
  rewrites.
- 2026-05-16: Leaf 21 — eslint-plugin-regexp Pass 1 inventory stopped by
  the >15 finding threshold (35 problems; 24 no-super-linear-backtracking).
  Temporary install/config was reverted; inventory is in
  `finished_work/lint-hardening-leaf-21-regexp-inventory.md`.
- 2026-05-16: Leaf 17 — @eslint/json adopted at error for JSON and
  JSONC files (4 recommended rules). No fixes needed.
- 2026-05-16: Leaf 10 — adopted 3 core ESLint AI-footgun rules at
  error (no-constant-binary-expression, no-param-reassign, radix);
  deferred no-await-in-loop (164 sites, mostly intentional
  sequential code).
- 2026-05-16: Leaf 16 closed out — suppression-register flipped to hard-gate after separator migration; wired into doctor.sh.
- 2026-05-16: Leaf 20 — commitlint commit-msg hook landed; enforces conventional commits + body ≥ 40 chars.
- 2026-05-16: Leaf 16 suppression register landed v1 report-only with a
  pure-shell TypeScript/Stryker scanner, smoke coverage, and baseline inventory
  in `finished_work/lint-hardening-leaf-16-suppression-register-baseline.md`.
- 2026-05-16: Leaf 13 eslint-plugin-react partially landed for client TSX:
  five rules now run at `error`, eight findings were cleaned to 0, and
  `jsx-no-leaked-render` is deferred in the verdict register.
- 2026-05-16: Leaf 14 react-hooks broadened coverage partially landed: `recommended-latest` now runs on client TS/TSX with `set-state-in-effect` deferred, and the 5 refs plus 1 static-components findings were cleaned to 0.
- 2026-05-16: Leaf 9 TypeScript ESLint stricter opt-ins partially landed: `consistent-type-exports`, `prefer-readonly`, and `switch-exhaustiveness-check` now run at `error`; 17 readonly fixes and 2 switch fixes cleaned lint to 0, while `strict-boolean-expressions` and `promise-function-async` are deferred in the verdict register.
- 2026-05-16: Leaf 6 TanStack Query ESLint plugin landed for client TS/TSX with all seven recommended rules enabled at final severities and the 13-finding baseline cleaned to 0; inventory moved to `finished_work/lint-hardening-leaf-6-tanstack-query-inventory.md`.

## 2026-05-16 — Leaf 5 jsx-a11y Adopted

Enabled `eslint-plugin-jsx-a11y` recommended rules for client TSX at `error`.
TanStack Router `Link` is handled through `anchor-is-valid` `specialLink:
["to"]` compatibility config while the intended `linkComponents` setting is
recorded for future plugin support. Source cleanup associated labels, removed
redundant roles, fixed keyboard support for interactive surfaces, renamed the
lucide `Link` icon import, and documented the accepted modal/test/primitive
line suppressions.

Final jsx-a11y finding count is 0. The Pass 1 inventory moved to
`finished_work/lint-hardening-leaf-5-jsx-a11y-inventory.md`.
Verification included `bun run lint -- --max-warnings=0`,
`bun run typecheck`, `bun run test:client`, and
`bash scripts/eslint-disable-register.sh /workspace`. The requested
`bun run --filter @musi/client test` command did not match a Bun workspace
package in this checkout, so `test:client` was used as the equivalent client
project gate.

- Same-day reviewer fixup replaced the initiative row `role="button"` pattern
  with native `ul`/`li` rows and an overlay select button, restored
  focus-before-select for inline initiative editing, kept the notification
  popover `role="list"` Safari/VoiceOver workaround documented, removed the
  avoidable `CardTitle` disable, and named the map background URL input.

---

## 2026-05-16 — Leaf 5 jsx-a11y Pass 1 Inventory

- Installed `eslint-plugin-jsx-a11y` at the workspace root and captured the
  client TSX recommended-rule inventory with a temporary warn-only config.
  The inventory found 58 jsx-a11y warnings, led by TanStack Router `Link`
  fit issues, autofocus usage, and unassociated form labels; details are in
  `finished_work/lint-hardening-leaf-5-jsx-a11y-inventory.md`.

---

## 2026-05-16 — Leaf 8 Drift ESLint Coverage Landed

Enabled ESLint coverage for `scripts/drift/**/*.ts` by re-including the drift
script directory and sharing the existing `tsconfig.scripts.json` config block
used by code-intel scripts. Cleaned up the drift locator usage reporter's
baseline findings with explicit numeric string conversion, a named JSON indent
constant, and a targeted Node argv offset suppression.

Codemod coverage remains deferred to the recorded Leaf 8 codemod inventory.
Verification included `bun run lint -- --max-warnings=0`, `bun run typecheck`,
`bun run test:scripts:changed`, and
`bash scripts/eslint-disable-register.sh /workspace`.

---

## 2026-05-16 — Leaf 8 Codemod ESLint Inventory Deferred

Attempted the first Leaf 8 slice for `scripts/codemods/**/*.ts` by
temporarily mirroring the `scripts/code-intel/**/*.ts` ESLint project block
with `tsconfig.scripts.json` and keeping `scripts/codemods/fixtures/**`
ignored.

The lint probe hit the slice stop condition: `bun run lint --
--max-warnings=0` reported 70 findings, mostly complexity, parameter-count,
and file-size pressure in the codemod implementations plus repeated codemod
test harness assertion/error-shape findings. No ESLint config or codemod fixes
landed. Inventory details remain in
`in_progress/lint-hardening-leaf-8-codemods.md`, with the deferral recorded in
the Leaf 8 doc and lint-hardening verdict register.

---

## 2026-05-16 — Knip Sensor Adopted Report-Only

Landed lint-hardening Leaf 7 Pass 2. `knip.config.ts` now treats shared
schemas/rules as the shared contract surface, treats client `components/ui`
exports as the shadcn-style component surface, marks server compile-only type
tests and one-off SRD generator scripts as entries, and documents the
`@prisma/client`, `jscpd`, and `pino-pretty` dependency false positives.

Removed the two confirmed unused devDependencies:
`@tanstack/react-router-devtools` from the client package and
`@types/bcryptjs` from the server package. Added `bun run sensor:knip` and
wired it into `doctor` as report-only; nonzero knip findings are surfaced as a
doctor `WARN`, not a `FAIL`. The remaining 87 unused exports and 74 unused
exported types are deferred to Leaf 7b for per-finding triage.

Verification included `bun run lint -- --max-warnings=0`,
`bun run typecheck`, `bun run verify:changed`, `bun run sensor:knip` (expected
exit 1 with the deferred inventory), `bun run doctor` (exit 0),
`bash scripts/eslint-disable-register.sh /workspace`, and
`bun run drift:ai --scope current` (exit 0 with the existing duplicate-code
warnings).

---

## 2026-05-16 — Leaf 3 Conditional Expect Review Fix

Closed two vacuous-pass test bugs surfaced by review of the Leaf 3 Vitest
inventory: the high-bonus combat spell HP test now asserts the spell hit before
checking damage, and the SRD spell sort test now asserts a multi-item result
before pairwise order checks.

Updated the Leaf 3 verdict to record that `vitest/no-conditional-expect` had
mixed signal, not just async/concurrency noise. The backlog index now tracks a
thin Leaf 3b follow-up for vacuous conditional expectations, and the
`rate-limit.test.ts` cleanup now uses the lint-hostile double invocation
framing.

Verification included `bun run lint -- --max-warnings=0`, `bun run typecheck`,
targeted server Vitest for `encounter-combat-spell.test.ts` and
`srd-spell.test.ts`, `bun run verify:changed`, and
`bash scripts/eslint-disable-register.sh /workspace`.

---

## 2026-05-16 — Vitest ESLint First Slice Landed

Landed lint-hardening Leaf 3's first slice. The root ESLint config now loads
`@vitest/eslint-plugin` only for non-e2e `**/*.test.{ts,tsx}` and
`**/*.spec.ts`, while Playwright specs stay on the Playwright block.

Inventory adopted a subset: focused/disabled/duplicate/commented-out test
guards, valid Vitest title/callback/expect rules, standalone/async expect
guards, wrong-import/mock/snapshot tripwires, `expect-expect` with Musi
assertion helpers, `valid-expect` with Vitest assertion-message support, and
zero-baseline matcher rules for comparison/equality/containment. Deferred
`no-conditional-expect` and two style-only matcher rules to the verdict
register.

`local/test-file-location` now matches the same non-e2e test scope, including
non-e2e `.spec.ts` files, and continues to leave Playwright e2e specs to
Playwright lint rules.

Verification included `bun run lint -- --max-warnings=0`,
`bun run typecheck`, `bun run lint:changed`, `bun run verify:changed`,
`bash scripts/eslint-disable-register.sh /workspace`,
`bash scripts/test-eslint-disable-register.sh`,
`bun run vitest run --project=eslint-rules`, targeted client/server Vitest
files touched by cleanup, and `bun run drift:ai --scope current` (exit 0 with
the two existing duplicate-code warnings outside this leaf).

---

## 2026-05-16 — ESLint Comments Hygiene Landed

Landed lint-hardening Leaf 4. The root ESLint config now loads
`@eslint-community/eslint-plugin-eslint-comments`, enforces described
disable/enable directives plus structural suppression hygiene, and enables
ESLint's built-in `reportUnusedDisableDirectives: "error"`.

Inventory found eight findings, all missing descriptions on existing
`eslint-enable` comments. Those comments now explain the scoped disable
boundary. `eslint-comments/no-unused-disable` stayed wired: a stale-disable
stdin probe produced one built-in unused-disable diagnostic and no plugin
duplicate.

Verification included `bun run lint -- --max-warnings=0`,
`bun run typecheck`, `bun run lint:changed`, `bun run verify:changed`,
`bash scripts/eslint-disable-register.sh /workspace`,
`bash scripts/test-eslint-disable-register.sh`, and
`bun run drift:ai --scope current` (exit 0 with two report-only duplicate
warnings outside this leaf).

---

## 2026-05-16 — Leaf 2 P2 Changed-Gate Fixes

Fixed two follow-ups from the Leaf 2 review. `verify:changed` run metadata now
uses `serial-verify-changed`, and `ai_stop_verify_status` compares that mode
against `ai_staged_fingerprint` instead of treating the staged hash as a full
worktree hash. Full `serial-verify` and `parallel-precommit` metadata keep
their existing fingerprint semantics.

`test:changed` and `test:scripts:changed` now include deletions in their
changed-file selectors. Source deletions force the affected Vitest project to
run without `--changed`; script or hook deletions force the full shell smoke
suite rather than selecting nothing.

Verification included `bash scripts/test-lint-changed.sh`,
`bash scripts/test-dependency-freshness.sh`, `bash scripts/test-test-scripts.sh`,
`bash scripts/ai-hooks/test.sh`, `bash scripts/test-test-changed.sh`,
`bash scripts/test-verify.sh`, `bun run lint -- --max-warnings=0`, and
`bun run typecheck`.

---

## 2026-05-16 — Changed Gates Verify Staged Content

Landed lint-hardening Leaf 2. `lint:changed`, `verify:changed`, and
pre-commit now reject source-relevant unstaged or untracked changes before
changed verification, so the gates check the staged commit snapshot instead of
a staged/unstaged working-tree mix. `lint:changed` selects staged/base files,
keeps the full-lint fallback for lint-affecting config changes, and names the
scope it is checking in diagnostics.

Pre-commit now includes staged deletions in source-relevant and script-gate
selection. The manual `verify:changed` marker is keyed to a staged fingerprint,
and pre-commit can bridge from that marker when the staged fingerprint matches.

Verification included `bash -n scripts/lint-changed.sh`,
`bash scripts/test-lint-changed.sh`, `bash scripts/test-dependency-freshness.sh`,
`bash scripts/test-ai-hooks.sh`, `bash scripts/test-test-scripts.sh`,
`bash scripts/test-verify.sh`, `bun run test:scripts:changed`,
`bun run verify:changed`, a throwaway `bun run lint:changed` unstaged-source
failure smoke, and a real `.husky/pre-commit` marker-bridge smoke.

---

## 2026-05-16 — Zero-Warning Lint Gate Landed

Landed lint-hardening Leaf 1. `bun run lint` and `bun run lint:changed` now
pass `--max-warnings=0`, so warning-severity ESLint findings are deterministic
gate failures. Cleared the 102-warning baseline by extending the existing SRD
reference-table `no-magic-numbers` exception to the prepared-spell tables and
moving the two targeted `local/max-lines` overrides to modest error caps.

Updated `lint-changed` smoke coverage for the new eslint argument contract.
`bun run lint`, `bun run lint:changed`, `bun run vitest run --project=shared`,
`bun run typecheck`, and `bun run test:scripts:changed` passed.

---

## 2026-05-16 — Lint Hardening Iteration Guidance Tightened

Clarified the lint-hardening backlog after review feedback without promoting a
leaf. The index now links the `NEXT.md` fresh-checkout preflight, keeps one
promoted lint-hardening slice unless a human explicitly authorizes parallel
work, and names backlog-draining as the failure mode to avoid.

Added sharper guidance for future agents: dependency details for Leaf 1
consumers, exit criteria for the type-assertion boundary rule, a suppression
tool responsibility table, a default scripts logging recommendation, sample
verdict-register row shapes, and Leaf 23/25 sequencing so generated lint
guidance and metadata do not become parallel systems.

---

## 2026-05-16 — Lint Hardening Review Renumbering

Renumbered the parked lint-hardening leaves so numeric order matches the
review-adjusted promotion order. The index now treats that order as advisory,
not a queue, and `NEXT.md` explicitly says idle backlog state does not authorize
pulling the next numbered leaf without a human request.

Folded in reviewer guardrails: bundled leaves must promote one narrow slice at
a time, Leaf 2 is independent from Leaf 1, eslint-disable hygiene moved earlier,
knip moved earlier as an inventory sensor, scripts coverage now depends on the
zero-warning gate or an explicit `--max-warnings=0` slice, regexp coverage
depends on scripts coverage for global rollout, type-assertion lint now has a
required parseable reason syntax, stricter switch lint gets a default-branch
precheck, noisy React inventories have stop conditions, mocked-DB test policy
has revisit triggers, and verdict-register rows are required for full adoption
with caveats as well as reject/defer/subset outcomes.

---

## 2026-05-16 — Lint Hardening Deferred Verdict Path

Made "defer after inventory" an explicit lint-hardening evaluation outcome.
The index principle now lists four valid responses to rule findings: fix,
scope-silence, scope/reject, or defer with a recorded inventory and revisit
trigger. The verdict register's pending-evaluation guidance now covers
deferred candidates, not only rejected or subset-adopted candidates.

Leaf 10 (built-in AI-footgun rules; was Leaf 14 before the later same-day
renumbering) now gives `no-await-in-loop` four outcomes after inventory: adopt
globally, adopt scoped, defer after inventory when findings remain unclear, or
reject globally. The scoped-adoption examples now point at actual likely
clusters such as `packages/server/src/socket/`, e2e helpers, seed scripts, and
transaction helpers instead of an invented rate-limited services path.

---

## 2026-05-16 — Lint Hardening Verdict Register

Added `backlog/lint-hardening/evaluation-verdicts.md` as the centralized
place to record rejected, deferred, or subset-adopted lint candidates. The
register was seeded with the 2026-05-11 `eslint-plugin-llm-core` parked-rule
verdicts so future agents do not have to rediscover those decisions across
in-progress notes. Updated the lint-hardening index and plugin-evaluation
leaves to point at the register whenever inventory rejects or narrows a rule.

Also tightened rollout details for early implementation leaves: TanStack Query
now names the flat-config keys (`flat/recommended`,
`flat/recommended-strict`), `@eslint/json` now calls out explicit
`json/json` vs `json/jsonc` language blocks and avoids implying schema
validation, jsx-a11y now names the correct
`settings["jsx-a11y"].components` shape, broadened react-hooks now tells
agents to inspect `reactHooks.configs.flat`, and eslint-comments hygiene is
documented as independent from the broader suppression register.

---

## 2026-05-16 — Lint Hardening Second-Pass Review Adjustments

Applied second-pass review feedback to the lint-hardening backlog. Split
the React lint surface into separate jsx-a11y, main `eslint-plugin-react`,
and broadened `react-hooks` leaves so each can be evaluated and promoted
independently. Softened cross-repo-review.md principle 4 from "adapt the
code, not the rule" to "fix real findings; scope or reject rules that
cannot explain a real bug or smell" — preserves leverage for strong-
semantic rules while acknowledging that broad-plugin false positives are
signal about rule fit. Added "Possible Outcomes" blocks to plugin
evaluation leaves so the
"adopt/subset/reject" framing survives leaf-by-leaf reading. Corrected
the TanStack Query leaf's stated rule coverage against the actual
`@tanstack/eslint-plugin-query` rule set (added `prefer-query-options`,
noted `no-rest-destructuring` ships at `warn` in recommended). Added an
explicit deliberate-breadth note to the index so future agents
understand the backlog is a curated parking lot, not a TODO list to
drain.

---

## 2026-05-16 — Lint Hardening Backlog Split

Split `backlog/lint-hardening-cross-repo-review.md` into a short start-here
index plus leaf-sized notes under `backlog/lint-hardening/`. Future agents can
promote one lint-hardening leaf at a time without reading the full cross-repo
review; detailed ma-toki/hookrail provenance now lives in
`backlog/lint-hardening/00-context-and-rollout.md`.

---

## 2026-05-16 — Lint Hardening Backlog Re-Triaged

Refreshed `backlog/lint-hardening-cross-repo-review.md` after direct inspection
of `/home/node/tmp/ma-toki`. The main adjustment is rollout semantics: ma-toki's
Clippy `warn` lints still gate because its lint command uses `-D warnings`,
while Musi's ESLint warnings currently do not. Added a zero-warning lint gate as
the first candidate leaf, with the 2026-05-16 baseline from
`bun run lint -- --max-warnings=0`: 102 warnings, concentrated in
`spellcasting.ts` prepared-spell reference tables plus two targeted
`local/max-lines` pressure warnings.

---

## 2026-05-15 — code:intel tRPC Router Overview

Added `bun run code:intel -- overview <router-file>` with text and JSON output
for exported tRPC router procedures. The report includes procedure kind, auth
helper, input/output schema references or inline markers, imported service
calls, deterministic broadcast helper/socket emit detection, and up to five
direct candidate tests from the existing `tests --direct` graph path.
`packages/server/src/routers/cast-spell.ts` smoke output reports `cast` and
`dropConcentration` with their spell-casting service calls and
`emitCharacterUpdate` broadcasts. `bun test scripts/code-intel/`, `bun run
typecheck`, and `bun run verify:changed` passed.

Follow-up review fixed two overview edge cases: aggregator/spread-only routers
now return a clean "no direct tRPC procedures" error instead of `0
procedure(s)`, and resolver summaries include imported service/broadcast calls
made through locally defined helper functions.

---

## 2026-05-15 — Drift AI Suppression Diff Fixes

Fixed `drift:ai --check suppressions` so untracked added files are scanned via
the injected file reader when absent from `git diff`, and made `+++` path
normalization preserve no-prefix paths that actually start with `a/` or `b/`.
Focused tests, `bun run typecheck`, and the untracked-file smoke test passed.

---

## 2026-05-15 — AI Harness External Tooling Research

Captured parked recommendations from the Svelte AI tools and Effect language
service in `backlog/ai-harness-external-tooling-ideas.md`. Highest-leverage
ideas for Musi are a domain `code:intel -- overview` command, docs discovery
before retrieval, quick-fix preview output for existing codemods/sensors, and
canonical task/skill/subagent sources synced into harness-specific adapters.

---

## 2026-05-15 — AGENTS Area-Specific Details Trimmed

Trimmed another set of startup-only details from `AGENTS.md`: the worktree
helper command, low-level auth token placement, and named test helper
inventory. Auth/test bullets now point agents at the relevant docs and
existing helper patterns instead. The delegation note now says subagents are
allowed only when both the user and harness explicitly allow delegation.

---

## 2026-05-15 — AGENTS Startup Guidance Trimmed

Trimmed `AGENTS.md` entries that are already carried by deterministic
lint/hooks: hook bypass, Docker, explicit `any`, barrels, complexity, tRPC
output schemas, TODO references, helper `.test.` filenames, push-to-main, and
the direct race-sensitive write rule. Kept non-enforced judgment and
area-orientation guidance. `docs/ai-harness.md` now records `local/no-barrel`
and points removed startup rules at diagnostics/codemods instead of AGENTS.

---

## 2026-05-15 — SRD Rules Divergence Fixed

Validated `backlog/srd-rules-divergence.md` against SRD 5.2.1 PDF/markdown
references and fixed both issues. Seeded SRD weapon data now stores weapon
property indexes, inventory weapon parsing normalizes property names before
rules code sees them, and regression coverage proves capitalized `Finesse`
still uses the finesse branch. Prepared-spell limits now use fixed SRD
per-class tables for Bard, Cleric, Druid, Paladin, Ranger, Sorcerer, Warlock,
and Wizard; server/client callers pass `classId`, while non-SRD/homebrew and
third-caster subclass paths keep the legacy formula fallback. `bun run
verify:changed` passed.

---

## 2026-05-14 — Codebase Audit Notes Archived

Deleted `docs/agent_notes/in_progress/codebase-audit/` (lint, drift-ai,
mutation-testing, coverage workstream notes) and
`codebase-audit-findings.md`; the per-leaf detail is already preserved in
this log and recoverable from commits. Two pre-existing SRD 5.2.1 rules bugs
flagged during review were captured in
`docs/agent_notes/backlog/srd-rules-divergence.md`: weapon-property case
mismatch silently drops finesse on seeded weapons
(`packages/server/src/seed/seed-srd-equipment.ts:215` ↔
`packages/shared/src/rules/attack-damage.ts:443`), and `getMaxPreparedSpells`
still uses the 2014 `level + ability mod` formula instead of the 2024 fixed
per-class table (`packages/shared/src/rules/spellcasting.ts:153`).
`STATUS.md` and `NEXT.md` updated to drop the deleted iteration index;
`decisions-build.md` reference to the coverage workstream note removed.

---

## 2026-05-14 — AUD-MUT-005 Equivalent Mutant Suppressions

Annotated reviewed-equivalent shared-rules survivors in attack-roll, combat,
initiative, spellcasting, sorcery, multiclass, encounter difficulty, and XP.
`bun run verify:changed` passed. The encounter/xp suppressions rely on the
add-participant and mapper contract; `encounterParticipantSchema` remains
permissive for archived/output rows.

---

## 2026-05-13 — Codebase Audit Review Follow-ups

Closed the human-prioritized audit review handoff: weapon mastery coverage now
table-drives every SRD 5.2.1 weapon mastery and fixes Halberd to Cleave; the
MagicItemList consumer suite now proves accumulated cursor-list pages clear
after a search change.

---

## 2026-05-13 — AUD-COV-002 Coverage Runbook And Floors

Added the out-of-band coverage cadence guide, build ADR, and whole-percent
global/package floors. Coverage stays out of `verify:changed`, pre-push, and
CI; the stale GitHub Actions coverage step was replaced with the normal test
command.

---

## 2026-05-13 — AUD-DRIFT-008 Current Ghost-File Tuning

Added `checks.ghost-files.currentAllowedPairs` for current-scope-only ghost
file suppressions. The six stable sibling pairs in `drift-ai.config.json` no
longer warn under `bun run drift:ai --scope current --check ghost-files`, while
changed-scope new sibling detection remains strict.

---

## 2026-05-13 — AUD-MUT-003 Spellcasting Slot Coverage

Table-drove all SRD 5.2.1 full-caster slot rows, added single-class
multiclass-slot branch coverage, and corrected half-caster slots to start at
level 1 with multiclass half levels rounded up for 2024 Paladin/Ranger rules.

---

## 2026-05-13 — AUD-MUT-001 Attack Damage Mutation Coverage

Added exact SRD 5.2.1 weapon-table coverage and parser boundary tests. The
SRD weapon data now matches the bundled PDF, including firearms and 2024 weapon
property updates, and a forced Stryker milestone reported `attack-damage.ts` at
100% mutation score with the remaining survivors covered by later audit leaves.

---

## 2026-05-11 — Swallowed Error Lint Rule

Added `local/no-swallowed-errors` for catch blocks whose executable body only
calls direct `console.log`, `console.warn`, `console.error`, or
`console.debug` and then continues. The first pass intentionally leaves
logger-only catches, named handlers, comment-only catches, returns, and
rethrows outside the rule. The new sensor is listed in `docs/ai-harness.md`.
The next promoted ESLint leaf is local rule message guidance tests.

---

## 2026-05-11 — Remaining ESLint Candidate Audit

Audited the remaining `eslint-plugin-llm-core` candidates against the current
ESLint source scope. Skipped exported-function-expression and early-return
style rules, skipped commented-out-code after a prose false positive, parked
default `.sort()` because the direct rule hit 21 mostly string/test ordering
sites, and skipped upstream empty-catch because the 7 hits were documented
intentional outcomes already tolerated by core `no-empty`. The next promoted
leaf is narrow `local/no-swallowed-errors` for console-only catch blocks; the
baseline audit found 0 current hits.

---

## 2026-05-11 — Async Array Callback Lint Rule

Added `local/no-async-array-callbacks` with repair text for async
`forEach`, predicate methods, reducers, and unconsumed async `map`. The rule
preserves immediate `Promise.all` / `allSettled` / `race` / `any` consumption
and simple const-then-Promise-combinator shapes, so the existing router-source
audit stayed clean. The next promoted ESLint leaf is to audit and decide the
remaining upstream candidates.

---

## 2026-05-11 — Core ESLint Companion Rules

Enabled `no-useless-assignment`, `preserve-caught-error`,
`no-promise-executor-return`, and global `require-atomic-updates`. Fixed the
baseline by preserving caught causes in tRPC tests, using block-bodied timer
promise executors, clearing the Redis singleton before awaiting `quit()`,
assigning Socket auth data through a post-await local reference, and reshaping
serial e2e shared-state updates so edit/read assertions keep their flow without
post-await reassignment. The next promoted ESLint leaf is
`local/no-async-array-callbacks`.

---

## 2026-05-11 — LLM Artifact Lint Rule

Added `local/no-llm-artifacts` for narrow AI editing leftovers: comments like
`... existing code ...`, "rest of the function remains the same", and
"abbreviated for brevity"; bare TODO comments without issue/PR/roadmap/agent
note references; and exact incomplete `throw new Error("Not implemented")`
bodies. The rule is wired globally through ESLint and documented in
`docs/ai-harness.md`. The next promoted ESLint leaf is the core-rule companion
set from the evaluation note.

---

## 2026-05-11 — ESLint Disable Policy Gate

Tightened `scripts/eslint-disable-register.sh` from a report-only counter into
a policy gate: suppressions now fail when they omit `-- reason`, and broad
`eslint-disable` directives must match an explicit file/rule allowlist. Current
legitimate broad suppressions remain allowlisted, `doctor` reports the stronger
hint, and script smoke coverage pins missing-reason and unallowlisted-broad
failure paths. The next promoted ESLint leaf is `local/no-llm-artifacts`.

---

## 2026-05-10 — E2E Locator Drift Counter

Added `bun run drift:e2e`, a report-only raw `.locator(` counter for `e2e/**`
with the current `local/e2e-prefer-role-selectors` allowlist size.

---

## 2026-05-10 — drift:ai Current Scope Landed

Finished the promoted `drift:ai --scope current` workstream. Current-mode
comments now audits JS/TS-family inventory files with the same thresholds and
configurable exclusions as changed mode, while chunk output writes a complete
primary report plus deterministic manifest/chunk JSON files for AI handoff.
`docs/ai-harness.md` documents current scope and chunk flags. `NEXT.md` is now
empty until the next explicit re-triage.

---

## 2026-05-10 — 5e Rules Logic Guide

Added `docs/guides/change-rules-logic.md` for SRD-vs-policy source decisions,
shared rules helper reuse, pure rules boundaries, colocated shared rules tests,
focused verification, and manual mutation testing when assertion strength is
uncertain. `docs/ai-harness.md` now maps the guide to shared rules Vitest,
`test:changed`, and `bun run test:mutation`. The BatonLoop ready queue is now
fully landed, with no next ready leaf promoted.

---

## 2026-05-10 — Migration Safety Output Clarity

Grouped `db:migration-safety` findings into `== actionable warnings ==` for
unacknowledged `WARN` findings and `== acknowledged findings ==` for
allowlisted `INFO` history. The scanner still stays warn-only and keeps its
doctor signal lines, while focused shell coverage pins both fully acknowledged
and mixed-output shapes. The next promoted leaf is the 5e/5.5e rules logic
guide.

---

## 2026-05-10 — Module Index Guide Coverage

Tightened `scripts/test-generate-module-index.sh` so `--check` now has
coverage for guide-directed H1 and `Concepts:` breadcrumb changes. The test
mutates a sandbox module doc after index generation, proves the stale index is
reported with the changed metadata, and confirms check mode does not rewrite
`MODULE-INDEX.md`. The next promoted leaf is migration-safety output clarity.

---

## 2026-05-10 — Homebrew Subclass Caster Fields

Exposed `casterType` and `spellcastingAbility` in the homebrew subclass form,
using the shared caster option helpers and preserving the existing form-data
payload shape. Focused component coverage pins visible saved state and caster
select interactions. The next promoted leaf is module-index guide coverage.

---

## 2026-05-10 — Homebrew Class Caster Fields

Exposed `casterType`, `spellcastingAbility`, and `ritualAdept` in the
homebrew class form, using the shared caster option helpers and preserving the
existing form-data payload shape. Focused component coverage pins the visible
saved state, caster select interactions, and ritual-adept toggling. The next
promoted leaf is homebrew subclass caster-field inputs.

---

## 2026-05-10 — SRD Ritual Adept Rename

Renamed `Class.ritualCaster` / `classes.ritual_caster` to `ritualAdept` /
`ritual_adept` across Prisma, shared schemas, SRD seeding, tRPC mapping,
homebrew class form data, and fixtures. The migration renames the class column,
normalizes existing SRD rows so only Wizard is true, and renames stored
homebrew class JSON from `ritualCaster` to `ritualAdept` when needed. The next
promoted leaf is homebrew class caster-field inputs. Review follow-up added
legacy import/form fallback so old exported class payloads with `ritualCaster`
preserve the value as `ritualAdept`.

---

## 2026-05-10 — SRD Ritual Caster Decision

Captured the BatonLoop caster provenance decision in
`followup-srd-castertype-issues.md`: `Class.ritualCaster` should be renamed to
Wizard-style `ritualAdept`, seeded true only for Wizard, and kept distinct from
the general prepared-spell Ritual rule. The next promoted leaf is a
metadata-only rename/migration before homebrew class caster-field UI work.

---

## 2026-05-10 — SRD/Homebrew Mapper Provenance Fixture

Added a reviewed scenario table to `buildExportEnvelope` helper coverage. The
fixture proves homebrew subclass refs get `parentClassName` for import
rebinding, while an SRD class id such as `class-fighter` keeps its `classId`
and is not treated as a homebrew cross-entry ref.

---

## 2026-05-10 — Encounter Transition Fixture

Added a reviewed scenario table to `encounter.transitionState` route coverage.
The fixture proves paused combat resumes without rewinding the combat cursor
after both a mid-round advance and a wrapped-round advance, preserving
`round` and `currentTurnIndex` through `paused -> active`.

---

## 2026-05-10 — Authorization NOT_FOUND Fixture

Added a reviewed scenario table to `campaign.assignCharacter` route coverage.
The fixture compares an existing foreign character id with a missing character
id and asserts both return the same 404 `NOT_FOUND` / `Character not found`
tRPC response shape. Review follow-up stripped stack traces from formatted tRPC
error data so identical authorization denials do not expose different throw
sites.

---

## 2026-05-10 — Shared Rules Stryker Triage And Test

Triaged a focused `attack-roll.ts` Stryker slice for the BatonLoop queue. The
useful survivor was `applyCritDice("10d6")` failing to prove multi-digit dice
counts double to `20d6`; the companion anchor-removal regex mutant is reviewed
as equivalent/noisy under the current pure damage-dice contract. Review
follow-up added the focused `10d6` assertion in `attack-roll.test.ts`.

---

## 2026-05-10 — Module Doc Guide

Added `docs/guides/add-module-doc.md` from the BatonLoop queue. The guide
points contributors at `docs/module-docs.md`, covers when `MODULE.md` versus
`*-MODULE.md` is appropriate, keeps `Concepts:` breadcrumbs search-focused,
and records when to run `bun run module:index` or `bun run module:index:check`.

---

## 2026-05-10 — Scripts Vitest Baseline

Completed shell-migration Leaf 0A after a review pass found a real recursive
scripts-test routing gap. The scripts Vitest project now includes
`scripts/**/*.test.ts`, coverage excludes recursive script tests, and
`test:changed` has smoke coverage for generic nested script tests routing to
the `scripts` project.

---

## 2026-05-10 — Shell Migration Coordination Started

Created `docs/agent_notes/in_progress/shell-migration.md` from the external
shell migration draft and promoted only Leaf 0A: audit and patch the existing
scripts Vitest wiring without repointing production commands, hooks, Husky, or
`test:scripts`. The note records that this checkout already has a scripts
Vitest project, so the first leaf should be a baseline audit unless a concrete
coverage gap appears.

---

## 2026-05-10 — Logs Audit Request Correlation

Extended `bun run logs:audit` beyond parse/redaction checks. It now verifies
business-event request ids against Fastify/Pino request records when present,
requires stable authz/mutation/broadcast outcomes and low-cardinality reasons
where expected, and pins `socket.broadcast` `socketEvent` coverage with a
representative fixture.

---

## 2026-05-10 — Worktree-Local Logs Audit Started

Started the worktree-local observability stream with `bun run logs:audit`.
The first slice is read-only and fixture-backed: it accepts one or more JSONL
log files, reports unparseable/non-object lines, and flags obvious unredacted
sensitive fields, server-redacted chat/whisper content paths, or sensitive URL
query params without echoing secret values. Script Vitest coverage pins the
redacted fixture, leak reporting, JSON output, CLI exits, and `test:changed`
selection for `scripts/logs-audit*` edits. Next leaf extends the audit to
request-id correlation and stable event fields. Review follow-up made blank
JSONL lines fail parsing, added `set-cookie` detection, and covered the
top-level `scripts/logs-audit.test.ts` changed-test path.

---

## 2026-05-10 — AI Drift Sensors Duplicate And Ghost Checks

Leaves 2a, 2b, and 3 of `drift:ai` landed on `feat/misc-loop`: `jscpd` is a
root dev dependency, the duplicate scanner parses JSON reports and shells out
per changed package/script scope, and the custom ghost-file detector flags
suspicious newly added sibling modules. Review follow-ups restored
merge-base-based changed-file scope while preserving uncommitted tracked edits,
broadened `test:changed` coverage for the `scripts/drift-ai/` subtree and
fixtures, made ghost-file test/fixture exclusions path-aware, stabilized
ghost-file peer ordering, treated copied paths as new-file candidates, and
kept the live duplicate/ghost checks report-only and clean.
Leaf 4 (comment-ratio warning) remains next.

---

## 2026-05-09 — Code Intel Daemon Review Fixes

Hardened `code:intel:server` lifecycle recovery after review: `status`,
`stop`, and `restart` now treat corrupt metadata as recoverable state and
validate live daemon ownership with repo/protocol metadata plus a socket probe
before signaling a PID. Cold `refs` daemon requests use a longer timeout and
do not silently duplicate the expensive scan in one-shot mode after a timeout.
The reference project now derives package export and client alias paths from
the shared workspace model, and daemon cache manifests hash source/config
contents so same-size edits invalidate resident state.

---

## 2026-05-09 — Code Intel `refs` (Slice E) landed

Symbol-level reverse search via `bun run code:intel -- refs <file>:<line>:<col>`.
Resolves the identifier at the snapped position and lists every reference as
`<file>:<line>:<col> <import|value|type>`, classifying via parent-chain walk
(import/re-export specifiers → `import`; type queries / type references →
`type`; otherwise `value`). Cross-package resolution uses a workspace-wide
ts-morph reference project keyed by `@musi/{shared,server,client}/*` and
`@/*` paths. The daemon caches it via `ProjectCache.referenceProject(...)`
and reuses the existing manifest fingerprint, so warm `refs` shares
invalidation with `def`/`exports`. Daemon and one-shot output match
byte-for-byte for renamed imports, type-only references, and snap-to-nearest.
The full `code-intel-ux-fixes` workstream is now archived in
`finished_work/`.

---

## 2026-05-09 — Code Intel Recommendation And Output Polish

Refreshed the code-intel daemon notes: the durable next step is a repo-owned
custom TypeScript Language Service daemon, while the globally installed
`typescript-language-server` remains useful only for optional `refs`
prototypes unless added as an explicit repo dependency. The CLI now supports
`--limit` for `dependents` / `tests`, shorter transitive dependent labels,
candidate markers on runtime-import test matches, and subcommand help.

---

## 2026-05-07 — Focused architecture lint sensors

Added repo-local lint gates for three high-signal AI failure modes:
`local/concurrency-guard` mirrors the existing concurrency-gated Prisma
delegate surface, `local/trpc-require-output-schema` gives line-local feedback
when router procedures omit `.output(schema)`, and
`local/no-broadcast-in-transaction` keeps socket broadcasts after committed
writes. Also tightened import restrictions so `packages/shared` stays
runtime-neutral and client code constructs Socket.io only through
`socket-context.tsx`.

---

## 2026-05-07 — ESLint repair-text diagnostics

Added repo-local `local/no-explicit-any` and `local/max-lines` rules so lint
failures include agent-facing repair guidance instead of terse upstream
messages. The project-wide file-size default is back to 300 effective lines;
known larger source/helper modules now have explicit warning-level caps in
`eslint.config.js`, each with a short rationale and a modest ceiling near its
current count.

---

## 2026-05-07 — Client feature cache/socket guide

Added `docs/guides/add-client-feature-module-cache-socket.md` on
`feat/harness-improvements-v2`. The guide covers client feature module
placement, tRPC-derived query keys, shared versus feature-local invalidation,
optimistic cache snapshot/rollback, socket-driven invalidation through
`realtime-invalidation.ts`, reconnect refetch behavior, direct socket cache
writes for complete ephemeral payloads, and the client test seams for mocked
tRPC, QueryClient wrappers, and socket listeners. `NEXT.md` now promotes the
module-doc guide leaf.

---

## 2026-05-06 — Concurrency guard checker

Added manual `bun run codemod:concurrency-guard -- --check` coverage for the
race-sensitive mutation boundary. The checker reports direct writes to gated
Prisma delegates outside `utils/*-mutations.ts`, `RawTxClient` imports outside
the ESLint allowlist, and Pattern A/B/C helper-shape drift. It is check-only,
not wired into hooks/doctor/verify, and the initial `packages/server/src` scan
was clean.

---

## 2026-05-06 — Race-sensitive mutation guide

Added `docs/guides/add-race-sensitive-mutation.md` on
`feat/harness-improvements`. The guide makes the `docs/CONCURRENCY.md`
three-bar gate the first step, then maps Pattern A/B/C to the existing
`utils/*-mutations.ts` helpers, lock order, conflict semantics, invariant
concurrency tests, `RawTxClient` lint restriction, and restricted Prisma
delegate type checks.

---

## 2026-05-06 — Prisma migration guide

Added `docs/guides/add-prisma-migration.md` on `feat/harness-improvements`.
The guide pairs Prisma schema edits with the migration safety sensor: generate
with `bun run --filter @musi/server db:migrate -- --create-only`, inspect
generated SQL, prefer safer multi-step rewrites for risky operations, apply
locally, run `prisma:generate`, run `bun run db:migration-safety`, and either
rewrite unacknowledged `WARN:` findings or add a reviewed reason to
`packages/server/prisma/migrations/.safety-acknowledged`. `docs/ai-harness.md`
now points `db:migration-safety` at the guide instead of a future placeholder.

---

## 2026-05-06 — Structured logging codemod and static-message enforcement

Closed the structured-logging repair path on `feat/harness-improvements`.
`local/structured-logging` now rejects direct server-side `console.*` and
non-static Pino message strings (templates, concatenation, runtime values),
while `bun run codemod:structured-logging-fix` provides single-file,
`--all`, `--dry-run`, and `--check` modes that rewrite obvious runtime
logger calls and seed/generator scripts onto
`packages/server/src/utils/script-logger.ts`'s JSON-line adapter. Templates,
concatenation, multi-count seed summaries, joined output, multiple primitive
args, and raw runtime errors without an `err` field stay unsupported and are
reported with file/line reasons rather than guessed. Direct console remains
allowed only in `script-logger.ts` and `main.ts`'s startup-failure path.
Policy moved to `docs/agent_notes/decisions-build.md` under "Structured
logging repair path".

---

## 2026-05-06 - tRPC shared schema codemod review

Closed the codemod review handoff on `feat/harness-improvements`. The tRPC
shared input/output schema lint sensors are error-level, both codemods have
no-write `--check` discovery, output has `--all` bulk repair, and fixture
coverage pins unsafe target rejection, path-aware import rewrites, failure
messages, local output moves, wrapper/manual failure cases, and unsafe generated
schema identifiers.
Policy moved to `docs/agent_notes/decisions-build.md`: keep lint as the drift
sensor and explicit codemod commands as the repair path.

---

## 2026-04-28 — FU5 Stale Migration Safety Acknowledgements

Closed FU5. `scripts/migration-safety-scan.sh` now resolves each
`.safety-acknowledged` entry against `<allowlist-dir>/<name>/migration.sql`
and emits a per-entry `WARN: <allowlist>:<lineno> — stale acknowledgement
"<name>" — no migration at <dir>/<name>/migration.sql` plus a final `WARN:
migration safety — N stale allowlist entr*y/ies* in <allowlist>` line so a
typo or removed migration cannot silently linger. The check is independent
of the scanned migration set — scanning a single migration cannot make
sibling entries appear stale — and runs even when the scanned migrations are
clean. The allowlist parser also tracks each entry's line number so the
WARN points at the exact typo. Doctor picks the WARN lines up via its
existing tee/grep counter; no doctor changes were needed. Coverage in
`scripts/test-migration-safety-scan.sh` covers single and multi-stale
entries (with allowlist line numbers), mixed stale + unacknowledged-finding
output, valid-allowlist regression, scan-set independence, and a guard that
the shipped repo allowlist has no stale entries. The `feature/devx2`
merge-review queue is now fully exhausted (MR1-MR5, FU1-FU5 all closed) and
the in-progress note can be archived on the next re-triage pass.

---

## 2026-04-28 — FU4 Encounter-Not-Found Authz Log

Closed FU4. `assertEncounterDm` in
`packages/server/src/utils/encounter-helpers.ts` now emits a single
`authz.encounter.dm` deny log with `reason: "encounter_not_found"` (carrying
`actor.userId` and `encounterId`) when the encounter lookup returns null,
before throwing the existing `NOT_FOUND` TRPC error. Found encounters still
delegate the role decision to `assertCampaignDm`, so the campaign-dm
boundary log shape is unchanged. Coverage lives next to the existing
not-found assertion in `utils/encounter-helpers-auth-lifecycle.test.ts`: a
fake logger asserts the new event payload and confirms `authz.campaign.dm`
does not double-emit on the not-found path. `NEXT.md` is now empty; FU5
remains parked pending reviewer promotion.

---

## 2026-04-28 — FU3 Map Toolbar Prop Grouping

Closed FU3. `MapToolbar` props are grouped into stable sections: `view`
(`MapToolbarViewControls`), `fog` (`MapToolbarFogControls`), `drawing`
(`MapToolbarDrawingControls`), and `template` (`MapToolbarTemplateControls`),
alongside the shared `activeTool` / `isDm` / `gridType` / `onToolChange`
props. Internal section components (`PrimaryToolSection`, `DmToolSection`,
`ViewControlSection`) still own their own self-contained prop interfaces; the
toolbar spreads each group into the matching section. Both call sites
(`map-detail-header.tsx`, `combat-map-header.tsx`) construct the grouped
objects from the existing canvas/draw/fog/template stores; no store shapes
changed. The toolbar test renderer now returns a flat `handlers` bag keyed by
event name so existing behavior assertions
(`expect(handlers.onZoomIn).toHaveBeenCalled()`) stay independent of the prop
shape, and the previous inline render at the active-tool case reuses
`renderToolbar({ activeTool: "measure" })`.

---

## 2026-04-28 — FU2 Named Drawing Actions Type

Closed FU2. `packages/client/src/hooks/use-drawing-actions.ts` now exports the
named `DrawingActions` type already used as the hook return annotation.
`map-detail-header.tsx` and `combat-map-header.tsx` import that type directly
instead of using `ReturnType<typeof useDrawingActions>`. `NEXT.md` now
promotes FU3 map toolbar prop grouping; FU4-FU5 remain parked.

---

## 2026-04-28 — FU1 Socket Broadcast Logging Contract

Closed FU1. Registry-owned broadcasts now own the `socket.broadcast` log:
`broadcast()` and `broadcastToUsers()` in
`packages/server/src/socket/broadcast-registry.ts` accept an optional
`logger: RequestLogger` and emit exactly one log per call (`success` with the
registered `socketEvent` plus `logFields(payload)` scope, or `skipped` with
`reason: "no_socket_server"`). Each `BroadcastEntry` requires a
`logFields(payload) => BroadcastLogScope` extractor — a new event cannot omit
the logging contract because TypeScript fails at the registry constant.
`chat:newMessage` deliberately drops content/authorId from the scope to keep
chat bodies out of logs, and a regression test pins this. Per-family helpers
(`broadcastEncounterUpdate`, `broadcastCharacterUpdate`,
`broadcastCampaignUpdate`, `broadcastMapTokenUpdate`,
`broadcastMapLayerUpdate`, `broadcastChatMessage`) thread the optional logger
through; routers and services pass `ctx.logger`. `broadcastChatMessage`
collapsed `dmUserId` and `logger` into a `BroadcastChatMessageOptions`
options object to stay under the project's max-params=4 lint rule.
`emitCharacterUpdate` keeps its targeted `no_campaign` skip log because the
campaign membership check happens before the registry call. Boundary
contract coverage lives in `socket/broadcast-registry.test.ts` (~6 new cases
covering required `logFields`, success/skipped outcomes for all registered
events, the chat scope's content-leak protection, and `broadcastToUsers`
boundary logging). The per-helper outcome assertions in
`socket/encounter-broadcast.test.ts` still pass via the registry path.

## 2026-04-28 — DX8.2d Mutation Boundary Logs

Closed DX8.2d, the last DX5-DX8 leaf. `request-logger.ts` now exposes
`logMutation` (info on success, warn on failure) and `logBroadcast` (info
on success/skipped) with typed `MutationLogPayload` /
`BroadcastLogPayload`. Hot mutation boundaries each emit exactly one
business-event log per committed call: `auth.login`, `auth.refresh` in
`routers/auth.ts`; `character.create`, `character.updateStats`,
`character.adjustHp` in `routers/character.ts`; `encounter.create`,
`encounter.state.transition` in `routers/encounter.ts`. Failures use a
low-cardinality reason (`invalid_credentials`, `invalid_refresh`,
`invalid_transition`); successes carry `actor` plus relevant scope ids.
Broadcast outcomes are logged at the emit boundary. FU1 later centralized
registry-owned broadcast logs in `socket/broadcast-registry.ts`; this DX8.2d
entry is retained only for the original mutation-boundary landing details.
New tests landed in `utils/request-logger.test.ts` (3),
`routers/mutation-logging.test.ts` (7),
`socket/encounter-broadcast.test.ts` (+2), and
`utils/character-campaign.test.ts` (+2).

## 2026-04-28 — DX8.1b Prisma Migration Safety Integration

Closed DX8.1b. `bash scripts/doctor.sh` now runs
`scripts/migration-safety-scan.sh` as a `migration safety` section between
the eslint-disable register and the summary, so doctor surfaces new
destructive operations as `WARN:` lines and a clean scan as a single
`PASS:` line. Acknowledgement allowlist at
`packages/server/prisma/migrations/.safety-acknowledged` (one
`<migration_dir_name>  <reason>` per line, optional reason after first
whitespace; tests can override the path with `MUSI_MIGRATION_ALLOWLIST=...`)
flips findings for listed migrations to `INFO: ... (acknowledged: <reason>)`
and counts them separately in the summary. The two intentional-risk
precedents (`20260408223838_convert_string_fields_to_enums`,
`20260409120000_add_monster_spells_table`) ship in the allowlist. Scanner
remains warn-only; promotion to a hard gate is deferred until local
visibility proves insufficient. Escape-hatch design in
`docs/agent_notes/decisions-build.md`. Test count rose to 24 (added six
allowlist/doctor-signal cases). DECISIONS.md crossed ~400 lines on the new
entry and was split by domain into
`decisions-{concurrency,auth,realtime,schemas,services,build}.md` with
DECISIONS.md kept as an index. `NEXT.md` now queues DX8.2a.

## 2026-04-28 — DX8.1a Prisma Migration Safety Scanner

Closed DX8.1a. Added `scripts/migration-safety-scan.sh` (wired as
`bun run db:migration-safety`) that walks
`packages/server/prisma/migrations/` (or any path passed as an argument) and
emits warn-only `WARN: <file>:<line> — <rule>` findings for four detection
rules: `DROP TABLE`, `DROP COLUMN`, `ALTER COLUMN ... TYPE`, and
`ADD COLUMN ... NOT NULL` without a same-line `DEFAULT`. Each finding
includes one-line risk guidance and the offending statement; the scanner is
warn-only (always exits 0) so DX8.1b can decide blocking semantics.
`scripts/test-migration-safety-scan.sh` runs 18 checks covering each
detection rule, the safe add-nullable + backfill + SET NOT NULL counter
pattern, sandbox-wide aggregation, and the two intentional-risk precedents
already in the migration history
(`20260408223838_convert_string_fields_to_enums` surfaces all six
`ALTER COLUMN ... TYPE` clauses; `20260409120000_add_monster_spells_table`
surfaces the `DROP COLUMN "spellcasting"` line). `NEXT.md` now queues
DX8.1b.

## 2026-04-28 — DX7.1g Spell Casting Service Test Split

Closed DX7.1g. `spell-casting.test.ts` dropped from ~975 lines to ~648
(castCombatSpell only, with the inline `makeMonsterEncounter`,
`setupWizardCharacter`, and `makeCharacterCasterEncounter` helpers it owns).
The other two service entry points moved to
`spell-casting-non-combat.test.ts` (~297, covers `castNonCombatSpell`
including ritual, cantrip, slot, and concentration branches) and
`spell-casting-drop-concentration.test.ts` (~53, covers `dropConcentration`).
Concentration semantics stay covered explicitly across the split: leveled
concentration, ritual concentration, and prior-spell replacement live in the
non-combat file; combat-side concentration set lives in the combat file; and
clear/no-op-when-not-concentrating lives in the drop-concentration file. No
new shared builders: each split file imports the existing
`setupSpellTestContext` / `setupEncounterTestContext` helpers and the only
combat-encounter setup helpers (`makeMonsterEncounter`,
`setupWizardCharacter`, `makeCharacterCasterEncounter`) stay inline in
`spell-casting.test.ts` because no other test file needs them.

## 2026-04-28 — DX7.0c Fixture Builder Inventory

Closed DX7.0c. Parked the inventory at
`docs/agent_notes/finished_work/fixture-builder-inventory.md`. Named the two
outlier client fixture files —
`packages/client/src/test/fixtures-encounter.ts` (460 lines, six pre-baked
`EncounterDetail` constants) and
`packages/client/src/test/fixtures-srd.ts` (347 lines, five frozen `as const`
arrays) — and listed the narrow builder targets each DX7.1 leaf should
extract (e.g. `setupActiveBattle` / `setupActiveWithLog` for DX7.1a, the
inline `createEncounterWithMonsters` / `rollInitiative` /
`activateEncounter` cluster for DX7.1d, `BASE_INPUT` /
`createFighterCharacter` / `levelTo` for DX7.1i). Server-side
setup-context helpers (`encounter-test-helper`, `spell-test-helper`,
`map-test-helper`, `inventory-test-helper`) already follow the
narrow-builder shape; DX7.1 splits should lift in-file helpers next to them
rather than fork new contexts. `TEST_CHARACTER_DETAIL` (~26 callers) is
explicitly out of scope for DX7.1 — override via spread, do not fork. No
code moved in this leaf. `NEXT.md` now queues DX7.1a.

## 2026-04-28 — DX6.3d Combat Map Surface Slices

Split `components/campaign/combat/combat-map-panel.tsx` to mirror the DX6.3c
shape. The panel now keeps only the `mapId` guard, the `map.get` query, and
the loading/error boundary; loaded-map orchestration moved to
`combat-map-content.tsx`, with focused seams in `combat-map-header.tsx`,
`combat-map-mutations.ts` (token + link/unlink mutations),
`combat-map-store-hooks.ts` (combat-map canvas controls), and
`combat-map-bridges.ts` (movement tracking, selection sync, unlinked
participants, active-participant lookup, context HP). Drawing/template store
slices reuse `map-detail-store-hooks.ts` and container sizing reuses
`use-map-container-size.ts` from the maps surface. Existing tests
(`combat-map-panel.test.tsx`) remain green; `NEXT.md` queues DX7.0a Vitest
timing capture.

## 2026-04-28 — DX6.3a Map Canvas Mechanics

Split `components/campaign/maps/map-canvas.tsx` into a small composition shell
plus `map-canvas-grid.tsx` (square/hex grid lines and the `GridBody` switch),
`map-canvas-overlays.tsx` (`CanvasOverlays` and the fog/draw/template/measure
body components), and `use-map-canvas-handlers.ts` (`useCanvasHandlers` wheel/
drag/click handlers and `useMapCanvasStoreSlice`). Pointer-write logic stays
behind `hooks/canvas-input/`; the shell still owns Stage layering, drawing
eraser dispatch, and the fog/drawing layer parsing seam. Existing
`map-detail-view.test.tsx` Konva-layer-budget assertions remain green.
`components/campaign/maps/MODULE.md` now records the new presentational seams;
`NEXT.md` queues DX6.3b map toolbar mechanics.

## 2026-04-28 — DX6.2b Stats Tab Slices

Split `components/vtt/drawer/tabs/stats-tab.tsx` into a small composition
shell plus `stats-tab-summary.tsx` (headline strip and HP bar),
`stats-tab-concentration.tsx` (spell lookup chip), and `stats-tab-rolls.tsx`
(rollable abilities, saves, and proficient skills). Kept the existing
`StatsTab` entry point, test IDs, and read-only roll behavior stable.
`components/vtt/drawer/MODULE.md` now records the stats-tab section
ownership; `NEXT.md` now queues DX6.2c actions tab slices.

## 2026-04-27 — DX5.3f Socket Broadcast Registry Cleanup

Closed Phase DX5.3. Re-grepped server `.emit(` sites: every per-family
adapter (`broadcastCampaignUpdate`, `broadcastCharacterUpdate`,
`broadcastEncounterUpdate`, `broadcastMapTokenUpdate`,
`broadcastMapLayerUpdate`, `broadcastChatMessage`) still has callers and is
preserved as a DX5.3c "stable adapter" over `broadcast(...)` /
`broadcastToUsers(...)`. Remaining direct emits — presence (`presence:*`,
`campaign:player*`), notification (`notification:new`), connection envelope
(`pong`, `error`) — stay in their owning modules and are recorded as
intentionally outside the registry boundary. Parked the DX5.3a inventory at
`docs/agent_notes/finished_work/socket-emit-inventory.md` and updated the
in-tree reference in `socket/broadcast-registry.ts`. `NEXT.md` now queues
DX6.0 client path and module prep.

## 2026-04-27 — DX5.3e Socket Broadcast Registry Combat Fan-Out

Migrated `services/encounter-combat/broadcast-helpers.ts` onto
`broadcast-registry.ts`: the encounter invalidation now calls `broadcast(io,
"encounter:updated", ...)` directly so the registry boundary is visible at the
fan-out site, while character invalidation and combat-chat fan-out still flow
through the stable `emitCharacterUpdate` and `broadcastCombatChat` adapters.
`utils/combat-chat.ts` is split into a service-layer `persistCombatChat` (DB
write, returns mapped payload) and a `broadcastCombatChat` wrapper that pairs
the persist with a registry emit, so the persistence half is separately
auditable from the socket emit. Focused coverage in
`broadcast-helpers.test.ts` exercises the three concerns plus the
fire-and-forget warn path and the no-socket no-op. `NEXT.md` now queues
DX5.3f cleanup.

## 2026-04-27 — DX5.3d Socket Broadcast Registry Chat Routing

Migrated `chat-broadcast.ts` onto `broadcast-registry.ts` while preserving
the room-wide path and whisper recipient filtering for sender, recipient, and
DM. The registry now owns `chat:newMessage` payload validation, room
resolution, room-wide emit, and filtered per-user room fan-out. Registry tests
cover shared schema reference, room-wide chat emit, explicit room preservation,
and whisper recipient filtering. `NEXT.md` now queues DX5.3e combat fan-out.

## 2026-04-27 — DX5.3c Socket Broadcast Registry Simple Events

Migrated `character-broadcast.ts`, `encounter-broadcast.ts`, and
`map-broadcast.ts` onto `broadcast-registry.ts` while keeping the per-family
helper imports stable. Registry tests now pin shared schema references, room
resolution, and emit behavior for character, encounter, and map invalidation
events. `NEXT.md` now queues DX5.3d chat routing.

## 2026-04-27 — DX5.3b Socket Broadcast Registry Foundation

Landed `packages/server/src/socket/broadcast-registry.ts`: a typed registry
binding event names to shared `@musi/shared` payload schemas, room policies,
and literal-typed emit closures. `campaign-broadcast.ts` now routes through
`broadcast(io, "campaign:updated", payload)`. Tests pin the schema reference
to the shared module and cover validation, room resolution, null-io no-op,
and bad-payload rejection. Migration recipe lives in the registry module
header for DX5.3c-DX5.3f.

## 2026-04-27 — DX5-DX8 Sprint Promoted

Promoted the second developer-experience sprint into
`docs/roadmap/developer-experience.md`, removed the stale first-sprint roadmap
content, and queued DX5.1 in `NEXT.md`.

## 2026-04-27 — DX1-DX4 Sprint Closed

The first developer-experience sprint landed through DX4.4. The active queue
now starts from the DX5-DX8 roadmap.
