# drift:ai — Standalone-Tool Extraction Assessment

**Author:** extraction-architect · **Date:** 2026-05-28
**Question:** "Could someone adapt drift:ai as a standalone tool and use it to analyze other projects?"

## TL;DR Verdict

**It already works on other projects today** — with two caveats: you must (1) run it
with `bun` (not node) and (2) install `jscpd` into the target repo's
`node_modules/.bin/` for the duplicates check. I proved this by pointing the
*unmodified* script at a throwaway non-Musi git repo in `/tmp` and getting correct
findings from all four detectors plus JSON output (see "Proof of portability").

The core is remarkably clean for extraction: **the entire `scripts/drift-ai/`
directory imports nothing outside itself** — only `node:*` builtins, sibling
modules, and the parent `drift-ai.js`. Zero `@musi/*` or `../../` imports. Roots,
ignores, exclusions, duplicate min-lines, comment-exclude prefixes, and ghost-file
allow-pairs are all already config-driven via the auto-discovered
`drift-ai.config.json`. The public API in `scripts/drift-ai.ts` is already shaped
like a library (typed `RunOptions`/`RunResult`, dependency-injected runners).

The only true Musi-isms are: the `harness-freshness` subcommand (hardcoded
`docs/ai-harness.md` + `docs/guides`), the `bun run code:intel` text inside
ghost-files FIX hints, and the bun-only runtime via `.js`-extension imports.

**Follow-up target clarification (2026-05-29):** the first deliverable does not
need to be a Node/npm package. The acceptable target is a shared AI-dev-tools
checkout such as `/home/node/tmp/ai_devx_stuff`, running drift:ai with Bun
against another Git repo that may use pnpm. The target repo should not have to
adopt Bun. That changes the priority: keep Bun for the tool runtime, but stop
requiring the target repo to own drift:ai's implementation dependencies.

## Proof of Portability (test result)

Built a throwaway non-Musi repo at `/tmp/drift-portability-test` (git init, no
relation to Musi) with deliberately planted drift, then ran the **unmodified**
`/workspace/worktrees/exploration/scripts/drift-ai.ts` against it.

| Test | Command (cwd = throwaway repo) | Result |
|------|--------------------------------|--------|
| current scope, no config | `bun .../drift-ai.ts --scope current --root .` | ghost-files fired correctly; duplicates failed with ENOENT (no jscpd in repo) |
| comments | (after adding standalone-comment-heavy file) | flagged `app/heavy-comments.ts` 49% over 133 effective lines — correct |
| duplicates | after `npm install --no-save jscpd@^4.2.3` + config `minLines: 5` | flagged `alpha.ts:1-10 ↔ beta.ts:1-10 (10 lines)` — correct |
| full run + auto config | `bun .../drift-ai.ts --scope current` (config auto-discovered) | duplicates + ghost-files + comments all fired |
| **changed scope** | `bun .../drift-ai.ts --scope changed --base main` | merge-base + name-status diff + suppressions all worked; flagged two fresh suppressions in `app/new-feature.ts` — correct |
| JSON output | `--format json` | clean `schemaVersion:1` machine-readable report |
| harness-freshness | `bun .../drift-ai.ts harness-freshness` | emitted "docs/ai-harness.md missing" — the one Musi-coupled subcommand |
| **run under node** | `node .../drift-ai.ts ...` (and `node --experimental-strip-types`) | **FAILS** `ERR_MODULE_NOT_FOUND: runner.js` — bun-only today |

**What worked unchanged:** ghost-files, comments, suppressions, changed-scope git
logic (base ref + `origin/<base>` fallback, merge-base, name-status, untracked
files), current-scope inventory, ignore filtering (node_modules auto-excluded),
JSON output, config auto-discovery.

**What broke / needed setup:** duplicates needs `node_modules/.bin/jscpd` *in the
target repo* (ENOENT otherwise — but it degrades gracefully to a report-only WARN,
does not crash). Node runtime fails entirely. Default `minLines: 30` silently found
nothing on my short duplicate until lowered via config (a calibration footgun, not
a bug).

