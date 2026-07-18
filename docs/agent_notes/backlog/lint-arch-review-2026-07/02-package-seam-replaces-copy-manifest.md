# 02 — Replace the copy manifest with a real package seam

Status: DONE 2026-07-18 — all six slices (S0–S5) landed on main via
`feat/lint-ratchet-package-seam` (merges 0d053025 S0, 696a58ae/b5fa7b14 S1,
23446d12 S2, 955fd5bc S3, 9ce380e5 S4, 6e685069 S5). The engine lives in
`tools/lint-ratchet` (`@musi/lint-ratchet`, layers 1–3: kernel, git-rail,
governance) behind a threaded `LintRatchetEngineContext`/`Binding` seam; the
Musi adapter (layer 4) stays in `scripts/lint-ratchet/`; the demo is a
workspace-member consumer with its own adapter, exercised end to end
(install → collect → merge driver → truth-up → propose) by its CI-tier
`smoke.sh`. The copy manifest, expander, demo-sync checker, and mirrored
engine copy are deleted; every S3 transitional wire is reversed. Each slice
passed a two-model pre-land review (codex + Opus) with confirm-then-fix.
Implementation amendments 1–3 are recorded in
[02-slice-plan.md](./02-slice-plan.md). Open follow-up (pack-level): the
debt-accounting path-diff lacks a net-neutral-rename primitive — moving a
baselined file forces either fake debt or a genuine fix (S3 hit this;
resolved via Option B there, but the tooling gap stands).
History: owner ruling 2026-07-16; dispatch rulings 2026-07-17 (four-model
consult under owner-delegated authority); slice plan codex-reviewed over
three rounds and approved 2026-07-17.
Priority: P0 · Size: L · Risk: medium
Source: lint architecture review 2026-07-16 (R2) — P0 from Opus, GPT, and
Grok; GPT ranked it above leaf 01. Headline claim spot-verified against
source during synthesis. Do AFTER leaf 01 converges the baseline stacks
(packaging the duplicated code would enshrine it), but design the seam
concurrently with 01.

## Problem

`scripts/lint-ratchet/portable-manifest.json` declares "the portable
surface" as one scoped wildcard (`scripts/lint-ratchet/*.ts` minus tests,
test-helpers, and `lint-ratchet-config.ts`) plus two explicit file lists —
in effect the entire engine directory. Adopters
inherit debt accounting, trend, propose, edit-check, retirement proofs, and
complexity metrics, then are told by the adoption guide to delete registry
helpers and stub the rule-doc loader. Keeping the fork honest costs a
dedicated harness (verified at HEAD 2026-07-16):
`scripts/lint-ratchet/portable-manifest-expand.ts` (134 LOC),
`scripts/check-lint-ratchet-demo-sync.ts` (320 LOC) plus its test (374
LOC), doing byte-parity against a full mirrored engine copy under
`examples/lint-ratchet-demo/` — ~830 lines whose only job is compensating
for a missing architectural seam, plus every engine edit landing twice. Meanwhile `scripts/lint-ratchet/lint-ratchet-config.ts` (~530 LOC)
co-locates the portable type system with Musi's production ratchet registry
and Musi glob imports, so the types adopters need live inside the one file
they are told to exclude.

## Do

Carve the engine into four explicit layers with injected configuration and
zero Musi imports:

1. **kernel** — registry types, collect, compare, update, baseline I/O.
2. **git rail** — merge driver + truth-up.
3. **governance extensions** — debt log, zero-baseline lifecycle,
   trend/report, agent diagnostics — each optional.
4. **repo adapter** — Musi's registry data, paths, harness-manifest wiring.

Even an internal workspace package beats the directory fork. Split
`lint-ratchet-config.ts` into portable types and a Musi registry data file
(the registry/types co-location was independently flagged by Opus, GPT, and
Grok).

## Payoff

The package boundary *becomes* the portable surface:
`portable-manifest-expand.ts` and the demo-sync harness (~1,000 LOC) are
deleted, and `examples/lint-ratchet-demo/` becomes an ordinary consumer.
Highest-leverage change for the public-reference mission — a count-only
adopter should need a handful of modules, not a pruned fork.

