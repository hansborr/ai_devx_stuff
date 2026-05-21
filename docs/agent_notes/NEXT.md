# Next Up

Promotion pointer for the next human-requested leaf. This file is not a FIFO
queue, and backlog numbering/order is advisory, not permission to keep pulling
work. Parked work stays in `backlog/` unless this file names it or a human
asks for re-triage.

## Ready now

Latest landing: Leaf 41j closed the reviewer #2 coverage-map trust gap. Full
`bun run docs:lint-coverage-map:check` now verifies that ESLint-managed files
matched by `linted` rows resolve a real ESLint config via the ESLint JS API,
while `--staged` keeps the pre-commit path cheap and skips the slow reach gate.
The concrete false negative, `scripts/codemods/tsconfig.json`, is now split
out as an excluded parser-project config instead of being accidentally claimed
by the root tsconfig row. Details:
`finished_work/lint-hardening-leaf-41j-map-eslint-reach.md`.

Prior landing: Leaf 41i closed the reviewer-flagged JSON changed/pre-commit
gap. Full lint already covered maintained JSON, but `lint:changed` dropped JSON
by extension and the pre-commit source allowlist missed five full-linted JSON
config files. The changed path now passes `*.json`/`*.jsonc` to per-file ESLint
without full-lint escalation, and the hook gates `.claude/settings.json`,
`.codex/hooks.json`, `.devcontainer/devcontainer.json`,
`.playwright/cli.config.json`, and `drift-ai.config.json`. Details:
`finished_work/lint-hardening-leaf-41i-json-changed-gap.md`.

Prior landing: Leaf 41h landed Phase A.3 for `eslint-rules/*.js` rule
implementations by extending the Phase A.2 non-type-aware block with the safe
generic subset: `simple-import-sort`, `eslint-comments` hygiene, and generic
`local/*` rules (`no-llm-artifacts`, `no-swallowed-errors`,
`no-async-array-callbacks`). The re-run probe found zero findings and no
ratchet was added; `eslint-rules/*.test.js` stayed excluded from this block.
Domain/path-specific local rules plus type-aware `local/no-explicit-any` and
`local/no-barrel` remain deferred as non-broad-shallow. Details:
`finished_work/lint-hardening-leaf-41h-eslint-rules-phase-a3.md`.

Lint-hardening review follow-up Tier 2 is the active iterative workstream on
`feature/lint-hardening-review-followup`. The current human-promoted leaf is
`backlog/lint-followups/41-ratchet-first-overlooked-lint-coverage.md`; the
organized follow-up queue lives in `backlog/lint-followups/00-index.md`.
Ratchet infrastructure leaves (`01`–`05`) and PRs 1–4, 3b are resolved — see
`LOG.md` and `finished_work/` for landing details. Do not reopen the
resolved leaves without a human ask.

The Leaf 41 coverage map landed at
`docs/agent_notes/backlog/lint-followups/lint-coverage-map.md` via merge
`b3c0ca0c`; every tracked row resolves to `{linted, ratcheted, proposed,
pending-leaf, excluded, not-code}` with no `unknown` rows. After Leaf 41j, no
`pending-leaf` rows remain and no tracked row carries a broad-shallow
`proposed` blocker; full map verification also checks actual ESLint reach for
ESLint-managed `linted` rows.

Prior landing: Leaf 41g closed the final four Leaf 41f broad-shallow
blockers: `scripts/code-intel.test.ts`,
`scripts/lint-ratchet-baseline.test.ts`,
`scripts/lint-coverage-map-check.ts`, and
`scripts/lint-coverage-map-check.test.ts`. The four files are now exact
ESLint re-includes from the global `scripts/**/*` ignore, the three tests have
script-test bug-class ratchets, and the coverage-map checker source has a
singleton `local/max-lines` ratchet. Broad-shallow Leaf 41 coverage is now
complete enough; future work should pivot to drains or explicitly named
deeper-rule leaves. Details:
`finished_work/lint-hardening-leaf-41g-singleton-floors.md`.