For a pnpm target repo, that means the current implementation would look for
`<target-repo>/node_modules/.bin/jscpd`. Installing `jscpd` in the tools checkout
does not help today, because `defaultJscpdRunner` uses the analyzed repo root for
both executable lookup and subprocess cwd. The desired shape is different:
resolve the executable from the tools checkout first, but still run it with the
target repo as cwd so report paths remain target-repo-relative.

## Coupling Inventory

| Item | Location | Musi-coupled? | How to decouple |
|------|----------|---------------|-----------------|
| Roots (`packages/*/src`, `scripts`, `eslint-rules`) | `drift-ai.config.json` | Config only | Already config. Generic repos supply their own `roots`. |
| Ignore prefixes (`docs/`, prisma migrations) | `drift-ai.config.json` | Config only | Already config. |
| Ghost-file allow-pairs (6 Musi pairs) | `drift-ai.config.json` | Config only | Already config (per-project). |
| Comments exclude prefixes (`scripts/`, `eslint-rules/`) | `drift-ai.config.json` | Config only | Already config; `comments.ts:172-175` explicitly documents this is for non-Musi repos. |
| Default ignore segments/extensions/files | `config-paths.ts` / `types.ts` | **Generic** | `node_modules`, `dist`, `.png`, `bun.lock`, etc. — universally sensible. Keep as defaults. |
| Default base = `main` | `types.ts:85` | **Generic** | Already overridable via `--base`. Good default. |
| `git merge-base`, `origin/<base>` fallback, name-status | `git-changed-scope.ts` | **Generic** | Standard git; no change needed. |
| Suppression patterns (ESLint/TS/Stryker) | `suppressions-parse.ts` | **Generic** | All three are common tools; not Musi-specific. Optional: make the tool set configurable. |
| `jscpd` invocation | `duplicates-runner.ts:73` shells `<repoRoot>/node_modules/.bin/jscpd` | **Generic but brittle** | Split `repoRoot` into `analyzedRepoRoot` and `jscpdBin`/`toolRoot`. Resolve jscpd from the tools checkout first, fall back to target-local `.bin`, then allow `--jscpd-bin`. Keep subprocess `cwd` as the analyzed repo root so jscpd JSON paths stay repo-relative. |
| **harness-freshness subcommand** | `runner.ts:124-150`, `harness-freshness.ts:63-64` | **MUSI-ONLY** | Hardcodes `docs/ai-harness.md` + `docs/guides`. The underlying `runHarnessFreshnessCheck` *already* accepts `harnessPath`/`guidesDir` options — just not wired to the CLI. Either (a) make them CLI/config flags, or (b) drop from the portable core (recommended; see below). |
| **`bun run code:intel` in ghost FIX hints** | `ghost-files-findings.ts:13,35` | **MUSI-ONLY** | Replace with a generic hint ("check who imports the existing module before adding a sibling") or make the hint command a config string. Low effort. |
| Usage text says `bun run drift:ai` | `cli-args.ts:27-36`, `runner.ts:131` | Cosmetic | Rename to the standalone bin name (e.g. `drift-ai`) when packaged. |
| `.js`-extension ESM imports + `Node16` resolution + no emit | all modules; `tsconfig.scripts.json` (`noEmit:true`) | **Runtime coupling** | Source uses `./runner.js` imports that resolve to `.ts` only under bun. Node needs either a tsc build to real `.js`, or a loader. See Runtime section. |
| jscpd report fixture paths (`packages/server/...`) | `fixtures/jscpd-report.basic.json` | Test-only | Cosmetic; rename in fixtures if desired. Doesn't affect runtime. |

## Runtime Portability: tool Bun vs target project tooling

**Today: bun-only.** Proven above — `node` and `node --experimental-strip-types`
both fail with `ERR_MODULE_NOT_FOUND` on the first `.js` import, because the source
imports `./runner.js` while the file on disk is `runner.ts`. Bun transparently
resolves `.js`→`.ts`; node does not (it would need the imports rewritten to `.ts`
with `allowImportingTsExtensions`, or a compiled `dist/`).

That does **not** mean the analyzed project must use Bun. The workable external
tools flow is:

```sh
cd /path/to/pnpm-project
bun /home/node/tmp/ai_devx_stuff/scripts/drift-ai.ts --scope current
```

