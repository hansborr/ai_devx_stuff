# 18. Idempotence (runTwice) is untested for the two mutating codemods that lack an idempotent fixture, despite full harness support

Status: Proposed — read-only finding from the test-suite audit; NOT implemented. Re-verify file:line before acting.
Lens: defect-catching · Area: scripts/codemods (fixtures) · Severity: med · Size: S · Confidence: high
Theme: wired-but-unexercised idempotence harness · Source: Musi test-suite audit 2026-06-13 (multi-agent, adversarially verified)

## Problem
A codemod that mutates files must be idempotent: re-running it over its own already-transformed output must be a no-op. Musi's codemod fixture harnesses encode this as a first-class property — each `case.json` may set `runTwice: true`, and when it does the harness runs the codemod a *second* time over the work tree and re-asserts that the tree still matches `after/` (so a non-idempotent second pass fails the test). The machinery is real and present in both relevant harnesses.

But the property is exercised almost nowhere. Across the entire fixture tree only **two** cases set `runTwice: true`: `trpc-shared-input/idempotent` and `structured-logging-fix/idempotent`. The two other genuinely file-mutating codemods — `expand-barrel` and `trpc-shared-output` — have **zero** idempotent fixtures between their ~38 combined cases (15 + 23). Both write to disk through the same library (`writeOrPreviewFiles` → `writeFileSync` in `scripts/codemods/lib/trpc-shared-schema-writes.ts`), so idempotence is a live correctness property for both, not a theoretical one.

The result is a wired-but-unexercised harness: the `runTwice` branch is compiled and ready in both test files, yet not a single `expand-barrel` or `trpc-shared-output` fixture flips it on. A second-pass regression — double-expanding an already-expanded barrel, or re-rewriting an output schema that is already shared — would sail through CI uncaught, because no test ever runs those two codemods twice. This matters for dogfood tooling the repo runs against its own source: a non-idempotent codemod that silently corrupts on a re-run is exactly the kind of defect these fixtures exist to catch, and the catch is one `case.json` flag away from working.

`concurrency-guard` is correctly *not* in scope here: it is an analyzer that only prints findings and never writes files (no `writeFileSync`, no `writeOrPreviewFiles`, no `runTwice` in its test or source), so it has no idempotence property to verify.

## Evidence
- `scripts/codemods/expand-barrel.test.ts:195-201` — the `if (metadata.runTwice)` branch re-runs `runExpandBarrelCodemod` a second time over the same work tree; the subsequent `expectDirectoriesToMatch(workRoot, expectedRoot(caseRoot))` at line 203 asserts the tree still matches `after/`. Harness fully supports idempotence checks for this codemod.
- `scripts/codemods/trpc-shared-schema-codemod.test.ts:239-247` — the `if (metadata.runTwice)` branch re-runs `runCodemod(kind, ...)` (covers both `trpc-shared-input` and `trpc-shared-output`); `expectDirectoriesToMatch(workRoot, path.join(caseRoot, "after"))` at line 249 re-asserts after the second pass.
- `scripts/codemods/fixtures/trpc-shared-input/idempotent/case.json:5` — `"runTwice": true` (the canonical pattern: un-transformed `before/`, transformed `after/`). `rg` over the whole fixture tree finds `runTwice` in only this file and `scripts/codemods/fixtures/structured-logging-fix/idempotent/case.json`.
- `scripts/codemods/fixtures/expand-barrel/` — 15 fixture dirs, none named `idempotent`, none setting `runTwice`. `scripts/codemods/fixtures/trpc-shared-output/` — 23 fixture dirs, none named `idempotent`, none setting `runTwice`. (`ls` count + `rg -l runTwice` confirms zero hits under either path.)
- `scripts/codemods/expand-barrel/run.ts:42` — mutates via `writeOrPreviewFiles(CODEMOD_NAME, root, plans, dryRun)`; `scripts/codemods/trpc-shared-output.ts:283` writes via the same `writeOrPreviewFiles` (imported line 27, re-exported from `scripts/codemods/lib/trpc-shared-schema.ts:7`). Both land at `scripts/codemods/lib/trpc-shared-schema-writes.ts:155` (`writeFileSync(plan.path, plan.text)`), confirming both are genuine file-mutating codemods.

## Proposed direction
Add exactly one `idempotent/` fixture per mutating codemod that lacks one — `expand-barrel` and `trpc-shared-output` — modeled on the existing `trpc-shared-input/idempotent` pattern, not on the candidate's prescribed shape:

- `before/` holds an **un-transformed** input (e.g. for `expand-barrel`, a real barrel import to expand; for `trpc-shared-output`, a router with a router-local output schema to share).
- `after/` holds the **transformed** result.
- `case.json` sets `"runTwice": true` (plus the usual `args`/`expectedStdout`).

With this shape, the single fixture verifies *both* first-transform correctness (`before → after`) **and** second-pass stability (second run leaves `after/` untouched) — strictly more coverage than a `before == after` no-op fixture, because it also proves the transform itself is correct before it proves the re-run is a no-op. No harness change is needed; the `runTwice` branches already exist and are exercised by the new flag. This is purely additive: two new fixture directories, no edits to existing fixtures, codemod source, or test code. Coverage only grows.

Estimated impact: closes the only two mutating codemods whose idempotence is wired-but-never-checked, turning a silently-dormant `runTwice` branch into an active guard against double-transform regressions in disk-writing dogfood codemods. Negligible run-time cost (two fixtures, each running its codemod twice over a tiny tree).

## Scope / caveats
Touch only `scripts/codemods/fixtures/` — add `expand-barrel/idempotent/{before,after,case.json}` and `trpc-shared-output/idempotent/{before,after,case.json}`. Do not modify any harness, codemod source, the write lib, or existing fixtures. Tooling weighting applies: per repo guidance, codemod/dogfood coverage (`scripts/**`) is weighted above product code, and this is squarely scripts-side tooling.

Follow the existing `trpc-shared-input/idempotent` shape (un-transformed `before`, transformed `after`), **not** the candidate's originally-suggested shape (an already-transformed `before` with an identical `after`) — the idiomatic pattern catches strictly more by also asserting the forward transform. `concurrency-guard` is intentionally out of scope (analyzer-only, no write path, no `runTwice`).

This is a `scripts/codemods` fixture finding — distinct from the two eslint-rules findings in this pack (those cover `eslint-rules/**`). No overlap with the 37 other slugs. Risk: low. The only way a new fixture fails is if a codemod is *actually* non-idempotent on the second pass — which is precisely the latent defect this finding exists to surface, so a failing fixture is the intended, correct outcome.
