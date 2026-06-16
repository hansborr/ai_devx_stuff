# 54. drift-ai tmpdir tests are collision-prone and leak (no mkdtempSync, no cleanup)

Status: Proposed — read-only finding from the test-suite audit follow-up; NOT implemented. Re-verify file:line before acting.
Lens: defect-catching · Area: scripts/drift-ai · Severity: med · Size: S-M · Confidence: high
Theme: tmp-dir-hygiene · Source: Musi test-suite audit follow-up 2026-06-14 (post-merge re-review, adversarially verified)

## Problem
Five `scripts/drift-ai/*-command.test.ts` files build their working tmpdir as a single deterministic path — `path.join(tmpdir(), \`<prefix>-${process.pid}-${Date.now()}\`)` — with **no `mkdtempSync`** to guarantee uniqueness and **no cleanup** (no `afterEach`/`afterAll`, no `rmSync`, no `tempRoots` drain). The dir is then created with `mkdirSync(dir, { recursive: true })`.

This is collision-prone on two axes:

1. **Same-file, same-millisecond collisions.** Every one of these files has ≥2 `it()` blocks that each call the local fixture builder (and thus re-evaluate the `process.pid}-${Date.now()` path). `process.pid` is constant within a run and `Date.now()` has millisecond resolution, so two `it()`s that build a fixture within the same millisecond produce an **identical** path. Because the builder uses `mkdirSync(..., { recursive: true })`, the second build does not fail — it silently **merges** its fixtures into the first test's directory. That is latent cross-test contamination: test B's input files land alongside test A's, and whichever test reads the dir can pick up the other's fixtures, producing a flaky pass/fail that depends purely on sub-millisecond timing. `mkdtempSync` exists precisely to eliminate this class of collision (it appends a random suffix and returns the unique created path); these five files are the drift-ai outliers that skip it.

2. **Leaked temp dirs.** With no cleanup hook, every run leaves these fixture trees behind in `tmpdir()`. The drift-ai suite already establishes the cleanup convention elsewhere (the `tempRoots` array + `afterEach` drain pattern catalogued in finding #32), so these five are a hygiene regression against an in-repo norm, not a missing-convention problem.

Per the repo's tooling-over-product weighting (`scripts/**` is the dogfood drift-ai tool, the repo's lowest-coverage / highest-weighted project — "the repo IS the tool"), a latent contamination + leak bug in the tool's own test harness warrants its own leaf rather than being folded into a product-code sweep.

## Evidence
The same anti-pattern appears verbatim (only the prefix string differs) in all five files. Each cited line is the tmpdir construction; the following line is the `mkdirSync(..., { recursive: true })` that silently merges on collision. `rg -l 'mkdtempSync' scripts/drift-ai` confirms these five are **absent** from the (large) set of drift-ai tests that DO use `mkdtempSync`, and `rg -n 'rmSync|afterEach|afterAll|tempRoots'` over the five returns nothing — confirming no cleanup.

- `scripts/drift-ai/env-branches-command.test.ts:67` — `const dir = path.join(tmpdir(), \`drift-env-branches-${process.pid}-${Date.now()}\`);` then `mkdirSync(path.join(dir, "src"), { recursive: true })` (:68), inside `writeFixtureRepo` (:66-73). Two `it()`s call `writeFixtureRepo` (the dispatch case :21 and the unmet-prerequisite case :42), so a same-millisecond run of both collides.
- `scripts/drift-ai/config-inspect.test.ts:194` — `const dir = path.join(tmpdir(), \`drift-config-inspect-${process.pid}-${Date.now()}\`);` then `mkdirSync(dir, { recursive: true })` (:195). 11 `it()` blocks in this file, all routing through the same builder — the highest collision surface of the five.
- `scripts/drift-ai/class-construction-command.test.ts:121` — `const dir = path.join(tmpdir(), \`drift-class-construction-${process.pid}-${Date.now()}\`);` then `mkdirSync(path.join(dir, "src"), { recursive: true })` (:122). 4 `it()` blocks.
- `scripts/drift-ai/coverage-evidence-command.test.ts:50` — `const dir = path.join(tmpdir(), \`drift-coverage-evidence-${process.pid}-${Date.now()}\`);` then `mkdirSync(dir, { recursive: true })` (:51). 2 `it()` blocks.
- `scripts/drift-ai/coverage-unused-correlation-command.test.ts:69` — `const dir = path.join(tmpdir(), \`drift-coverage-unused-${process.pid}-${Date.now()}\`);` then `mkdirSync(dir, { recursive: true })` (:70). 3 `it()` blocks.
- Imports `from "node:fs"` are `{ mkdirSync, writeFileSync }` in all five (line 1) — no `mkdtempSync`, no `rmSync` — and `tmpdir` from `node:os` (line 2). `rg -n 'rmSync|afterEach|afterAll|tempRoots'` over the five → zero hits (no cleanup). All five exercise `runDriftAi` from `./runner.js`.

## Proposed direction
Touch only these five test files; behavior and assertions are unchanged.

1. **Collision-proof the construction.** Replace each `path.join(tmpdir(), \`<prefix>-${process.pid}-${Date.now()}\`)` with `mkdtempSync(path.join(tmpdir(), "<prefix>-"))`, which creates and returns a guaranteed-unique directory in one call (and removes the now-redundant top-level `mkdirSync(dir, ...)`; the `mkdirSync(path.join(dir, "src"), ...)` subdir creates in env-branches/class-construction still apply). Add `mkdtempSync` to the `node:fs` import.

2. **Register cleanup.** Add a module-scope `afterEach` (or `afterAll`) that `rmSync(root, { recursive: true, force: true })` the dirs each file created (track them in a small module-scope array, matching the established `tempRoots` drain idiom). Add `rmSync` to the `node:fs` import.

Cross-reference **finding #32** (`32-scripts-tmp-repo-scaffold-no-shared-helper.md`): the natural long-term home for both behaviors is the shared `scripts/test-support` / `*.test-helper.ts` `makeTempRepo`/`registerTempRootCleanup` module that #32 proposes — a helper that does the `mkdtempSync` build AND the cleanup registration would fix this finding and #32's duplication in one extraction. Mind #32's "afterEach-registration-scope trap": register the cleanup hook at module/collection scope, never from inside an `it()` callback.

## Scope / caveats
- This finding is **DISTINCT from #32**, and the two target *opposite populations*. #32 targets files that **do** drain via a `tempRoots` array + `afterEach` and merely **duplicate** the scaffold (a maintainability/extraction concern). THIS finding targets the five files that have **neither** `mkdtempSync` **nor** any cleanup — a defect-catching concern (collision-prone construction + leaked dirs). The two are complementary: fixing #54 by adopting #32's proposed shared helper is the ideal convergence, but #54 stands alone as the bug.
- Touch only the five `scripts/drift-ai/*-command.test.ts` files listed in Evidence. No product-code (`packages/**`) changes; no drift-ai source (`runner.js`, the command implementations) changes; no assertion changes — coverage is fully preserved.
- The collision is timing-dependent (sub-millisecond `it()` execution), so it may not reproduce on every run; the fix is preventive. `mkdtempSync` is the standard, unconditional fix regardless of whether a flake has yet been observed.
- No runtime-speed claim — the work is fs-bound and unchanged; the value is eliminating a latent contamination class and stopping the tmp-dir leak.