In this mode Bun is the tool runtime only. The target repo can remain pnpm-only.
The current CLI does, however, assume the current working directory is the target
Git repo; `--root` is a repo-relative scan root, not a target-repo selector.
Prefer a wrapper that changes into the target repo for the first portable slice.
A future `--repo <path>` option is useful, but it must define Git, config,
`--output`, `--chunk-dir`, root validation, and subprocess cwd semantics together.

Three options for the runtime/distribution shape:

1. **Bun-powered tools checkout (recommended now).** Keep source execution with
   Bun, but make repo selection and tool-owned dependency resolution explicit.
   This satisfies the immediate use case: one shared tools repo can scan pnpm,
   npm, Bun, or mixed target repos without making those repos adopt Bun.
2. **Build to `dist/` with tsc, publish `.js` (later, if broad npm use matters).** Add a
   `tsconfig` with `outDir: dist`, emit `.js` (+ `.d.ts`), point `bin` at
   `dist/drift-ai.js` with a `#!/usr/bin/env node` shebang. The `.js`-extension
   imports become correct post-emit. Runs under node ≥18 with no flags.
   **Tradeoff:** adds a build step + prepublish; broadest reach.
3. **node + on-the-fly TS loader** (`tsx`/`ts-node`). Avoids a build but adds a
   heavy dev dependency and slower start. Not recommended for a published CLI.

## Recommended Packaging Path

**Short term: a Bun-run `ai_devx_tools` checkout.** Rationale:

- It matches the actual use case: shared tools for agents, not a public CLI
  distribution problem.
- It lets the tool own dependencies such as `jscpd` without writing them into the
  target project's pnpm manifest.
- It avoids spending early work on a Node build while the plugin/report shape is
  still changing.
- It still benefits from the same decoupling work needed for npm later:
  `analyzedRepoRoot` vs `toolRoot`, generic FIX hints, target config handling,
  and plugin-level preflight/skip reasons.

**Later option:** publish a standalone npm package (`drift-ai` or scoped) with a
Node `bin`, built to `dist` via tsc. That remains mechanically feasible once the
tools-checkout shape is stable.

## Tools-checkout contract

Before implementation, make the support contract explicit. The minimum useful
contract is:

- **Location:** a checked-out tools repo such as `/home/node/tmp/ai_devx_stuff`
  or `ai_devx_tools`.
- **Install:** run `bun install` in the tools checkout; implementation
  dependencies such as `jscpd` live there, not in the target repo.
- **Invocation:** first supported form is `cd <target-repo> && bun
  <tools>/scripts/drift-ai.ts ...`; a wrapper may automate the `cd`.
- **Target assumptions:** target is a Git repo and may use pnpm/npm/yarn/Bun; it
  does not need Bun in its own manifest.
- **Config:** `drift-ai.config.json` is discovered from the target repo; starter
  configs are examples, not authoritative defaults for every project.
- **Updates:** update the tools checkout like any other source checkout, then
  rerun `bun install` when dependencies change.

## Phased Extraction Plan

**Phase 0 — Portable MVP (small, do first):**
- Document or ship a wrapper for `cd <target-repo> && bun
  <tools>/scripts/drift-ai.ts`. Defer a true `--repo <path>` option until all path
  semantics are designed together.
- Replace jscpd bin resolution: prefer the tools checkout's installed `jscpd`
  binary, fall back to `<analyzedRepoRoot>/node_modules/.bin/jscpd`, allow
  `--jscpd-bin`, and keep subprocess `cwd` as the analyzed repo root.
- Update the `jscpd` missing-binary hint so it no longer tells pnpm targets to
  install drift:ai's implementation dependency locally.
- Genericize ghost-files FIX hints (`ghost-files-findings.ts`): drop `bun run
  code:intel`, or make the hint command a config field
  (`checks.ghost-files.dependentsHint`).
- Add a generic starter config for TypeScript/pnpm projects and document that
  `--root` selects repo-relative source roots after the target repo is chosen.

**Phase 1 — De-Musi the in-repo core (benefits Musi too):**
- Decide harness-freshness's fate: either expose `harnessPath`/`guidesDir` as CLI
  flags + config (the function already supports them), or move the subcommand out
  of the portable core into a Musi-only wrapper. **Recommendation: drop it from
  the portable core** — it's a docs-inventory sensor specific to Musi's harness,
  not a code-drift sensor, and adds the only docs-layout coupling. Keep it as a
  thin Musi-side script that calls `runHarnessFreshnessCheck` with explicit paths.