## Design ruling — 2026-07-16 (owner)

Overturn lint-deep-dive 71's *mechanism*, keep its *restraint*:

1. **Target shape: internal workspace package** (Bun workspaces already
   exist), carrying the four layers above. **No external publication** —
   leaf 75's demand-based deferral of published-package/separate-repo
   extraction still holds; an internal package needs no external demand to
   justify deleting the sync harness.
2. **71's engine-context design survives intact** — it *is* layer 4: the
   `LintRatchetEngineContext` the Musi adapter constructs becomes the
   injected configuration the kernel receives. 71's acceptance tests
   (non-Musi fixture context, import-boundary check, byte-identical Musi
   behavior) carry over as this leaf's acceptance tests, with the
   import-boundary check becoming structural (package deps + ESLint
   import-boundary/knip) instead of byte-parity of copies.
3. **Grounds.** (a) The carrying cost is quantified above and no longer
   matches 71's "cheaper seam to harden first" premise. (b) Sharper: leaf
   01 moves the kernel onto `scripts/lib/baseline/`, so the portable
   surface stops living in one directory — the manifest's single scoped
   wildcard breaks and the sync harness must grow to span two trees right
   as the stacks converge. 71's premise does not survive leaf 01, which
   this pack already commits to.
4. **Kernel placement:** `scripts/lib/baseline/` lands inside the package
   as the kernel layer; knip/max-lines/near-duplicates import it from
   there.
5. **Pull the `lint-ratchet-config.ts` registry/types split forward** as an
   independent slice — valuable regardless and it can precede the package
   move.
6. Leaf 08's validation ruling is an input to the kernel boundary; the
   stale-Zod-ban finding recorded there tilts it toward Zod throughout.
   **Recorded 2026-07-17: the ruling is now Zod throughout** (see leaf 08's
   "Design ruling — 2026-07-17"); it also folds in the missing enabling link —
   `zod` had to be added to the **root** `package.json`, not just allowlisted —
   so the kernel package inherits Zod as a real, resolvable dependency.

`lint-deep-dive-2026-07/71-portable-engine-context.md` carries a matching
addendum pointing here.

## Dispatch rulings — 2026-07-17 (owner-delegated; four-model consult)

Recorded after a parallel design consult (codex/GPT, cursor/Grok 4.5, Opus,
Fable — same brief, independent answers) under the owner's "pick whatever
seems best" delegation. Consult transcripts were session-scratch; the
decisions and the reasoning that drove them are captured here.

1. **Location and name: new `tools/` workspace root, `tools/lint-ratchet`,
   package `@musi/lint-ratchet`, `"private": true`** (3-of-4 consensus;
   Grok dissented toward `packages/lint-ratchet` + a neutral scope).
   `packages/*` means the documented `shared -> server -> client` product
   flow and carries product-tier lint/knip policy; a dev-tool engine there
   either inherits app-code policy or forces carve-outs. A `scripts/`
   workspace member would contradict the documented "scripts is not a
   workspace package" layout. `tools/` gives the engine its own policy tier
   and the cleanest outsider read: `packages/` is the app, `tools/` is the
   harness machinery, `examples/` consumes it. Keep the `@musi/` scope —
   adopters rename a scope trivially; internal consistency wins.
