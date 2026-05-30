# drift:ai improvements — shared context

**Read this once before picking up any task in this folder.** Each task file
assumes you have read this and [`02-seam-map.md`](./02-seam-map.md). Together they
mean an implementer should rarely need to open the long source docs under
`../drift-ai-review/` or the brainstorm notes — those are linked from each task
only for deeper rationale.

---

## What drift:ai is

A **report-only** "AI-drift sensor" CLI: `scripts/drift-ai.ts` + `scripts/drift-ai/`
(~7,300 LOC). It flags code-quality patterns AI agents tend to introduce. Today:

| Check | Catches | Engine |
|---|---|---|
| `duplicates` | copy/paste duplicate blocks | shells out to `jscpd` |
| `ghost-files` | suspicious new sibling modules (`foo-helpers.ts` beside `foo.ts`) | filename-token + Levenshtein heuristic |
| `comments` | over-narration (comment-to-code ratio) | single-pass line classifier |
| `suppressions` | newly added `eslint-disable` / `@ts-*` comments | diff + comment scanner |
| `harness-freshness` (subcommand) | `docs/ai-harness.md` vs `docs/guides` drift | **Musi-only** |

Two scope modes: `changed` (diff vs `main`, default) and `current` (whole repo).
Output: text or JSON, optional `--chunk-dir`/`--chunk-size` for AI handoff. Config:
`drift-ai.config.json`, auto-discovered. **Always exits 0** (report-only).

It is genuinely well-engineered: clean dependency-injection seams (git/jscpd/fs
runners injected and defaulted), consistent `DriftAiError` + report-only contract,
behavior-focused tests with real fakes (no `vi.mock`). Improvements are about
sharpening trust, collapsing accidental complexity, and making an
already-portable script a deliberately portable tool.

## Contracts that every task must preserve

1. **Report-only / exit 0.** Findings never block. The only opt-in exception is an
   explicit `--fail-on-findings` flag (a dedicated task); default stays exit 0.
2. **Low false positives = the whole value.** A sensor that cries wolf gets
   ignored. New checks must clear a low-FP bar before being on by default.
3. **Evidence, not verdicts.** drift:ai surfaces *what it finds* and lets the human
   supply judgment. Do **not** build detection/recommendation cleverness the
   reader already has context for — e.g. do **not** try to auto-detect
   generated/codegen/i18n files beyond the existing universal ignore defaults +
   the user's `ignore` config. Auto-classifying "ignorable" files on an arbitrary
   target is an unwinnable, unportable calibration treadmill. Show what you find;
   the reader discounts their own noise. (This principle is load-bearing — see the
   hotspots and adapter tasks.)
4. **DI seams + behavior tests.** New I/O goes behind an injected runner with a
   `default*` factory, and is tested with a fake, mirroring the existing
   `GitRunner`/`JscpdRunner`/`FileReader` pattern. No `vi.mock`.
5. **No type-assertion sprawl / no relaxing strict flags.** `exactOptionalPropertyTypes`
   stays on; honor it with explicit-`null` modeling or a small helper, not by
   widening types.

## The portability target (why most of this work exists)

The first deliverable is **tool-checkout portability**: run drift:ai from a shared
tools checkout (this Musi worktree plays that role) using **Bun as the tool
runtime**, against *another* Git repo that may use pnpm, npm, yarn, or bun and
does **not** adopt Bun.

```sh
cd /path/to/target-repo            # pnpm/npm/yarn/bun — any
bun /path/to/tools/scripts/drift-ai.ts --scope current
```

Consequences that shape the tasks:
- The **target repo must not need to install drift:ai's implementation deps**
  (e.g. `jscpd`). Those belong to the tools checkout.
- The target repo is the subprocess **cwd** so scanner output stays repo-relative,
  but executables resolve from the **tools checkout**.
- A true `--repo <path>` flag is deferred — it needs one coherent policy across
  Git, config discovery, `--output`, `--chunk-dir`, root validation, and cwd. The
  MVP is the documented `cd` flow; no wrapper is planned.

## Concrete target: OpenClaw (`/home/node/tmp/openclaw`)

OpenClaw is the real-world target the decomposition was validated against. It is
**an example of the kind of repo drift:ai aims to help**, not the product target:
a pnpm + **oxlint** TypeScript monorepo, multi-developer, AI-augmented, ~54k
commits. Keep it **read-only** (no installs, edits, or commits in it).

Use OpenClaw facts as validation evidence and fixture inspiration only. When a
task cites an OpenClaw-specific path, package manager, linter, or alias, translate
that fact into repo-agnostic behavior before implementation.

Validated facts (2026-05-29) you can rely on in tasks:

- **drift:ai runs unmodified** against it: `--scope current` over its source roots
  → exit 0, ~4.9s, **14,923 files** in scope; 329 ghost-files + 11 comments
  findings. The 6 "duplicates" findings were all the **jscpd ENOENT** failure (one
  WARN per root), because OpenClaw has **no `node_modules` installed at all**.
- **`--format json` is 1.68 MB**: 64% is the `scope` array (14,923 bare paths),
  ~12% is findings. The "JSON is mostly scope noise" problem is real and worse at
  scale → scope-trimming is high priority.
- **No installed `node_modules`** is a first-class state: jscpd, import-cycle
  resolvers, and knip-style adapters must **skip cleanly with a reason** when the
  target isn't installed — not crash, not emit a finding.
- **Shallow / blobless clone**: this OpenClaw checkout has commit metadata (so
  `git log` works — all hotspot cuts ran fine) but **no trees/blobs**, so *any*
  `git diff <ref>` **SIGSEGVs** in git 2.39.5. drift:ai's changed-scope path
  (`git-changed-scope.ts:119`) propagates the crash as a non-zero exit. Two
  implications: (a) validate **changed-scope on Musi or a full clone**, not this
  OpenClaw checkout; (b) drift:ai should detect a shallow clone and degrade with a
  clear message instead of surfacing a raw SIGSEGV (a dedicated task).
