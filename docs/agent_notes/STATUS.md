# Status

**Last updated**: 2026-05-21 — Leaf 41j closed the reviewer #2 coverage-map
trust gap. Full `bun run docs:lint-coverage-map:check` now uses the ESLint JS
API to verify actual config reach for ESLint-managed files matched by `linted`
rows, and `--staged` keeps the pre-commit path cheap by skipping that slow gate.
The concrete false negative, `scripts/codemods/tsconfig.json`, is now an
excluded parser-project config row instead of being claimed by the root
tsconfig row. Details:
`finished_work/lint-hardening-leaf-41j-map-eslint-reach.md`.

Prior 2026-05-21 landing: Leaf 41i closed the reviewer-flagged JSON
changed/pre-commit gap. Full lint already covered maintained JSON, but
`lint:changed` dropped JSON by extension and the pre-commit source allowlist
missed five full-linted JSON config files. `scripts/lint-changed.sh` now passes
`*.json` and `*.jsonc` to per-file ESLint without escalating every JSON edit to
full lint, `.husky/pre-commit` gates the five missed paths, and the shared
changed-gate relevance helper mirrors them. Regression coverage now catches
staged duplicate-key JSON in `lint:changed` and hook dispatch for the five
paths. Details:
`finished_work/lint-hardening-leaf-41i-json-changed-gap.md`.

Prior 2026-05-21 landing: Leaf 41h landed Phase A.3 for `eslint-rules/*.js`
rule implementations. The Phase A.2 non-type-aware block now applies the safe
generic subset from the strict tier: `simple-import-sort`, `eslint-comments`
hygiene, and generic `local/*` (`no-llm-artifacts`, `no-swallowed-errors`,
`no-async-array-callbacks`). A post-change `bun run lint -- --max-warnings=0`
re-probe found zero findings, so no ratchet was added; `eslint-rules/*.test.js`
remain excluded from this block. Domain/path-specific local rules plus
type-aware `local/no-explicit-any` and `local/no-barrel` stay deferred as
non-broad-shallow. Details:
`finished_work/lint-hardening-leaf-41h-eslint-rules-phase-a3.md`.

Prior 2026-05-21 landing: Leaf 41g closed the final four Leaf 41f
broad-shallow blockers: `scripts/code-intel.test.ts`,
`scripts/lint-ratchet-baseline.test.ts`,
`scripts/lint-coverage-map-check.ts`, and
`scripts/lint-coverage-map-check.test.ts`. The four files are now exact
re-includes from the global `scripts/**/*` ESLint ignore and use the
`tsconfig.scripts.json` parser override. The three script tests have
script-test bug-class ratchets for `vitest/expect-expect`,
`vitest/valid-expect`, `@typescript-eslint/no-misused-promises`, and
`@typescript-eslint/only-throw-error`; the coverage-map checker source has a
singleton `local/max-lines` ratchet. New lint inventory was bounded: 2
autofixed import-sort findings, 6 findings folded into existing top-level
script ratchets, and 24 findings captured by new ratchets. Broad-shallow Leaf
41 coverage is now complete enough; next work should pivot to drain work or
explicitly named deeper-rule leaves. Details:
`finished_work/lint-hardening-leaf-41g-singleton-floors.md`.

Prior 2026-05-21 landing: Codex review P2 follow-up for Leaf 41d tightened the
coverage-map staged-content gate. `scripts/lint-coverage-map-check.ts` now
accepts `--staged` and reads the map from `git show :...`; `verify --changed`
and `.husky/pre-commit` use that staged path, while full verify still reads the
worktree by design. A temp-repo Vitest regression now catches the stale staged
map / fixed worktree map failure mode. Details:
`finished_work/lint-hardening-leaf-41e-coverage-map-staged.md`.

