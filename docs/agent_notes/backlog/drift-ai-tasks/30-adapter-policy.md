# 30 — Adapter policy & base contract

**Status:** Done
**Track:** C  **Size:** medium
**Depends on:** 21 (CheckOutcome skip model)  **Blocks:** 31, 32, 33

> **Deliverable landed:** the policy + base contract is written up as
> [`03-adapter-contract.md`](./03-adapter-contract.md), grounded in the real
> `CheckOutcome` / `CheckPlugin` / `DriftFinding` types from task 21. Tasks 31/32/33
> now cite it from their Background sections. The two required doc-edits are done
> (see "DOC EDIT" below). This task file remains the *rationale/source*; the
> contract doc is the consumable artifact.

## Goal

Land the policy and the base `ExternalAdapter` contract that governs every
external-tool adapter in drift:ai, including adapters that intentionally run the
shared `ai_devx_stuff-lint` baseline against a foreign repo. The deliverable is
a written policy plus a base contract (provenance fields, config-authority
ladder, skip-vs-finding rules, imposed-baseline labeling) that tasks 31, 32, and
33 implement against. This is the load-bearing decision for the whole adapter
layer.

## Background

Read [`01-shared-context.md`](./01-shared-context.md) and
[`02-seam-map.md`](./02-seam-map.md) first. Deeper rationale: the adapter thread
in `../drift-ai-hotspots-brainstorm.md` Part 2, §2.1–2.7.