- **Targets may not use ESLint**: OpenClaw uses oxlint (`.oxlintrc.json`, no
  eslint config). The portable tool cannot assume an ESLint install or config on
  the target. That means ts-morph remains the default engine for git/complexity
  lenses, while a future ESLint baseline adapter must run from the tools checkout
  with provenance that marks findings as `ai_devx_stuff-lint` /
  `drift-baseline` rules.
- **Extensive tsconfig path aliases** (~30: `@openclaw/*`, `@openclaw/* → ./extensions/*`,
  etc.), baseUrl null, sub-packages extend a package-boundary base config. Any
  module-graph tool (import-cycles, knip, ts-morph) must honor these or it
  mis-resolves.
- **knip**: OpenClaw ships its own config at **`config/knip.config.ts`** (NOT
  repo-root). A knip adapter must *locate* the non-root config, and skip when the
  target isn't installed.
- **Git-only hotspot signals are rich** (the brainstorm's numbers reproduced):
  churn max **208** revisions/30d, author fragmentation max **48** distinct
  authors/file, genuine cross-package co-change (e.g. `extensions/discord/config-ui-hints`
  ↔ `src/config/zod-schema.providers-core`, 23×). But raw co-change yields **65k
  pairs** and an **i18n locale clique** (every locale co-changes with every other)
  that swamps the top-N → co-change MUST have a min-support threshold **and** a
  per-node degree cap. Raw churn top-N is led by `CHANGELOG.md`/lockfile/i18n —
  do not auto-filter; show a realistic noisy top-N in docs so readers expect it.
- **Mostly linear/rebase history** (19 merges / 15,858 non-merge commits in 30d),
  so the "`revisions` metric lies under squash-merge" risk does *not* bite
  OpenClaw — keep the caveat but note OpenClaw as a counterexample.

## Tools checkout = this worktree

When a task says "tools checkout," it means the repo you are in
(`/workspace/worktrees/exploration`). Dependency reality here:
`jscpd@4.2.3`, `ts-morph@^28`, `knip@6.14.1`, and `eslint-plugin-import-x@4.16.2`
are installed; **`madge` and `dependency-cruiser` are NOT** (relevant to the
import-cycles task — spike ts-morph in-process first, fall back to import-x's
`no-cycle` if needed, and do not add madge without reopening the dependency
decision).

## How to test against OpenClaw / Musi

- **Current scope, OpenClaw** (works today; the validated path):
  ```sh
  cd /home/node/tmp/openclaw
  bun /workspace/worktrees/exploration/scripts/drift-ai.ts --scope current \
    --root src --root packages --root apps --root extensions --root ui --root config
  ```
- **Hotspot / git-log cuts, OpenClaw**: any `git log --no-merges --name-only`
  analysis works (commit metadata is present). `git diff <ref>` does **not**
  (shallow clone → SIGSEGV).
- **Changed scope**: validate on Musi (`bun run drift:ai --scope changed`) or a
  full clone. On a fresh OpenClaw `main`, `--base main` would diff to an empty set
  anyway.
- **Unit tests**: `bun run --filter ... ` — actually drift:ai tests run via the
  repo's vitest; co-locate `*.test.ts` beside the code and use injected fakes. Run
  the existing suite before/after (`bun run verify:changed` once changes are
  staged, or run the drift-ai test files directly).
- Keep OpenClaw read-only.

## Task-file conventions

Every task file in this folder follows the same shape, with `Locked decisions` or
`Closed decision` replacing `Open decisions` when a choice has already been
confirmed:

```
# <id> — <title>
Status / Track / Size / Depends on / Blocks   (one line each)

## Goal            — 1–3 sentences: what changes and why it matters.
## Background      — read 01 + 02; deep-rationale links (optional).
## Seams to touch  — exact file:line anchors (from 02-seam-map.md).
## What to do      — concrete steps / acceptance criteria.
## Open decisions  — choices to make or escalate, each with a recommendation.
## Locked decisions — confirmed choices that should not be re-escalated.
## Testing         — unit tests to add; OpenClaw/Musi validation; expected results.
## Out of scope    — explicit non-goals to keep the task bounded.
```

Tracks: **P** = portability MVP, **A** = architecture/single-report, **C** = new
checks & adapters, **H** = hotspots subcommand, **X** = cleanup/optional. See
[`00-index.md`](./00-index.md) for the dependency graph and recommended order.

**Checklist-style variant:** files whose body is a list of independently-pickable
sub-items — the Track X cleanup files (50, 51) and the further-lenses file (42) —
list seams *per sub-item* instead of in one `## Seams to touch` section, and may
use `## Context` in place of `## Background`. That variation is intentional;
single-task files use the canonical shape above.

## Source docs (deeper rationale, optional reading)

Under `../` (i.e. `docs/agent_notes/backlog/`):
- `drift-ai-improvements.md` — the roadmap + prioritization.
- `drift-ai-review/code-quality.md` — B1/B2/B3 + Med/Low items (architecture).
- `drift-ai-review/ux-reporting.md` — A1–A6 reporting findings + before/after mocks.
- `drift-ai-review/standalone-extraction.md` — portability coupling table + proof.
- `drift-ai-review/additional-checks-research.md` — new-check candidates + "do NOT add".
- `drift-ai-hotspots-subcommand.md` — the original hotspots design note.
- `drift-ai-hotspots-brainstorm.md` — the brainstorm that revised it (co-change &
  author-fragmentation flagships; adapter verdict-ownership; OpenClaw appendix #2).