Prior 2026-05-21 landing: Leaf 41d ShellCheck install-path follow-up
swapped ShellCheck from the pinned npm wrapper to the system `shellcheck`
binary on `PATH` (`apt install shellcheck`; this container reports
`/usr/bin/shellcheck` 0.9.0, down from the wrapper's upstream 0.11.0).
`lint-shell.sh` now fails with the apt hint when shellcheck is missing, while
`doctor.sh` reports the same gap as WARN and continues. Smoke coverage still
passes with ShellCheck 0.9.0. `actionlint`, `taplo`, and `hadolint` stay on
their npm wrappers because they are not in the Debian/Ubuntu main repos.

Prior 2026-05-21 landing: Codex review P2 follow-up for Leaf 41c fixed
the first-run `hadolint@0.4.2` wrapper cache failure on
`feature/lint-hardening-leaf-41c-config-sensors`. Fresh installs could download
`hadolint-2.14.0` with non-executable mode and fail the immediate spawn with
`EACCES`; `lint-config-sensors.sh` now primes the local wrapper only when the
cache is missing, chmods the downloaded binary, then invokes hadolint normally.
The smoke test now exercises the same wrapper path instead of injecting a
pre-chmodded cache binary. `actionlint` and `taplo` were checked and do not
have the same lazy executable download shape.

Prior 2026-05-21 landing: Leaf 41c yamllint follow-up swapped yamllint from
the repo-local Python venv to the system `yamllint` binary on `PATH`
(`apt install yamllint`, version >=1.29.0; this container reports
`/usr/bin/yamllint` 1.29.0). `lint-config-sensors.sh` now fails with the apt
hint when yamllint is missing, while `doctor.sh` reports the same gap as WARN
and continues. `actionlint`, `taplo`, and `hadolint` stay on their npm wrappers
because they are not in the Debian/Ubuntu main repos.

Prior 2026-05-21 landing: Codex review P2 follow-up for Leaf 41c fixed the
`node-actionlint` wrapper argv gap from `aca65e31`: the pinned wrapper calls
`run(args[0])`, so `run_actionlint()` now invokes actionlint once per collected
workflow file and accumulates failures. A two-workflow smoke fixture covers the
formerly missed invalid second workflow. `yamllint`, `taplo`, and `hadolint`
were checked for native multi-file argv support and left unchanged.

Prior 2026-05-21 landing: Leaf 41c workflow/config sensors now cover GitHub
workflows, maintained YAML, TOML configs, and Dockerfiles through
`bun run lint:config-sensors`, full `bun run lint`, and the changed/pre-commit
path in `scripts/lint-changed.sh`. Install paths: pinned npm wrapper
`@tktco/node-actionlint@1.6.0`; system `yamllint` from `PATH`
(`apt install yamllint`, version >=1.29.0; the tested npm port produced false
Compose duplicate key findings); pinned npm wrapper `@taplo/cli@0.7.0`; and
pinned npm wrapper `hadolint@0.4.2` with upstream Hadolint pinned to 2.14.0
plus a wrapper chmod guard. The maintained scope is `.github/workflows/*.{yml,yaml}`,
`.yamllint.yml`, `docker-compose.yml`, `.devcontainer/docker-compose.yml`,
`.codex/skills/*/agents/openai.yaml`, `bunfig.toml`, `.codex/config.toml`, and
`.devcontainer/Dockerfile`; ignored local `docs/refs/5e-database/Dockerfile`
is also linted when present with reference-only low-value ignores.
`.playwright-cli/**` remains explicitly excluded. Findings were handled in
source/config; no config-sensor ratchet adapter or baseline was added.

Prior 2026-05-21 landing: Leaf 41b ShellCheck floor now covers the maintained
shell set through `bun run lint:shell`, full `bun run lint`, and the
changed/pre-commit path in `scripts/lint-changed.sh`. The current install path
is the system `shellcheck` binary on `PATH` (`apt install shellcheck`, 0.9.0 in
this container), enforcing `--external-sources` `--severity=warning` while
preserving shebang dialect detection. The current scope is 84 maintained shell
files (`scripts/**/*.sh`, `.husky/*`,
`.codex/hooks/*.sh`, `.claude/hooks/*.sh`, `.devcontainer/*.sh`), with
`.husky/_/`, `node_modules/`, `worktrees/`, and `.playwright-cli/` excluded.
Findings were small and fixed in source; no ShellCheck ratchet adapter or
baseline was added.

Prior 2026-05-21 landing: Leaf 41 root/package config-file linting sub-batch B
now covers the maintained root/package TS config files in normal ESLint via
exact re-includes from the global `**/*.config.{js,mjs,ts}` ignore, a dedicated
`tsconfig.configs.json` parser project, and a TS config block using project
service with `local/max-lines` disabled. Newly covered findings were handled
in source (three import-sort autofixes, one Playwright retry constant, and
awaited Vitest slow-project config imports); no ratchet or baseline update was
needed. Sub-batch A already covered the three root JS config files
(`eslint.config.js`, `commitlint.config.js`, `stryker.config.mjs`). The
Root/package config block is now done. Earlier 2026-05-21 landings converted
`ratchet/core-complexity-top-level-scripts` to `complexity-severity`, fixed
live `complexity-severity` new-path payload reporting, and added
`ratchet/core-complexity-lint-ratchet-runtime`.

Prior landings on this branch: Leaf 41j coverage-map ESLint reach, Leaf 41i
JSON changed/pre-commit gap, Leaf 41h eslint-rules Phase A.3 generic subset,
Leaf 41g final singleton floors, Leaf 41 drift-ai test-harness bug-class
ratchets, Leaf 41 eslint-rules floor Phase A/A.2/B, child
leaf 41d coverage-map drift check, Batches 1-3 `local/max-lines` (codemods,
drift-ai, ratchet/harness runtime), Batch 4 codemod test-harness bug-class
ratchets (vitest + tseslint), Batch 5 core-rule runner support, Batch 6
`ratchet/core-complexity-codemods`, Batch 7
`ratchet/core-complexity-drift-ai`, and Batch 8 singleton `local/max-lines`
ratchets. The load-bearing Leaf 41 coverage map remains at
`docs/agent_notes/backlog/lint-followups/lint-coverage-map.md`; every tracked
file family resolves to one of `{linted, ratcheted, proposed, pending-leaf,
excluded, not-code}` with no `unknown` rows and no remaining broad-shallow
`proposed` blockers; full map verification also checks actual ESLint reach for
ESLint-managed `linted` rows. Continue only with named drain/deeper-rule work.

## Active

Lint-hardening review follow-up Tier 2 is the active iterative workstream on
`feature/lint-hardening-review-followup`. The organized follow-up queue lives
in `backlog/lint-followups/00-index.md`; ratchet infrastructure leaves (01–05)
are resolved or explicitly deferred and should not be reopened without a human
ask. Old lint-hardening notes remain provenance only.

The current promoted leaf is `41-ratchet-first-overlooked-lint-coverage.md`.
Leaf 41j closed the coverage-map ESLint reach gap found in review, after Leaf
41i closed the JSON changed/pre-commit coverage gap. With child leaves 41d,
41b, 41c, 41g, 41h, 41i, and 41j, Phase A/A.2 eslint-rules
implementation coverage, Phase B rule-test coverage, the Batch 1-8
floors/source work, the drift-ai test-harness bug-class floor, Leaf 38, and
the Leaf 41f audit in place, Leaf 41 broad-shallow coverage is complete
enough. The next work should pivot to drain work or explicitly named
deeper-rule leaves. Leaf 41h landed the generic Phase A.3 subset; remaining
domain/path-specific local rules and type-aware `local/no-explicit-any` /
`local/no-barrel` stay deferred as non-broad-shallow. Detail and the accepted
tradeoff (drains stay deferred) live in `NEXT.md`. New floors stay in
local/pre-commit, not CI-only.
Bug-class findings (`vitest/expect-expect`, non-`Error` throws, ambiguous
truthiness) get fix-soon drains. Zero-finding ratchet scopes need matched-file
proof, ideally a temporary-violation probe reverted before commit. Core ESLint
rules (`complexity`, `max-params`, `no-nested-ternary`) have runner support and
live `complexity` ratchets over codemods, drift-ai, and eslint-rules;
`max-params` and `no-nested-ternary` are now opportunistic follow-ons, not
next-up.

Leaf 19's autonomous-slice queue remains substantially exhausted (slice 4
`scripts/code-intel.ts` re-probe confirmed the 9 `consistent-type-imports`
findings need manual rewrite; four codemod test files remain deferred). Leaf
38 resolved the former top-level non-tsconfig script deferral. Latest Leaf 19
landing was slice 5 (three drift-ai files).

