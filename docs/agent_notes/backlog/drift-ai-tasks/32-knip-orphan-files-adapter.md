# 32 — knip orphan-files adapter

Status: Done
Track: C · Size: S
Depends on: 21, 30 · Blocks: none

## Goal

Surface orphaned / never-imported **files** (not unused exports or deps — knip
owns those) inside the single drift report, as a Tier-1 pass-through adapter that
runs the target's OWN knip with the target's OWN config.

## Background

Read the adapter contract [`03-adapter-contract.md`](./03-adapter-contract.md)
(task 30's deliverable) first — it defines the tiers, the provenance model, the
config-authority ladder, the skip-vs-finding rule, and the shared
install-detection / config-discovery helpers this adapter consumes.

This is the canonical **Tier-1 pass-through** adapter from the adapter policy
(task 30; `../drift-ai-hotspots-brainstorm.md` §2.2, §2.4): run the target's OWN
configured knip, with the target's OWN knip config, and surface its verdict
verbatim. Zero imposed opinion — findings are provenance-stamped `target-config`
(provenance model: task 30). It registers as a check via **task 21's registry**,
returns a `CheckOutcome` (skip model: task 21), and consults **task 30's**
install-detection and config-discovery helpers.

## Seams to touch

- **New check** registered in task 21's registry; returns `CheckOutcome`;
  provenance `target-config` (task 30).
- **Config discovery** (task 30 helper) to locate the target's knip config.
- **Install detection** (task 30 helper) to skip on an uninstalled target.
- **Scope:** the existing git seam (`02-seam-map.md` §5) for the changed set.
- **Deps:** `02-seam-map.md` §12 — `knip@6.14.1` is present in the tools checkout,
  runnable via `node_modules/.bin/knip`.

## What to do

Run knip (present in the tools checkout, `02-seam-map.md` §12) and surface only
the unused-files category.

**Locate the target's knip config** — OpenClaw's is at `config/knip.config.ts`,
**NOT** repo-root (`01-shared-context.md` OpenClaw realities). The adapter MUST
search known locations rather than assume `./knip.*` (config-discovery helper,
task 30):
- explicit `--knip-config <path>` override → then
- repo-root `knip.{json,jsonc,ts,js}` / `knip` key in package.json → then
- common non-root locations (`config/knip.config.ts`, etc.) → then
- none found → skip (`code: no-target-config`).

**Skip cleanly (not a finding) when:**
- **Target not installed** (no `node_modules`; install-detection helper, task 30)
  → `code: target-not-installed`. knip needs the target's modules to resolve
  imports; without them it cannot tell orphaned from merely-unresolved.
- knip not runnable, or no target config found (`code: no-target-config`).

**Parse the unused-files category.** Use `knip --reporter json` and read only the
files category from the JSON report; ignore the exports/deps arrays entirely.
Confirm the exact JSON shape against the knip version pinned in the tools checkout
(`02-seam-map.md` §12) — the reporter shape can change across knip majors.

**Scope to changed files in changed mode.** knip analyzes the whole project; the
unused-files result is global. In `changed` scope, run knip whole-project (it has
to, to know what is unused) but **filter the reported orphans to files in the
changed set** (git seam §5). In `current` scope, report all orphans. Default to
reporting any orphan intersecting the changed set.

## Open decisions

- **JSON reporter shape** — pin against the tools-checkout knip version.
- **Changed-scope semantics** — report any orphan intersecting the changed set
  (recommended) vs only newly-orphaned.

## Testing

- Against Musi (has a knip config + is installed) for a real result.
- **OpenClaw validation is limited** because OpenClaw is **not installed** — knip
  cannot resolve its module graph. The expected, correct outcome on OpenClaw is a
  **clean skip** (`code: target-not-installed`, or `no-target-config` if its
  `config/knip.config.ts` is not discovered). **This skip IS the test** — it
  validates the skip path (task 30's common case) on a real foreign repo. Confirm
  the config-discovery search at least *locates* `config/knip.config.ts` even
  though the run then skips on uninstalled.

## Out of scope

- Unused exports / unused deps (knip owns those; report-only surfacing would be a
  weaker duplicate).

## Outcome (landed 2026-05-29)

First external-tool adapter; it introduced the shared adapter infrastructure
tasks 31/33 reuse. New code: `adapter-support.ts` (`PathProbe`/`defaultPathProbe`,
`detectTargetInstall`, `discoverToolConfig`), `knip-runner.ts` (`KnipRunner` +
`defaultKnipRunner` + `resolveKnipBin`, bin from tools checkout first like jscpd),
`knip-orphan-files.ts` (parse + config-ladder + findings), `knip-orphan-files-check.ts`
(the plugin). Tests: `adapter-support.test.ts`, `knip-orphan-files.test.ts`.

Resolved decisions:

- **JSON reporter shape (open decision)** — confirmed against the pinned
  `knip@6.14.1` by running it: `{"issues":[{"file":"<p>","files":[{"name":"<p>"}]}]}`.
  An orphan is a row whose `files` array is non-empty; the path is `row.file`. The
  adapter runs `knip --reporter json --include files --no-progress [--config <p>]`.
  **knip exits 1 when it finds issues** — a non-zero exit is NOT a failure; stdout
  is parsed regardless of exit code.
- **Changed-scope semantics (open decision)** — report any orphan **intersecting
  the changed set** (recommended option), since knip's orphan set is global.
  Current scope reports every orphan knip returns (pass-through).
- **Provenance + schema (contract §6)** — added optional `DriftFinding.provenance`
  and `SkippedDriftCheck.code`; bumped `DRIFT_SCHEMA_VERSION` 2 → 3 (both additive).
  `preflight` may now return `{ reason, code }`. Text tags findings `[target-config]`.
- **Config ladder** — `--knip-config` override → root `knip.{json,jsonc,ts,js}` /
  `knip.config.*` → `package.json#knip` → non-root `config/knip.config.*` → skip
  `no-target-config`. `package.json#knip` runs with no `--config` (knip auto-finds).
- **Opt-in default** — added a `runByDefault` plugin flag + `DEFAULT_CHECKS`
  (distinct from `ALL_CHECKS`). knip analyzes the whole graph on every run, so
  orphan-files is excluded from the no-`--check` default and activates via
  `--check orphan-files` / `--check all`. Forward-looking for the other tool-backed
  adapters (31/33), which may also want to opt out of the default run.

Validation: Musi (root `knip.config.ts`, installed) → 3 orphans matching raw
`knip --include files`, stamped `[target-config]`, schema v3. OpenClaw (non-root
`config/knip.config.ts`, no `node_modules`) → config located, then `skipped` with
`code: target-not-installed`, exit 0 — the headline foreign-repo skip path.

Note for 31/33: `detectTargetInstall` + `discoverToolConfig` + `pathExists` dep +
provenance/skip-code fields + `runByDefault` are now in place to reuse.