drift:ai is still **report-only** by default (`01-shared-context.md` "Contracts
that every task must preserve" #1), but the adapter direction is now explicit:
when the operator asks for it, drift:ai should run **our rules** against a
foreign repo and report the violations. That means adapters may intentionally
surface drift-authored verdicts. The policy requirement is provenance and
honesty, not neutrality: every finding must make clear whether it came from the
target's own config, a tool default, or an `ai_devx_stuff-lint` baseline.

The adapter layer is a **new construct** — there is no adapter code in the seam
map today. This task *defines* it; tasks 31/32/33 build against it. The pieces it
introduces (the `ExternalAdapter` base, provenance/`configSource`, the
config-authority ladder, the missing-tool skip rule) are this task's contract,
not existing seam-map sections. They build on the `CheckOutcome` skip model
introduced by **task 21**.

The OpenClaw validation (`01-shared-context.md` "Concrete target: OpenClaw")
reframes the default case. On a large foreign repo the common state is: **target
not installed (no `node_modules`)**. If an adapter needs target-local
installation, that still resolves to a clean **skip**, not a half-answer. But
when an adapter can run from the tools checkout with the `ai_devx_stuff-lint`
baseline, the desired behavior is to run it and label the findings as
baseline-authored.
Because both skips and baseline-authored findings are common on foreign repos,
both paths must be excellent: clear `code`, clear human reason, and provenance
that is never mistaken for "the target repo already agreed to this standard."

This task does not build any specific adapter. It builds the rules and the base
type all of them obey.

## Seams to touch

Existing code this policy reacts to or extends:

- **`02-seam-map.md §4` (jscpd resolution)** — `duplicates-runner.ts:51–104`
  `defaultJscpdRunner`; ENOENT / `result.error` handling at `:79`; missing-binary
  hint at `:188`. This is the precedent the skip-vs-finding rule below *corrects*.
- **`02-seam-map.md §10` (Config)** — `config.ts` / `config-paths.ts` /
  `config-parsing.ts`; `drift-ai.config.json`. The config-authority ladder's
  target-local discovery hangs off the existing config plumbing.
- **`02-seam-map.md §12` (Dependency availability)** — the tools-checkout table:
  `jscpd@4.2.3`, `ts-morph@^28`, `knip@6.14.1` present; **`madge` and
  `dependency-cruiser` absent**; `eslint-plugin-import-x 4.16.2` present (root
  `package.json`). The candidate catalog below is scoped against this table.

The base `ExternalAdapter` type, provenance fields, ladder, and skip rule are new
surface defined by this task (no seam-map anchor — they don't exist yet).

## What to do

### Verdict provenance framing

Capture, as the governing principle of the adapter layer: **own the provenance of
the verdict.** An adapter has two valid modes:

- **Delegate the verdict** to the target by running the target's own configured
  tool or the tool's published default.
- **Own the verdict** by running the `ai_devx_stuff-lint` baseline against the
  foreign repo.

The invalid mode is disguising a drift-authored verdict as if it came from the
target. If drift:ai supplies the rules, every finding must say so.

### Two adapter tiers

Define both tiers in the contract (`../drift-ai-hotspots-brainstorm.md` §2.2):

- **Tier-1 pass-through.** Run the target's OWN configured tool, surface its
  findings, zero imposed opinion. Provenance `configSource: "target-config"` (or
  `"tool-default"` when the tool ran on its own published default and no target
  config was found). Example: run the target's knip with the target's knip config
  and report what it says (task 32).
- **Tier-2 imposed-baseline.** drift:ai ships a baseline config for a tool the
  target does not configure. This is a supported product direction, especially
  for running our lint rules against foreign repos. It should still be activated
  explicitly via `--baseline-profile=ai_devx_stuff-lint` so a normal portable run
  does not unexpectedly flood the report. Every
  finding is provenance-stamped `configSource: "drift-baseline"` so the reader
  knows drift:ai supplied the opinion.

The provenance values `target-config` / `tool-default` / `drift-baseline` are
**defined by this task's contract** (and §2.7 of the brainstorm), not an existing
seam-map field.

### Config-authority precedence ladder

The base contract resolves config in this order; **first that exists wins**
(`../drift-ai-hotspots-brainstorm.md` §2.3). Target-local discovery uses the
existing config plumbing (`02-seam-map.md §10`):

1. explicit `--<tool>-config=<path>` (operator override)
2. target-local config (search known locations, do NOT assume repo-root)
3. drift baseline — if `--baseline-profile=ai_devx_stuff-lint` is set
4. **skip** with `code: no-target-config` — **the DEFAULT** when nothing above
   matches

The ladder applies only to **config-honoring** adapters (knip, eslint, madge /
import-x — tools whose findings depend on a ruleset the target could author). See
the measurement-ish carve-out below.

### Skip vs. finding — correction to the jscpd precedent

The existing duplicate-code check historically surfaced a WARN-style finding when
its tool was unavailable (the jscpd ENOENT path — `02-seam-map.md §4`, the
one-WARN-per-root behavior validated on OpenClaw). **That precedent is wrong for
foreign repos and is corrected here:**

- A **missing tool** on a foreign repo is an **expected absence** →
  `status: "skipped"` with a machine-readable `code` (e.g. `tool-not-installed`,
  `target-not-installed`, `no-target-config`) and a human reason. It is NOT a
  finding. (Skip model: the `CheckOutcome` union from **task 21**.)
- A tool that **ran and crashed / produced unparseable output** is a different
  situation → emit a single diagnostic finding (or `status: "error"` per the
  outcome model), because something the operator can act on actually went wrong.

The base contract MUST distinguish these two: *expected absence (skip)* vs
*attempted-and-failed (one diagnostic)*. On OpenClaw the uninstalled + no-baseline
default lands in the first bucket and must skip cleanly — this is the common case
(see Background), so invest in the skip path's clarity.

### Measurement-ish adapters carve-out

Some adapters measure a property with no "target standard" to honor — duplication
has no ruleset the target authored. For these (jscpd, similarity-ts), thresholds
are unavoidably **drift:ai-authored**, which is tolerable precisely because there
is no target config to defer to. The config-authority ladder above therefore does
**not** apply to measurement-ish adapters; it applies only to config-honoring
adapters. Measurement-ish adapters still carry provenance (`drift-baseline` for
the threshold) and still skip cleanly when their engine is absent.

### Candidate adapter catalog

Include this table (from `../drift-ai-hotspots-brainstorm.md` §2.4) as the catalog
the layer is scoped against. Availability is per the tools-checkout table
(`02-seam-map.md §12`): `ts-morph`, `knip`, `jscpd`, and `eslint-plugin-import-x`
are present; `madge`, `dependency-cruiser`, `similarity-ts` are NOT.

| Tool | Category | Tier | What it surfaces | Target config? | In tools checkout? |
|------|----------|------|------------------|----------------|--------------------|
| knip (unused files) | structural | 1 | orphaned / never-imported files | yes (knip.json / `config/`) | yes |
| madge | structural | 1 | import cycles | tsconfig (aliases) | no |
| import-x `no-cycle` | structural | 1 | import cycles | tsconfig (aliases) | yes (`4.16.2`) |
| similarity-ts | measurement | 2 | near-duplicate functions | no (drift-authored threshold) | no (Rust binary) |
| jscpd | measurement | 2 | exact / token clones | no (drift-authored threshold) | yes |
| eslint | lint | 1 | target's own lint findings | yes (eslintrc) | yes (tools checkout deps/config) |
| `ai_devx_stuff-lint` | lint | 2 | generic AI-drift lint signals (complexity, file length, too many arguments, etc.) | drift baseline | yes (tools checkout deps/config) |
| dependency-cruiser | structural | 1/2 | layering / arch rules | yes (rules) | no |

### DOC EDIT — split the "Explicitly do NOT add" sections

This task includes documentation edits to two notes. The single flat "do NOT add"
list conflates two genuinely different reasons for exclusion. Split each into
three buckets:

- **Category 1 — do NOT reimplement as drift:ai heuristics.** Hand-rolled
  complexity / length / magic-number heuristics, inconsistent-naming beyond
  casing, large-diff. These should not be reimplemented directly inside the
  drift:ai sensor. They may be surfaced if they come from an explicit
  `ai_devx_stuff-lint` baseline adapter, because the user explicitly wants to run
  shared generic AI-drift lint rules against the foreign repo.
- **Category 2 — may orchestrate via adapter (target-conditional).** knip
  orphan-files *with the target's own config* (task 32), madge / import-x cycles
  honoring the target's tsconfig (task 31), similarity-ts opt-in near-duplicate
  (task 33), and lint adapters using either target config or the
  `ai_devx_stuff-lint` baseline. These are admissible as adapters because
  provenance identifies who owns the verdict.
- **Still excluded (unconditionally).** Secrets scanning (a security gate, not
  AI-drift evidence). Churn × complexity and other metrics (belong in the
  `hotspots` subcommand — `../drift-ai-hotspots-subcommand.md`; task 40 — not the
  `ai` check set). Lockfile drift (ignored by design).

Files to edit:
- `../drift-ai-improvements.md` — the "Explicitly do NOT add" paragraph in
  **Part D** (currently line ~296; prose, not a list).
- `../drift-ai-review/additional-checks-research.md` — the "Explicitly do NOT add"
  section (currently lines ~176–190).

**Important framing for the Category 2 split:** For **this repo itself**, the
normal verification stack remains canonical; re-running the same checks inside
drift:ai is not a replacement for local CI. For **foreign repos**, the goal is different:
drift:ai may intentionally run the shared `ai_devx_stuff-lint` baseline to reveal
what generic AI-drift rules would flag there. Write the doc edits so this reads
as "local CI remains canonical for this repo; `ai_devx_stuff-lint` is a shared
foreign-repo inspection profile," not as a claim that the foreign repo already
opted into repo-specific standards.

### Base contract surface

Specify (in the task doc, for tasks 31–33 to implement against) the
`ExternalAdapter` base shape — a **new construct** this task introduces (no
seam-map anchor):

- a `resolveConfig(ctx)` that walks the config-authority ladder and returns either
  a resolved config source or a skip decision (`code` + reason);
- a `run(ctx, config)` that maps tool output to `Finding[]`, each stamped with
  `provenance.configSource`;
- a uniform mapping from "tool/target absent" to `status: "skipped"` and from
  "tool ran and failed" to a single diagnostic — so no adapter re-litigates the
  jscpd mistake. (Built on the `CheckOutcome` union from **task 21**.)

## Locked decisions

- **Tier-2 imposed baselines:** ship as a first-class adapter mode. drift:ai is
  allowed to run shared lint baselines against foreign repos and report the
  violations.
- **Baseline activation shape:** the public profile UX is
  `--baseline-profile=ai_devx_stuff-lint`.
- **First lint-baseline surface:** implement a curated portable
  `ai_devx_stuff-lint` profile, not this repo's raw ESLint config and not
  lint-ratchet baselines. It should focus on generic AI-drift signals that are
  useful across repos: complexity, file length, too many arguments, and similar
  broadly applicable maintainability rules. Exclude repo-specific checks from
  this codebase.
- **Adapter scope ceiling:** broad enough to include lint-rule orchestration,
  especially the `ai_devx_stuff-lint` baseline. Structural adapters are still in
  scope, but the ceiling is no longer structural-only.

## Acceptance criteria

All satisfied by [`03-adapter-contract.md`](./03-adapter-contract.md) and the two
doc-edits (section references below point into the contract):

- [x] The verdict-provenance principle ("own the provenance of the verdict") is
  written as the governing rule of the adapter layer. → contract §0.
- [x] The base `ExternalAdapter` contract is specified: `resolveConfig` (ladder →
  resolved-or-skip) and `run` (output → `Finding[]` with
  `provenance.configSource`). → contract §3 (`ExternalAdapter` shape) + §6.
- [x] The config-authority ladder is documented with all four rungs and the
  `no-target-config` default skip, scoped to config-honoring adapters only.
  → contract §2.
- [x] Tier-1 vs Tier-2 are defined, with Tier-2 as a first-class explicit mode
  behind `--baseline-profile=ai_devx_stuff-lint` and provenance
  `drift-baseline`. → contract §1.
- [x] The jscpd-precedent correction is captured: missing tool / uninstalled
  target = `skipped` with a `code`; tool-ran-and-failed = one diagnostic.
  Adapters cannot emit a WARN for an expected absence. → contract §4 (also
  reconciles the source's "status: error" with the landed `ran | skipped` union).
- [x] The measurement-ish carve-out (jscpd, similarity-ts: ladder does not apply,
  threshold is drift-authored) is documented. → contract §2 carve-out.
- [x] The candidate adapter catalog table is included with tools-checkout
  availability noted (import-x present; madge/dependency-cruiser/similarity-ts
  absent). → contract §7.
- [x] DOC EDIT done: `../drift-ai-improvements.md` (Part D) and
  `../drift-ai-review/additional-checks-research.md` "do NOT add" sections split
  into Category 1 / Category 2 / Still-excluded, framed as "do not hand-roll these
  in drift:ai, but baseline adapters may run our lint rules against foreign
  repos."
- [x] The locked decisions (Tier-2 ships as first-class; profile UX is
  `--baseline-profile=ai_devx_stuff-lint`; first profile is curated, portable,
  and generic) are recorded for tasks 31–33 and future lint-baseline adapter work.
  → contract §8.
- [x] The skip path is explicitly called out as the common case on foreign repos
  and required to be clear (code + reason, never read as "all clear").
  → contract §4 ("The skip path is the headline case…").

## Testing

Doc + contract only — there is no runnable code to test here directly. The
contract is **validated by tasks 31 and 32 implementing against it**: task 32
(knip orphan-files) exercises the Tier-1 pass-through path and the
`no-target-config` / uninstalled skips; task 31 (import cycles) exercises a
config-honoring structural adapter and the uninstalled-target degrade. A future
lint-baseline adapter should validate the Tier-2 `drift-baseline` path by running
`ai_devx_stuff-lint` against a foreign repo. If either path cannot cleanly express
its skip and provenance behavior using this contract, the contract is wrong and
comes back here.

## Out of scope

- Implementing any specific adapter (knip → task 32, import cycles → task 31,
  near-duplicate → task 33, lint-baseline → future task).
- Shipping any Tier-2 baseline config; this task authorizes the mode and contract,
  but implementation belongs in a dedicated adapter task.
- Orchestrating every possible tool at once. Lint-rule orchestration is in scope;
  arbitrary formatting/type-coverage/dependency tools should still be added
  deliberately, not by default.
- Generated-file filtering (dropped by design — `01-shared-context.md` contracts
  #3; `../drift-ai-hotspots-brainstorm.md` open fork #7).