**Phase 2 — Registry, reports, and adapters:**
- Add the `CheckPlugin` / `CheckOutcome` registry before new checks so skipped
  prerequisites are visible in text, JSON, and chunks.
- Define an external-adapter policy: emit findings only with trustworthy
  target-local config/module resolution; otherwise skip with a reason.
- For import cycles, include acceptance fixtures for target `tsconfig` aliases,
  type-only imports, barrel files, and monorepo package boundaries.

**Phase 3 — Tests + docs:**
- The 7 `*.test.ts` files port directly (they're injection-based, no Musi data
  except cosmetic fixture paths). Keep Bun/Vitest for tools-checkout development;
  switch only if a Node package becomes a real deliverable.
- Add README (outline below) + a `drift-ai.config.json` JSON schema or documented
  starter examples.

**Phase 4 — Optional polish:**
- Make suppression tool set configurable (toggle Stryker, add custom patterns).
- Raise default duplicates `minLines` discoverability (warn when 0 duplicate
  findings *and* minLines is high, or print the effective minLines in the header).
- Consider a `drift-ai init` that scaffolds a starter config from detected repo
  layout.
- Add real `--repo <path>` support once Git/config/output/chunk/root/cwd semantics
  have one policy.
- Add a Node `dist` build and npm `bin` only if the tools-checkout workflow needs
  broader distribution.

## Example generic `drift-ai.config.json`

```json
{
  "roots": ["src", "lib", "app"],
  "ignore": {
    "prefixes": ["dist/", "docs/", "generated/"],
    "globs": ["**/*.snap"]
  },
  "checks": {
    "duplicates": {
      "minLines": 20,
      "excludeGlobs": ["**/*.stories.tsx"]
    },
    "comments": {
      "excludePrefixes": ["scripts/"]
    },
    "ghost-files": {
      "currentAllowedPairs": [
        ["src/auth/login.ts", "src/auth/logout.ts"]
      ]
    }
  }
}
```

(All keys optional; defaults cover `node_modules`, `dist`, images, lockfiles, and
test/fixture files. `roots` defaults to empty → pass `--root` for current scope.)

## Minimal README outline for the tools checkout

```
# drift-ai — AI-drift sensor (report-only)

## What it detects
- duplicates: copy/paste clones in changed/whole-repo scope (via jscpd)
- ghost-files: suspicious sibling modules (foo.ts vs foo-helpers.ts)
- comments: over-narrated files (high comment ratio on large files)
- suppressions: newly added eslint-disable / @ts-ignore / Stryker disable

## Install
  # tools checkout
  cd /home/node/tmp/ai_devx_stuff
  bun install                # installs tool dependencies, including jscpd
## Run
  cd /path/to/target-pnpm-project
  bun /home/node/tmp/ai_devx_stuff/scripts/drift-ai.ts
  bun /home/node/tmp/ai_devx_stuff/scripts/drift-ai.ts --scope current --root src
  bun /home/node/tmp/ai_devx_stuff/scripts/drift-ai.ts --format json --output drift.json

  # future wrapper shape
  drift-ai --repo /path/to/target-pnpm-project --scope current --root src
## Configure
  drift-ai.config.json (auto-discovered at repo root) — see schema
## Exit codes
  Always 0 (report-only). Findings go to stdout/JSON; never blocks.
## Requirements
  Bun in the tools checkout; a git repo as the target. The target repo may use
  pnpm/npm/yarn/bun and does not need to adopt Bun.
```

## Open questions for team-lead
- Resolved: Bun as the tool runtime is acceptable for the first external-repo
  workflow; Node/npm publication is optional later.
- Resolved: a single drift report is desirable. External adapters such as knip
  should appear in that report when their target-side prerequisites are present,
  otherwise as explicit skipped checks with reasons.
- Still decide: should `harness-freshness` remain Musi-only, or should there be a
  generic docs-index plugin? Recommendation remains Musi-only unless another
  project has the same docs contract.