## Verification

Each merged leaf passed its scoped verification gates (at minimum `lint`,
`typecheck`, plus `test:scripts:changed` / `test:server` / `test:client` as
relevant). Per-leaf verification detail lives in `LOG.md` and the per-leaf
`finished_work/` notes.

## Landed On This Branch

Review the referenced finished_work notes or leaf docs for details:

- PRs 1, 2, 3a, 3b, and 4 (rule contract, harness manifest, machine-readable
  diagnostics, JSON emitters, custom lint ratchet).
- Leaves 01, 02, 05, 06, 08, 10a, 13a, 13b, 14a, 14b, 14c, 15, 15b, 21, 22,
  23, 24, 26, 27, 28, 29.2, and the full `local/type-assertion-boundary`
  package drain (batches 3a–6, ratchet now at 0 current findings).
- Leaf 41 coverage map, Batches 1-3 `local/max-lines` ratchets (codemods,
  drift-ai, ratchet/harness runtime), Batch 4 codemod test-harness bug-class
  ratchets (vitest + tseslint), Batch 5 core-rule source support, Batch 6
  first `complexity` ratchet (codemods), Batch 7 drift-ai mirror `complexity`
  ratchet, Batch 8 singleton `local/max-lines` ratchets, child leaf 41d
  coverage-map drift check, Leaf 41 eslint-rules floor Phases A, A.2, and B,
  Leaf 41 drift-ai test-harness bug-class ratchets, Leaf 38 top-level script
  project lint adoption, Leaf 41b ShellCheck floor plus Leaf 41d ShellCheck
  system-binary follow-up, Leaf 41c workflow/config sensors, Leaf 41
  metric-alignment Batch 1
  `effective-line-count` for `local/max-lines-*`, and Leaf 41 metric-alignment
  Batch 2 `complexity-severity` for the three `core-complexity-*` ratchets, plus
  the opportunistic lint-ratchet runtime `complexity-severity` coverage
  follow-up, the Leaf 41 root/package config-file linting block, and the Leaf
  41d staged coverage-map follow-up, the Leaf 41f proposed-row audit, Leaf 41g
  singleton floors, Leaf 41h eslint-rules Phase A.3 generic subset, and Leaf
  41i JSON changed/pre-commit gap, and Leaf 41j coverage-map ESLint reach.

## Historical Context

Per-leaf summaries and the evolution of the ratchet-first handoff live in
`LOG.md`. The lint-hardening backlog index is
`backlog/lint-hardening-cross-repo-review.md`, with the verdict register at
`backlog/lint-hardening/evaluation-verdicts.md`. Parked in-progress lint
context docs are retained for provenance and should only be opened when a
human asks for re-triage.
