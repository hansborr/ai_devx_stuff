# 10. Replace the refuse-and-recipe baseline merge driver with a true three-way semantic merge that takes the minimum floor

Status: Proposed — from the 2026-07-01 AI-harness review; NOT implemented. Re-verify file:line before acting.
Lens: ratchet · Area: merge-driver · Severity: high · Size: M-L · Confidence: med
Theme: baseline-merge-conflicts · Source: Musi AI-harness review 2026-07-01 (multi-agent + Codex second opinion + web research)

## Problem
The lint-ratchet baseline merge driver deliberately refuses every textual merge: it keeps the 'ours' temp file, prints a recovery recipe ("finish other conflicts, then `bun run lint:ratchet:update`"), and exits 1. In a repo with one contributor that is a safe teaching device. In a multi-contributor repo with heavy debt being drained in parallel (the adopting repo where this design was reused), it means EVERY pair of PRs that both moved any ratchet floor conflicts on `lint-ratchet.baseline.json`, and every such merge demands a manual regeneration ritual — even in the overwhelmingly common case where the two sides drained *different* debt and a mechanical merge is trivially correct. The driver also warns that during rebase the kept side is swapped (upstream base, not your branch), which is a real footgun in the current design.

## Evidence
- `/workspace/scripts/git/lint-ratchet-baseline-merge-driver.sh:4-7,26-52,54` — driver refuses textual merges, keeps 'ours' (`current_file=$2`, never rewritten), prints the recipe, exits 1. It receives `%O %A %B %L %P` (base/ours/theirs available) but reads none of the JSON.
- `/workspace/scripts/git/lint-ratchet-baseline-merge-driver.sh:29-31` — rebase side-swap warning ("the kept version is the upstream base, not the branch being rebased").
- `/workspace/.gitattributes:11` — `/lint-ratchet.baseline.json merge=lint-ratchet-baseline`; `:7` gives the debt-log `merge=union`.
- `/workspace/scripts/git/install-lint-ratchet-merge-driver.sh:37-40` — driver command wired with `%O %A %B %L %P`; `merge.lint-ratchet-baseline.recursive` is set to `binary` (criss-cross internal merges), which a semantic driver should keep or handle.
- `lint-ratchet.baseline.json` (~25KB, verified) — `{ version, tests: { "<ratchet-id>": { ruleId, mode, target, metric, files, ignores, ruleOptions, configHash, ruleSourceHash, items: { "<file>": { count, ... } } } } }`; deterministic sort enforced at `/workspace/scripts/lint-ratchet/baseline-validation.ts:165-167`, format at `baseline-format.ts:91-114`.
- `/workspace/scripts/lint-ratchet/modes.ts:120-143,178-187` — the gate is symmetric (regressions AND unlocked improvements fail), so a merged baseline that is too low is caught and legitimately demands `lint:ratchet:update`; too high would silently raise debt. Minimum is the safe direction.
- Non-count metrics exist: items may carry `lines`, `maxComplexity`, `perFunction` (`/workspace/scripts/lint-ratchet/edit-check.ts:95-107`), though all 12 current entries are `message-count` (`lint-ratchet-config.ts:116-343`).
- Prior art: imbue-ai/ratchets (https://github.com/imbue-ai/ratchets) — per-directory budget files and a merge driver that resolves conflicting counts by taking the minimum.

## Proposed direction
Implement the merge in a bun script (e.g. `scripts/lint-ratchet/baseline-merge.ts`) invoked from the shell driver, keeping the current refuse-and-recipe behavior as the fallback whenever parsing/bun fails or the semantic rules below cannot resolve. Parse `%O` (base), `%A` (ours), `%B` (theirs). Per ratchet entry:
- Entry identical on both sides → keep. Entry changed on one side only vs base → take the changed side (this alone kills the "two PRs drained different rules" conflict class).
- Both sides changed, `configHash`/`ruleSourceHash`/metadata identical → merge `items` per file key: both present → MIN count (ratchet philosophy: the lower floor wins; the symmetric gate plus the leaf-12 post-merge truth-up demands regeneration if the merged code is actually worse); present on one side only → missing-as-drained, i.e. drop the item (min semantics with the other side at 0). For `lines`/`maxComplexity`/`perFunction` payloads, take the side with the lower count, or min the scalar payloads; if in doubt, refuse just that entry.
- `configHash` or `ruleSourceHash` differing on both sides vs base → not textually resolvable; either exit 1 with the existing recipe scoped to that entry, or take one side and rely on the staleness gate (`baseline-validation.ts:35,46-49`) to force `lint:ratchet:update`.
Write the result through the same deterministic formatter, exit 0 on a fully clean semantic merge. Because the three-way rules are symmetric in ours/theirs, the rebase side-swap problem disappears for resolved entries; keep the swap warning only in the fallback path. Update the Merge Conflicts section of `docs/guides/lint-ratchet.md:583-679` to describe the new common case.

## Scope / caveats
- MUST pair with leaf 12: merge commits skip pre-commit (no `.husky/pre-merge-commit` exists — verified; `scripts/land.sh:12-13,41-47` verifies the branch tip, not the merge result), so an exit-0 semantic merge needs the post-merge truth-up plus CI (`.github/workflows/ci.yml:79-85`) as backstops for the "merged code is worse than min" case.
- The installed driver is a *copy* in the git common dir (`install-lint-ratchet-merge-driver.sh:31-35`); keep the semantic logic in-repo (bun script resolved from the worktree) and let the copied shim fall back to refuse when the script or bun is unavailable — otherwise stale copies diverge silently.
- One commit is feasible (merge module + tests + shim + installer + guide). If it grows, split: (1) `baseline-merge.ts` with exhaustive fixture tests (side-only, both-min, drained, hash-drift, malformed JSON), (2) driver shim + installer + docs.
