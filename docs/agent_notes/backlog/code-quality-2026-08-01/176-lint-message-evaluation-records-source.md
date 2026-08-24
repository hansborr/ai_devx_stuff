# 176. Lint-message evaluation reports a commit it does not verify

Status: Landed on fix/cq-169
Theme: trace provenance integrity · Area: harness · Severity: low · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

A lint-message trace records a commit, filename, inclusive source range, and copied source, but production evaluation never checks that those values describe the same Git blob. It lints the copied source and then labels the supplied SHA as the “Evaluated commit.”

The committed pilot has a test that compares its copied source with the current working tree. That uses the range correctly, but it neither reads the named commit nor applies to arbitrary `--trace` inputs. A stale or fabricated trace can therefore retain authoritative-looking provenance while evaluating unrelated text.

## Evidence

- `scripts/lint-message-eval/trace.ts:20-35` defines fixture filename, start/end lines, copied source, and the run-level `gitCommit`.
- `scripts/lint-message-eval/trace.ts:83-119` validates positive ranges and full-SHA syntax but performs no repository lookup or source comparison.
- `scripts/lint-message-eval/evaluator.ts:127-145` derives messages and lint results from `fixture.source` and `fixture.filename`; `evaluateLintMessageTrace` merely copies `trace.gitCommit` into the result at `:212-235`.
- `scripts/lint-message-eval.test.ts:213-226` compares the committed pilot’s source ranges with working-tree files. This is test-only and does not use `trace.gitCommit`.
- `scripts/lint-message-eval.ts:28-54` accepts an arbitrary `--trace` file and sends it directly to evaluation.
- `scripts/lint-message-eval/reporter.ts:27-35` renders the unchecked SHA as `Evaluated commit`.
- The two pilot fixtures at `scripts/fixtures/lint-message-eval/2026-07-15-codex-pilot.json:5-13` and `:33-37` both match their named Git blobs and ranges at commit `ce9d060a16d6d3be00572897f0e221153cecd943` (2/2, re-derived at the audit pin).

## Proposed direction

Bind fixture source to provenance during evaluation. For each fixture, read `gitCommit:filename`, select the inclusive `sourceLine..sourceEndLine` range, and require an exact match with `fixture.source` before running ESLint.

Use the existing Git substrate rather than adding direct process plumbing: `scripts/lib/git.ts:44-60` provides `defaultGitRunner` and `readGitBlobAtRef`. Inject the runner or blob reader into the evaluator so unit tests can cover matching, missing-blob, out-of-range, and mismatched-source cases without a live repository.

Move the committed-pilot assertion from working-tree comparison to this commit-bound path. Apply the same validation to every input reaching `evaluateLintMessageTrace`, including the CLI’s `--trace` path. Once that binding exists, retain the report’s `Evaluated commit` label.

If replay against the capture commit is not the intended trust model, take the explicit alternative instead: relabel the SHA as unverified capture metadata and document that the working-tree pilot test is the only source binding. Do not keep the current verified-sounding label with production behavior unchanged.

## Scope / caveats

A missing commit or path—such as in a shallow clone—should be an evaluation infrastructure error, not a lint-message outcome.

Preserve the current inclusive line-range semantics and exact source bytes; do not silently normalize or fall back to the working tree after a Git lookup fails.

This leaf does not redesign the experiment, expand its sample, or change control/treatment scoring and reporting.
