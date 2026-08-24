# 231. Fail closed when similarity-ts output no longer matches the supported protocol

Status: Landed on fix/cq-231
Theme: Fail closed when similarity-ts stdout no longer matches the supported protocol · Area: harness · Severity: medium · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The optional near-duplicate analyzer invokes an unpinned external binary and
parses its human-readable stdout as a private protocol. Pair lines, source
ranges and scores are recognized through exact presentation markers, but the
adapter records no supported tool or protocol version.

A presentation change can therefore exit with status 0 while producing
non-empty output the parser does not recognize. The adapter converts that into
an empty successful result, so a broken integration is reported as a clean
scan rather than as an analyzer failure. This creates silent false negatives
precisely when the external tool changes independently of the repository.

## Evidence

- `scripts/drift-ai/README.md:536-539` — the documented optional-engine install
  command fetches `similarity-ts` without pinning a supported release.
- `scripts/drift-ai/near-duplicates-runner.ts:141-159` — after spawning the
  binary, status 0 is accepted as success regardless of whether parsing
  recognized any pair or any output.
- `scripts/drift-ai/near-duplicates-runner.ts:180-198` — the parser skips every
  unrecognized line and returns only accumulated pairs, with no signal for
  unexpected or incompletely consumed stdout.
- `scripts/drift-ai/near-duplicates-runner.ts:215-246` — decoding depends on
  the exact `" <-> "` pair separator, colon and hyphen range punctuation,
  spacing before the function name, `"Similarity:"` prefix and percent sign.

## Proposed direction

Declare the `similarity-ts` release or output-protocol version supported by the
adapter and pin that compatibility in the install documentation. If that
supported release exposes a stable structured-output mode, request it and
validate its complete shape; otherwise treat the current text grammar as an
explicit versioned adapter contract.

Change parsing to distinguish three outcomes: recognized pairs, a
contract-defined valid zero-pair response and unsupported output. A successful
subprocess with non-empty stdout that contains no recognized protocol record
must return an adapter failure with a bounded diagnostic, not `{ ok: true,
pairs: [] }`. Empty stdout should count as a valid zero-pair result only when
the declared protocol defines it that way.

Extend `scripts/drift-ai/near-duplicates.test.ts` with fixtures for a normal
pair result, the protocol's valid zero-pair form, malformed non-empty output and
a simulated changed protocol that still exits 0. Assert that only the valid
zero-pair case reports a clean empty result and that malformed or changed
output follows the existing analyzer-failure path.

## Scope / caveats

- This leaf is limited to the `similarity-ts` adapter. It does not introduce a
  general result-protocol framework for every drift-ai analyzer or subprocess.
- Preserve the existing filtered file inventory, thresholds, pair ordering,
  score normalization, tool-unavailable skip and non-zero-exit behavior.
- A valid empty result and parser failure must remain observably distinct; do
  not fail every zero-pair run merely because no pair was produced.
- Prefer structured output only if the supported installed tool provides it.
  Otherwise pin and validate the text protocol rather than inventing an
  unsupported invocation mode.
- [140-analyzer-presentation-logic-uses-english.md](./140-analyzer-presentation-logic-uses-english.md)
  covers two repository-owned prose protocols used as outcome discriminants.
  It does not cover this external binary's version or stdout grammar, so the
  remedies remain separate.