2. **The package carries layers 1–3 only; layer 4 (the Musi adapter —
   registry data, paths, harness wiring, CLI composition) stays outside
   under `scripts/`** — amends the 2026-07-16 ruling's "carrying the four
   layers" wording. All four models converged here independently: with the
   adapter outside, the acceptance check is strictly structural ("the
   package has zero `@musi/*`/repo-relative imports; its `package.json`
   deps are its whole world") with no carve-out subpath weakening the seam.
3. **No build step: export TS source directly via per-layer subpath
   exports; no `index.ts` package barrel** (`local/no-barrel` fires on
   `index.ts`, and a mega-barrel is exactly the shape leaf 05 objects to).
   Every consumer runs under Bun; a dist/build would add a verify slot and
   hurt copyability.
4. **The package declares its own runtime deps** (`zod`, `eslint`,
   `minimatch`, typescript-eslint, …) rather than resolving via root
   hoisting — a wholesale directory copy must be self-contained. The root
   `zod` dep recorded in ruling item 6 above remains for `scripts/`
   consumers; the package manifest is a separate obligation.
5. **Demo topology: `examples/lint-ratchet-demo/` joins the workspace as a
   member and drops its own lockfile.** The demo today is a standalone
   clone-and-run project; a standalone lockfile cannot resolve an
   unpublished workspace package, so "ordinary consumer" forced a choice.
   Vendoring or `file:` copies quietly reintroduce the sync problem this
   leaf exists to delete; joining the workspace deletes sync entirely. The
   demo's proof burden shifts from "clone this directory and run" to being
   the second adapter (non-Musi fixture context) proving the seam is
   swappable; the adoption guide and demo README must be rewritten to the
   new story: "copy `tools/lint-ratchet` into your repo."
6. **Execution shape (supersedes the leaf-01 recipe for this leaf): single
   design + one off-family adversarial plan review; one sequential lane;
   ~5–6 slices, each landed through the full gate; deletion last.**
   Unanimous. The dual-design step bought diversity when the target was
   open; here the rulings and inherited acceptance tests pin the shape, so
   the second design is the step to drop and the adversarial plan review
   (which caught three real findings in leaf 01) is the step to keep.
   Cross-model confirm-then-fix on the semantic slices (context seam,
   package-boundary move, consumer flip, final deletion); single review on
   mechanical-move slices. Slice skeleton the consults converged on:
   registry/types split → scaffold + kernel move (+ sensor repoint) →
   engine/governance move → git rail move → demo flip → delete the
   compensation harness and add the structural boundary checks.

### Plan-review checklist (consult-surfaced risks the plan must cover)

- **Portable surface is wider than engine TS.** `portable-manifest.json`
  also lists `eslint-rules/max-lines.js`, the shared diagnostics schema
  (`packages/shared/src/schemas/harness-diagnostics.ts`), harness
  diagnostics/manifest helpers, and the `scripts/git/*` merge-driver shell
  assets. The design must place each: in-package, injected via context, or
  a documented copy-along — or the "delete ~1k LOC" payoff is overstated.
- **Registration-surface breadth** (this repo's documented failure mode):
  vitest project globs, stryker/mutation config, smoke-subject generation,
  `config-surface-manifest.json`, coverage map, harness-check fixtures,
  ESLint reach / TS coverage / knip workspaces / formatting / changed-file
  policy for `tools/**`. Enumerate in the plan; point the adversarial
  review at the list; run `harness:check` per slice.
- **Baseline path-key churn.** Ratchet and max-lines-exceptions baselines
  are path-keyed; moving the engine rewrites those keys. Acceptance is
  "identical semantics with a mechanical path-rename update", not
  byte-identical baselines — say so up front (contrast leaf 01's
  byte-untouched debt log).
- **Installed merge drivers reference engine paths.** Every clone/worktree
  git config invokes the CLI by path; update installers, presence checks,
  and `.gitattributes` in the same slice as the move and note that live
  worktrees need a driver reinstall mid-mission.
- **Docs path sweep.** `docs/guides/lint-ratchet{,-reference}.md`, AGENTS
  task-guide pointers, and generated conflict recipes cite
  `scripts/lint-ratchet/*` paths.
- **Land-gate mechanics.** Workspace-glob and config-surface slices trigger
  full-scan lint + full test (known eslint OOM at 4 GB — use the raised
  heap and the sequential verify-bridge landing path), and the lane base
  needs one full `verify` before dispatch.
- **Cap-policy precursor.** Land leaf 05 item 2's ruling (recorded in leaf
  05, 2026-07-17) as a tiny slice before the first file move, keyed to the
  current engine paths and carried to `tools/lint-ratchet/**` with the
  move, so relocation can merge fragments at real seams instead of
  preserving 2-line-module shapes. During this leaf: no *new* micro-splits
  to dodge the cap; opportunistic merges only where a file is already open
  for the move (full consolidation stays leaf 05's).
