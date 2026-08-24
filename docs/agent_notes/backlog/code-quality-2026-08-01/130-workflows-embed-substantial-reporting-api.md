# 130. CI workflows embed ~110 lines of reporting and GitHub-API shell inline in YAML instead of delegating to versioned scripts

Status: Landed on fix/cq-130
Theme: workflow shell extraction · Area: harness · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

Three workflow steps — the lint-ratchet step summary and the sticky PR comment
in `ci.yml`, and the step summary in `slow-drift.yml` — implement real programs
directly inside `run: |` blocks: envelope-existence checks with two distinct
fallback report shapes, a markdown-injection guard, temp-file lifecycle, a
paginated GitHub API comment upsert with its own jq-per-page correctness
subtlety, and a three-section summary assembler. That is about 110 lines of
shell whose only home is YAML.

Code that lives there is second-class in every way the repo's other shell is
not. It cannot be run locally, so the only way to exercise the
missing-envelope, formatter-failure, and comment-upsert branches is to push and
watch CI. It sits outside `scripts/lint-shell.sh`'s ShellCheck floor, outside
the shell-smoke suite, and outside anything `code:intel` or review tooling
treats as source. Its trickiest parts — the indent-instead-of-fence guard that
stops formatter output from injecting markdown into the PR comment, and the
`gh api --paginate` id-selection fix for multi-page comment lists — are exactly
the kind of hard-won correctness that deserves tests, and they have none. The
result is CI behavior split between registered repository commands
(`lint:ratchet:report`, `scripts/slow-drift-audit.sh`) and opaque inline
programs, in a repo whose workflows are among its most-copied surfaces as a
public harness-engineering reference.

## Evidence

- `.github/workflows/ci.yml:83-128` — "Lint ratchet step summary": 43 shell
  lines (`:86-128`) with a missing-envelope fallback (`:90-99`), a
  formatter-failure fallback capturing stdout/stderr via `mktemp`
  (`:101-125`), and the markdown-injection indent guard (`:115-119`).
- `.github/workflows/ci.yml:130-168` — "Sticky PR comment for lint-ratchet
  report": 31 shell lines (`:138-168`) defining a `post_comment` function that
  paginates `gh api` to find the marker comment (`:147-153`, including the
  per-page `--jq` newline pitfall documented at `:142-146`), then PATCHes the
  existing comment or creates a new one (`:155-162`).
- `.github/workflows/slow-drift.yml:51-89` — "Slow-drift step summary": 36
  shell lines (`:54-89`) assembling report, timings, and mutation-survivor
  sections into `$GITHUB_STEP_SUMMARY` with per-file fallbacks.
- Measured at the pin: 110 shell lines inside the three `run: |` blocks; the
  step spans total 124 YAML lines.
- Every block is CI-context-bound — `${{ }}` interpolation inside the scripts
  (`ci.yml:88`, `:138-139`, `:148`, `:157`), `$GITHUB_STEP_SUMMARY`
  (`ci.yml:128`, `slow-drift.yml:60,66,77,88`), and `GH_TOKEN` from
  `secrets.GITHUB_TOKEN` (`ci.yml:136`) — so none of it is runnable or
  testable outside a workflow run.
- The contrast already exists in the same file: `slow-drift.yml:44` delegates
  the audit core to `bash scripts/slow-drift-audit.sh`; only the reporting
  glue stayed inline.
- The structured formatter is already a registered command —
  `lint:ratchet:report` at `package.json:96` — so the inline block is glue
  around a command, not the formatter itself.
- `scripts/lint-shell.sh:2` declares itself the "ShellCheck floor for
  maintained shell scripts" (`lint:shell`, `package.json:75`); inline YAML
  blocks are invisible to it, as they are to the shell-smoke suite whose
  single-sourced registration header is visible at e.g.
  `scripts/tests/test-adr-check.sh:2-8` (`test:scripts:subjects`,
  `package.json:60`).
- `.github/workflows/ci.yml:72-86` — the comment stating that "CI-only
  report, docs, and artifact steps stay hand-written around that generated
  core", plus the `HARNESS_CI_GATE: verify-wrapper/verify` step env binding at
  `:83` and the `run: bun run verify` line at `:86` that parity compares
  against the control's manifest invocation (unit 115 replaced the former
  `# harness-ci-gate:` comment marker with step-level workflow data read by a
  real YAML parser).

## Proposed direction

Extract the three inline programs into small shell scripts under `scripts/`
(e.g. `scripts/ci/lint-ratchet-summary.sh`, `scripts/ci/sticky-pr-comment.sh`,
`scripts/ci/slow-drift-summary.sh` — the directory does not exist yet), each
taking its GitHub context (artifact URL, PR number, repository, marker, summary
target) via environment variables set in the workflow step's `env:` block
rather than `${{ }}` interpolation inside `run:`. Workflow steps become thin
`bash scripts/ci/<name>.sh` invocations — the pattern `slow-drift.yml:44`
already uses for `scripts/slow-drift-audit.sh`.

Register each script in the shell-smoke suite via the single-sourced
`# smoke-subjects:` headers (a `scripts/tests/test-<name>.sh` smoke listing the
new scripts as subjects, then `bun run test:scripts:subjects` to regenerate the
data + fixture files, both committed), so the missing-envelope,
formatter-failure, and comment-upsert branches get smoke coverage. Extraction
also brings the code under `scripts/lint-shell.sh`'s ShellCheck floor
automatically.

Explicitly not part of the fix:

- Do **not** create new TypeScript CLIs or JSON I/O contracts for this glue —
  `lint:ratchet:report` (`package.json:96`) already owns the structured
  formatting; plain shell scripts with env-var inputs are the right weight.
- Do **not** fold the steps into the `harness.controls.json` generated-manifest
  machinery — the `ci.yml:72-74` comment deliberately keeps CI-only report
  steps hand-written around the generated verify core.
- Preserve the `HARNESS_CI_GATE` step-env binding and its parity discipline
  (`ci.yml:83`, binding the `run:` at `:86`) unchanged. It must stay in the
  step's `env:` block, not move into a comment or a `run:` line:
  `harness:check` parses the workflow as YAML and compares the step's `run` to
  the control's manifest invocation.

Update the `ci.yml:72-74` comment in the same change: it currently contrasts
hand-written vs generated-from-manifest, which stays true, but it should not
read as a defense of inline shell once the steps delegate to scripts.

Run `bun run harness:check` after the workflow edits.

## Scope / caveats

- The sticky-comment script is only partially runnable locally even after
  extraction (it needs a real PR and token); its win is ShellCheck, review,
  smoke coverage of the branch logic, and reuse — not full local execution.
  The two summary scripts are fully exercisable locally against fixture files.
- Preserve the two load-bearing subtleties verbatim when moving them: the
  indent-instead-of-fence guard (`ci.yml:115-119`) and the paginated `--jq`
  id-selection comment and logic (`ci.yml:142-153`). They are the parts most
  worth smoke-pinning.
- Keep behavior identical: the summary steps' `if: always()` /
  `if: >- !cancelled() && …` conditions, the warning-and-`exit 0` soft-fail on
  comment posting (`ci.yml:165-168`), and the artifact-upload steps around
  them are workflow orchestration and stay in YAML.
- No new generated-surface facets, no `harness.controls.json` edits, and no
  changes to what the verify gate itself runs are in scope.
- Prior pack: no overlap — 2026-07-25 leaf 32 covers `.husky` hook shells and
  leaf 29 covers `scripts/` bash cores, neither touches workflows; the refused
  CQ25-144 was a workflow-*parsing* layout checker, a different problem. No
  sequencing edges with other leaves in this pack.
