# 19. `--update` runs weaker preflight than the default gate, and preflight/collection expand globs differently — unify both, plus share one GFM-escaping helper

Status: Proposed — from the 2026-07-01 AI-harness review; NOT implemented. Re-verify file:line before acting.
Lens: ratchet · Area: modes · Severity: med · Size: S-M · Confidence: high
Theme: mode-parity · Source: Musi AI-harness review 2026-07-01 (multi-agent + Codex second opinion + web research)

## Problem
Three parity gaps flagged by the Codex second-opinion review, all verified:
(a) The default (read-only, gating) mode runs the FULL registry preflight — shape, empty-glob, absolute-path, orphan-baseline, harness-manifest — while `--update`, the one mode that *rewrites the committed floor*, runs shape-only validation. A typo'd glob that matches zero tracked files, or an absolute path, is caught when checking but not when writing: `--update` will happily commit a baseline generated from a broken scope, and the failure surfaces later on someone else's default run.
(b) Preflight and the zero-baseline audit decide "which files does this ratchet cover" from `git ls-files` + the in-repo glob matcher, but actual collection hands the raw globs to a spawned ESLint (`--no-error-on-unmatched-pattern`), which expands them itself over the working tree — untracked files included, with ESLint's own glob dialect. Two expansion semantics for one concept means the empty-glob check and the collector can disagree about what a ratchet covers.
(c) Minor: the debt-log renderer carefully escapes every markdown table cell, but the CI report formatter interpolates raw finding text (`why`, `howToFix`, backtick-wrapped paths) into GFM — a `|`, backtick, or HTML in a rule message can break the sticky PR comment.

## Evidence
- (a) `/workspace/scripts/lint-ratchet/modes.ts:288-298` (the review's "~line 288" citation holds) — `mode === "default"` → `assertRegistryPreflight()` (full `checkLintRatchetRegistry`: `lint-ratchet-check-registry.ts:149-160,219-225`); every other validated mode including `update` → `validateRegistry()` (`modes.ts:109-118`), which calls only shape-level `validateLintRatchetRegistry`.
- (b) `/workspace/scripts/lint-ratchet/lint-ratchet-check-registry.ts:108-122,212` and `lint-ratchet-zero-baseline.ts:304` — `trackedFilesFromGit` (`git-tracked-files.ts:6-16`) + `matchesRatchet`; vs `/workspace/scripts/lint-ratchet/eslint-runner.ts:123-130,139` (the "~line 123" citation holds) — `runEslint` passes `ratchet.files` globs as positional ESLint args. The limited in-repo glob dialect is documented at `docs/guides/lint-ratchet.md:174-178`; the git-tracked assumption at `lint-ratchet-adoption.md:71-74`.
- (c) `/workspace/scripts/lint-ratchet/lint-ratchet-debt-log.ts:26-42` — `escapeCell` escapes `\\ | ` < >` and newlines for every cell; `/workspace/scripts/lint-ratchet/lint-ratchet-report.ts:117-121` (cited ~117, holds) — `formatFindingBullet` interpolates `finding.why`/`finding.howToFix` raw; `:104-109` wraps paths in backticks with no escaping.

## Proposed direction
(a) Route `--update` (and `--check-baseline`) through `assertRegistryPreflight` too, with one deliberate carve-out: the `orphan-baseline` failure kind must be downgraded/skipped for `--update`, because resolving orphans (renames/removals via `--allow-worse` or `--retire-ratchet`) is exactly `--update`'s job (`baseline-update-apply.ts` / `decideLintRatchetUpdate` own that path). Empty-glob, absolute-path, and manifest checks apply unconditionally.
(b) Expand once: compute the tracked-file expansion per ratchet (already implemented for preflight) and pass the explicit file list to `runEslintForFiles` — the seam already exists and is the documented cache-safe shape (`eslint-runner.ts:106-115`). Chunk argv for large file sets; keep `--no-error-on-unmatched-pattern`. Behavior change to state in the commit: untracked files stop being counted, which *matches* the documented git-tracked assumption rather than violating it.
(c) Extract `escapeCell` (or a shared `markdown-escape` module both import) and apply it to message-derived text and paths in the report formatter; table-specific `|` escaping only matters in the debt-log tables, so keep two thin call-site wrappers over one core escaper.

## Scope / caveats
- These are three independent commits — (a) preflight parity + tests for the orphan carve-out; (b) expansion unification + a test proving preflight and collection agree on a fixture with an untracked file; (c) the escaping helper. Do not combine.
- (b) is the riskiest: passing explicit paths changes ESLint's ignore interaction (positional files are linted even if config `ignores` would skip patterns — verify the generated config's `ignores` block still filters, since `eslint-config.ts:54` emits a global `ignores` entry which does apply to positional args). Add a fixture asserting an ignored path stays excluded.
- (a) makes `--update` slightly slower (one `git ls-files`); negligible next to collection.