Prior landing: Codex review P2 follow-up for Leaf 41d tightened the
coverage-map staged-content gate. `scripts/lint-coverage-map-check.ts` now
accepts `--staged` and reads the map from `git show :...`; `verify --changed`
and `.husky/pre-commit` use that staged path, while full verify still reads the
worktree by design. A temp-repo Vitest regression catches the stale staged map
/ fixed worktree map failure mode. Details:
`finished_work/lint-hardening-leaf-41e-coverage-map-staged.md`.

Prior landing: Leaf 41d ShellCheck install-path follow-up swapped ShellCheck
from the pinned npm wrapper to the system `shellcheck` binary on `PATH`
(`apt install shellcheck`; this container reports `/usr/bin/shellcheck` 0.9.0,
down from the wrapper's upstream 0.11.0). `lint-shell.sh` fails with the apt
hint when shellcheck is missing, while `doctor.sh` reports the same gap as WARN
and continues. The smoke test still passes with ShellCheck 0.9.0.
`actionlint`, `taplo`, and `hadolint` stay on their npm wrappers because they
are not in the Debian/Ubuntu main repos. Details:
`finished_work/lint-hardening-leaf-41d-shellcheck-system-binary-followup.md`.

Prior landing: Codex review P2 follow-up for Leaf 41c fixed the first-run
`hadolint@0.4.2` wrapper cache failure on
`feature/lint-hardening-leaf-41c-config-sensors`. Fresh installs could download
`hadolint-2.14.0` with non-executable mode and fail the immediate spawn with
`EACCES`; `lint-config-sensors.sh` now primes the local wrapper only when the
cache is missing, chmods the downloaded binary, then invokes hadolint normally.
The smoke test now exercises the same wrapper path instead of injecting a
pre-chmodded cache binary. `actionlint` and `taplo` were checked and do not
have the same lazy executable download shape. Details:
`finished_work/lint-hardening-leaf-41c-hadolint-prime-followup.md`.

Prior landing: Leaf 41c yamllint install-path follow-up swapped yamllint from
the repo-local Python venv to the system `yamllint` binary on `PATH`
(`apt install yamllint`, version >=1.29.0; this container reports
`/usr/bin/yamllint` 1.29.0). `lint-config-sensors.sh` fails with the apt hint
when yamllint is missing, and `doctor.sh` reports a WARN instead of failing so
doctor still completes. `actionlint`, `taplo`, and `hadolint` stay on their npm
wrappers because they are not in the Debian/Ubuntu main repos. No `.yamllint.yml`
rule-profile changes were needed.

Prior landing: Codex review P2 follow-up for Leaf 41c fixed the
`node-actionlint` wrapper argv gap from `aca65e31`. The pinned wrapper calls
`run(args[0])`, so `run_actionlint()` now invokes actionlint once per collected
workflow file, echoes each path, and accumulates failures before returning
nonzero. A new two-workflow smoke fixture catches the formerly missed invalid
second workflow. `yamllint`, `taplo`, and `hadolint` were checked for native
multi-file argv support and left unchanged. Details:
`finished_work/lint-hardening-leaf-41c-actionlint-wrapper-followup.md`.

Prior landing: Leaf 41c workflow/config sensors added
`scripts/lint-config-sensors.sh` and `bun run lint:config-sensors` for GitHub
workflows, maintained YAML, TOML configs, and Dockerfiles. Install paths are
`@tktco/node-actionlint@1.6.0`, system `yamllint` from `PATH`
(`apt install yamllint`, version >=1.29.0), `@taplo/cli@0.7.0`, and
`hadolint@0.4.2` with upstream Hadolint pinned to 2.14.0. Full `bun run lint`,
changed `bun run lint:changed`, changed-gate
source relevance, and `.husky/pre-commit` now include the workflow/YAML/TOML/
Dockerfile floor. Findings were handled without a ratchet baseline. Details:
`finished_work/lint-hardening-leaf-41c-config-sensors.md`.

Prior landing: Leaf 41b ShellCheck floor added `scripts/lint-shell.sh` as the
maintained shell floor. The current follow-up install path resolves the system
`shellcheck` binary on `PATH` (`apt install shellcheck`, 0.9.0 in this
container), uses `--external-sources` and `--severity=warning`, and lets
ShellCheck infer shell dialects from shebangs. Full `bun run lint` and changed
`bun run lint:changed` now include the floor over 84 maintained shell files
spanning `scripts/**/*.sh`, `.husky/*`, `.codex/hooks/*.sh`,
`.claude/hooks/*.sh`, and `.devcontainer/*.sh`. Trivial findings were fixed in
source, and no ShellCheck ratchet adapter or baseline was needed.

Prior landing: Leaf 41 root/package config-file linting sub-batch B brought
the maintained root/package TS config files under normal ESLint with exact
re-includes from `**/*.config.{js,mjs,ts}`, a dedicated
`tsconfig.configs.json`, and a TS config block that uses project service while
leaving `local/max-lines` off. Newly covered findings were handled in source
(three import-sort autofixes, one Playwright retry constant, and awaited Vitest
slow-project config imports), so no ratchet or baseline update was needed.
Sub-batch A already covered `eslint.config.js`, `commitlint.config.js`, and
`stryker.config.mjs`. The Root/package config block is now done.

Prior landing: `ratchet/core-complexity-top-level-scripts` now uses
`complexity-severity`, closing the Batch 2 review gap where the Leaf 38
top-level scripts ratchet was the lone core `complexity` holdout. Baseline:
`scripts/sensor-blob-size.ts` count 1 / maxComplexity 11; the other three
scoped files have zero complexity findings. No function exceeded the >30
follow-up threshold. Details:
`finished_work/lint-hardening-top-level-scripts-complexity-severity.md`.

Prior landing: Codex review P2 follow-up for commit `45c47264` fixed live
`complexity-severity` new-path payload reporting. `collectCurrentById` does
not populate `maxComplexity` at runtime, so `newPathSeverityPayload` now uses
the highest-complexity `perFunction` entry for `currentComplexity` and `line`,
while keeping `maxComplexity` as a structural fallback. Details:
`finished_work/lint-ratchet-newpath-maxcomplexity-fix.md`.

Prior landing: an opportunistic Batch 2 review follow-up added
`ratchet/core-complexity-lint-ratchet-runtime` for
`scripts/lint-ratchet-baseline.ts`, `scripts/lint-ratchet-metrics.ts`, and
`scripts/lint-ratchet.ts`. The new `complexity-severity` baseline captured
counts/maxes of 5/44, 3/15, and 2/22 respectively while leaving the runtime
files excluded from normal `bun run lint`. `validateLintRatchetRegistry` at
complexity 44 is a separate follow-up candidate; no drain was done.

Prior landing: Leaf 41 ratchet-metric alignment Batch 2 converted
`ratchet/core-complexity-codemods`, `ratchet/core-complexity-drift-ai`, and
`ratchet/core-complexity-eslint-rules` to `complexity-severity`; its review
fix-up hardened count-only migration coverage, `complexity` messageId parsing,
new-path severity payloads, duplicate complexity identities, structured smoke
assertions, and the shrunk runtime line ceiling. Batch 1 and Batch 2 are done;
the metric-alignment plan is archived in `finished_work/`. Earlier batches
added the codemod, drift-ai, runtime, codemod-test, core-rule, singleton, and
eslint-rules ratchets; per-batch detail lives in the Leaf 41 / Leaf 38
`finished_work/` notes.

### Next Leaf 41 batches (named, in order)

Operating principle: **Leaf 41 broad-shallow coverage is complete enough after
Leaf 41j; pull only named drain/deeper-rule leaves next.** The Leaf 41f audit
removed stale `proposed` noise, Leaf 41g closed the final four remaining
floors, Leaf 41h landed the generic Phase A.3 subset for eslint-rule
implementations, Leaf 41i closed the JSON changed/pre-commit gap found in
review, and Leaf 41j made the coverage map verify actual ESLint reach for
`linted` rows. Cleanup/drain is no longer blocked by broad-shallow gaps, but should
still be promoted explicitly rather than pulled opportunistically from backlog
order.

1. **Landed child leaf 41d: Coverage-map generator/check.** Pre-commit-runnable
   script that validates stale map patterns, cited ratchet IDs, status
   vocabulary, and tracked lint-map extensions without full map regeneration.
   Full `Files` count, normal-lint membership, and ratchet membership
   re-derivation stay deferred unless promoted to a named follow-on leaf.
2. **Landed Root/package `*.config.{ts,mts,cts}` block.** Sub-batch A covered
   the root JS configs; sub-batch B covered the maintained TS configs with
   `tsconfig.configs.json` and exact re-includes. The root/package config block
   is done.
3. **Landed child leaf 41b: ShellCheck floor** over `scripts/**/*.sh`,
   `.husky/*`, `.codex/hooks/*.sh`, `.claude/hooks/*.sh`,
   `.devcontainer/*.sh`; Leaf 41d follow-up now uses system `shellcheck`
   (`apt install shellcheck`) instead of the former npm wrapper.
4. **Landed child leaf 41c: workflow / config sensors.** actionlint +
   yamllint + taplo + hadolint now cover workflows, agent/devcontainer config,
   TOML configs, and Dockerfiles through the local lint and changed/pre-commit
   paths.
5. **Landed child leaf 41g: remaining singleton broad-shallow floors.** The
   final four rows are now normal-linted and ratcheted. The three script tests
   use `ratchet/vitest-expect-expect-script-tests`,
   `ratchet/vitest-valid-expect-script-tests`,
   `ratchet/typescript-eslint-no-misused-promises-script-tests`, and
   `ratchet/typescript-eslint-only-throw-error-script-tests`; the source file
   uses `ratchet/local-max-lines-lint-coverage-map-check`. Broad-shallow is
   complete enough; pivot next to drain work or named deeper-rule leaves.
6. **Landed child leaf 41h: eslint-rules Phase A.3 generic subset.** The
   implementation-only block now applies `simple-import-sort`,
   `eslint-comments` hygiene, and generic `local/*` rules with zero findings
   and no ratchet. Rule tests remain outside this block.
7. **Landed child leaf 41i: JSON changed/pre-commit gap.** The changed path now
   lints staged JSON/JSONC directly, and the hook source allowlist includes the
   five full-linted JSON config paths that were missed in review.
8. **Landed child leaf 41j: Coverage-map ESLint reach.** The full map check now
   emits `eslint-reach-missing` for ESLint-managed files in `linted` rows that
   resolve no ESLint config. The staged/pre-commit path skips the JS API reach
   gate. `scripts/codemods/tsconfig.json` is now an excluded parser-project
   row, not a false-positive root tsconfig match.

Tradeoff: this ordering still defers deep drains (e.g., draining the
`local/max-lines` or `core/complexity` baselines to zero) potentially for
weeks. The Leaf 41f audit deliberately moved `max-params`, import-sort,
regexp, explicit return types, `consistent-type-imports`, and strict-tier
normal-lint adoption out of the broad-shallow blocker bucket where current
floors already cover the surface. A floor that exists everywhere still beats a
zero somewhere with gaps next door.

Opportunistic follow-ons after the named work (no scheduled order):

- Audit the domain/path-specific local rules that remained deferred after
  Leaf 41h. This is likely deeper per-rule work, not broad-shallow coverage;
  `local/no-explicit-any` stays type-aware and `local/no-barrel` stays
  barrel-pattern-specific for now.
- JSDoc lint plugin for `eslint-rules/*.js` — currently not a dependency.
- Additional core ratchets (`max-params`, `no-nested-ternary`) over the
  codemod or drift-ai families using Batch 5's core-source infra.

### Standing rules for all batches

Keep new ratchets in the local/pre-commit gate (external CI is not reliable
enough to be the only enforcement point). Land in small measured batches,
re-measure `bun run lint:ratchet` after each, improve the runner/sensor
rather than skipping a local floor. Each new ratchet's finished-work note
must state an explicit exit path (drain to zero by leaf X, or stays staged
because Y) so floors do not become indefinite parking.

## Promoting a new cycle

When this section is idle, do not pull from a backlog's suggested order
without a human asking for that specific next cycle. When a human does ask,
re-run the audit tools from a fresh checkout and promote exactly one leaf:

```bash
bun run drift:ai --scope current
bun run test:coverage
bun run test:mutation
```
