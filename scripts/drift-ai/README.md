# drift:ai — portable AI-drift sensor

`drift:ai` is a **report-only** code-quality sensor that flags patterns AI coding
agents tend to introduce: copy/paste duplicates, suspicious sibling modules
(`foo-helpers.ts` beside `foo.ts`), over-narration in comments, and newly added
lint/type suppressions. Opt-in checks deepen the sweep: knip adapters
(`orphan-files`, `knip-duplicates`, `unused-exports`), ts-morph structural checks
(`import-cycles`, `layer-direction`, `near-duplicates`, and the `duplicate-*`
value/shape family), plus `module-doc-paths` (stale module-doc file references)
and `commented-out-code` (tombstoned code blocks) — the implemented-checks table
below is the authoritative list. Findings are evidence for a human by default:
normal reports exit `0`, usage/config errors exit `2`, and `--fail-on-findings`
is the explicit opt-in gate that exits `1` when findings exist.
`--fail-on-runtime-cycles` is a narrower opt-in gate for the runtime
import-cycle floor: it exits `1` only on import-cycles findings that are not
labeled type-only (see the `import-cycles` section).

## Quickstart: scan an external repo

If you have never run drift:ai before and just want to point it at another repo,
these four steps are the whole path. The deeper sections below explain the model
and every flag; this is the minimum to get a report.

1. **Clone this repo once as your "tools checkout" and install its deps.** Only
   this checkout needs Bun and the implementation tools (`jscpd`, `knip`,
   `ts-morph`); the repo you scan installs nothing.

   ```sh
   git clone <this-repo-url> drift-ai-tools
   cd drift-ai-tools
   bun install
   ```

2. **`cd` into the target repo** — the repo you want to scan. drift:ai uses the
   current directory as its anchor: scanner output, config discovery, and Git
   operations all resolve from here, so finding paths come out repo-relative. The
   target only needs to be a Git repo; it can use any package manager, or have no
   `node_modules` at all.

   ```sh
   cd /path/to/target-repo
   ```

3. **Run a whole-tree audit**, pointing `--root` at the target's source
   directories (repeat `--root` per directory). Use `--scope current` for a
   foreign repo: it audits the working-tree inventory rather than a git diff.

   ```sh
   bun /path/to/drift-ai-tools/scripts/drift-ai.ts --scope current --root src
   ```

   This runs the default check set (`duplicates`, `ghost-files`, `comments`, and
   `suppressions`) and exits `0` — findings are evidence to read, not a failing
   gate. `suppressions` is diff-only, so in `current` scope it skips with a
   printed reason; the other three audit the inventory.

4. **Turn on the opt-in checks when you want a deeper sweep.** `--check all`
   adds every opt-in check: the whole-project adapters (knip pass-through
   categories, import cycles, server layer direction, near-duplicates, the
   `duplicate-*` family) plus `module-doc-paths` and `commented-out-code`; checks
   that need a resolver or a vendored tool the target lacks skip with a printed
   reason instead of crashing.

   ```sh
   bun /path/to/drift-ai-tools/scripts/drift-ai.ts --scope current --root src --check all
   ```

Add `--format json --output report.json`, or `--chunk-dir <dir>` to emit
AI-handoff chunks. Run the entrypoint with `--help` for the full flag list. If
the target ships its own `drift-ai.config.json`, its `roots` are used and you can
drop `--root`; otherwise see [Config discovery](#config-discovery) and the
[starter config](#starter-config).

Inside Musi itself none of the above applies — the package script is already
wired up:

```sh
bun run drift:ai
```

That is the whole supported invocation surface. The model behind it — tools
checkout vs. target repo, why you `cd` into the target instead of passing a
`--repo` flag, what a target repo must supply, and the validated foreign-repo
run — lives in [Portability contract](docs/portability-contract.md).

### Compact multiple reports for agent triage

Downstream triage — reducing drift / Semgrep / Dolos JSON reports into one
ranked review queue, swarm packets, and collected verdicts — is the
`drift:triage` module's job; see
[`scripts/drift-triage/MODULE.md`](../drift-triage/MODULE.md) for the
workflow and contracts.

### Optional: Semgrep community-rule scan

`--check all` does **not** run Semgrep. Semgrep is a separate prototype advisory
subcommand because rule choice and rule licensing belong to the operator. drift:ai
does not distribute Semgrep rules or write Semgrep config into the target repo,
but it can run useful third-party/community rules that you install or explicitly
select.

The fastest no-vendoring path is a live Semgrep Registry pack. It is mutable and
not reproducible, so both network and license consent are explicit:

```sh
cd <target-repo>
bun <tools-checkout>/scripts/drift-ai.ts semgrep-candidates --root src \
  --registry-pack p/default \
  --allow-live-registry \
  --allow-rule-license Semgrep-Rules-License-1.0
```

For reproducible local scans, install the Semgrep engine in the tools checkout,
clone a permissively licensed third-party/community rules repo yourself, and point
drift:ai at that local rule file or directory:

```sh
cd <tools-checkout>
python3 -m venv .tools/semgrep/.venv
.tools/semgrep/.venv/bin/pip install semgrep==1.165.0
git clone https://github.com/<org>/<permissive-rules-repo> .tools/semgrep/rules/<rules-repo>

cd <target-repo>
bun <tools-checkout>/scripts/drift-ai.ts semgrep-candidates --root src \
  --semgrep-config /abs/path/to/tools-checkout/.tools/semgrep/rules/<rules-repo>/<rules.yml> \
  --rule-license MIT
```

See the [Semgrep candidate setup](docs/prototype-subcommands.md#the-semgrep-candidates-prototype-subcommand)
for manifests, license gates, absolute-path guidance, and JSON output.

## Main report quick reference

Primary flags:

| Flag                       | Use                                                                                                                                                                                                                     |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--scope changed`          | Default. Diff against `--base main` (or `origin/main`) plus untracked files.                                                                                                                                            |
| `--scope current`          | Audit the current working tree inventory. Use this for imported/polluted repos or whole-repo sweeps.                                                                                                                    |
| `--check <id>`             | Run one or more checks. Repeat the flag for multiple checks.                                                                                                                                                            |
| `--check all`              | Run every implemented check, including the slower opt-in adapters.                                                                                                                                                      |
| `--root <path>`            | Limit `current` scope to one or more roots; repeatable. Rejected in `changed` scope.                                                                                                                                    |
| `--config <path>`          | Load a specific config. Without it, `drift-ai.config.json` at the target repo root auto-loads when present.                                                                                                             |
| `--format text\|json`      | Select human-readable or machine-readable output.                                                                                                                                                                       |
| `--include-scope`          | With JSON, include the full considered-file scope; otherwise JSON keeps only `scopeCount`.                                                                                                                              |
| `--output <path>`          | Write the primary report to a file.                                                                                                                                                                                     |
| `--chunk-dir <path>`       | Also write AI-handoff chunks plus `manifest.json`; `--chunk-size` defaults to 75.                                                                                                                                       |
| `--fail-on-findings`       | Keep report rendering, but return exit `1` when findings exist.                                                                                                                                                         |
| `--fail-on-runtime-cycles` | Gate on runtime import cycles only (requires `--check import-cycles` or `all`): exit `1` on any import-cycles finding not labeled type-only, or when the check skips (fails closed). Type-only cycles stay report-only. |

Implemented checks:

| Check                 |             Default? | What it reports                                                    | Notes                                                                                                                                                                                                                                                |
| --------------------- | -------------------: | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `duplicates`          |                  Yes | Copy/paste duplicate blocks                                        | Advisory `jscpd` scan at 8 lines / 60 tokens in `mild` mode; no duplication-percentage threshold, no verify slot, and missing/unreadable tool output is reported rather than certified clean.                                                          |
| `ghost-files`         |                  Yes | Suspicious sibling modules such as `foo-helper.ts` beside `foo.ts` | Uses filename tokens and directory peers; configurable allow-pairs for known-good current-state siblings. In `current` scope, established role-split families are suppressed (see below).                                                            |
| `comments`            |                  Yes | Over-narrated files with high comment-to-code ratios               | Honors `checks.comments.excludePrefixes`.                                                                                                                                                                                                            |
| `commented-out-code`  |               Opt-in | Tombstoned code blocks left behind in comments                     | Flags consecutive comment runs that parse cleanly as operative code; `checks.commented-out-code.minLines` / `excludePrefixes`. Evidence only — it does not call the code dead.                                                                       |
| `suppressions`        | Yes in changed scope | Newly added `eslint-disable` / `@ts-*` suppressions                | Diff-only; skipped in `current` scope with a reason and the `changed-scope-only` code.                                                                                                                                                                                                 |
| `module-doc-paths`    |               Opt-in | Stale backtick **file** references in `MODULE.md` / `*-MODULE.md`  | Path existence only (symbols in prose are out of scope); resolves across candidate bases, so it favors precision over recall. Scans every module doc under the roots regardless of scope.                                                            |
| `orphan-files`        |               Opt-in | Never-imported files from the target's knip config                 | Adapter finding provenance is `[target-config]`; skips when the target cannot support a trustworthy knip run.                                                                                                                                        |
| `knip-duplicates`     |               Opt-in | Duplicate export aliases from knip                                 | Same knip adapter as `orphan-files` (`[target-config]`, identical skips). Separate from jscpd `duplicates`, which reports source clone blocks.                                                                                                       |
| `unused-exports`      |               Opt-in | Unused exported symbols/types/enum & namespace members from knip   | Same knip adapter as `orphan-files` (`[target-config]`, identical skips); each finding is tagged `details.category`, and a symbol that is also `@deprecated` gains `details.deprecated`. Shares a single knip spawn with other selected knip checks. |
| `import-cycles`       |               Opt-in | Circular import components                                         | Uses ts-morph/TypeScript resolution; type-only cycles are labeled.                                                                                                                                                                                   |
| `layer-direction`     |               Opt-in | Reverse imports across configured source layers                    | Uses the resolved TypeScript graph; rules come from `checks.layer-direction` (built-in default: zero rules — Musi's bans live in `drift-ai.config.json`), and zero-rule or zero-match runs emit explicit notices. Findings carry `[drift-baseline]` provenance. |
| `near-duplicates`     |               Opt-in | Fuzzy and small exact function clones                              | Report-only union of unchanged fuzzy 8/45/0.85 matching and parser-token exact 3/15 matching under `scripts/**` and `eslint-rules/**`; exact bucket overflow is diagnostic and the exact tier is not in the blocking sensor.                            |
| `duplicate-types`     |               Opt-in | Repeated interface/type-literal property shapes                    | Exact ts-morph structural hashes over non-function type shapes; filters tiny shapes with `minProps`. Findings carry `[drift-baseline]` provenance.                                                                                                   |
| `duplicate-schemas`   |               Opt-in | Repeated object-schema key shapes                                  | Exact ts-morph structural hashes over `<receiver>.object({...})` chains; filters tiny schemas with `minKeys`. Findings carry `[drift-baseline]` provenance.                                                                                          |
| `duplicate-literals`  |               Opt-in | Repeated literal values across files                               | Exact ts-morph grouping. Strings are length-filtered; raw numbers are skipped unless `includeNumbers` is enabled.                                                                                                                                    |
| `duplicate-constants` |               Opt-in | Module-level constants sharing the same literal value              | Exact ts-morph grouping. Short strings and trivial numeric values are filtered before grouping.                                                                                                                                                      |

Subcommands:

| Command                                    | Purpose                                                                                                                                                             |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run drift:ai coverage-evidence`       | Prototype coverage-artifact evidence from configured `coverage.artifacts`; not a trusted finding stream and never runs tests.                                       |
| `bun run drift:ai coverage-unused-exports` | Prototype overlay of a supplied knip unused-exports report onto `coverage.artifacts`; flags covered-but-unused conflicts, never a deletion verdict.                 |
| `bun run drift:ai env-branches`            | Prototype env/define stale-branch predictions under a configured `envDefine` matrix; candidate leads, never findings or branch deletions.                           |
| `bun run drift:ai clone-candidates`        | Prototype MinHash/LSH function clone candidates with ts-morph agreement and sibling-naming overlay evidence; not a trusted finding stream.                          |
| `bun run drift:ai dolos-candidates`        | Prototype fragment-level clone candidates from the external Dolos engine; opt-in (missing binary is an expected absence).                                           |
| `bun run drift:ai semgrep-candidates`      | Prototype Semgrep candidate groups from operator-supplied, license-gated rule sources; opt-in (missing binary or blocked rule source is an expected absence).       |
| `bun run drift:ai ownership`               | Prototype bounded-history file ownership / DOA archaeology; emits owner concentration, recency, co-author, and agent-hand evidence.                                 |
| `bun run drift:ai test-orphaning`          | Prototype bounded-history source/test orphaning; flags source files that churned without their inferred tests moving with them, never a verdict.                    |
| `bun run drift:ai birth-size-delta`        | Prototype bounded-history path-birth size deltas; compares birth/current bytes, effective LOC, and a branch-points complexity overlay, never a refactor verdict.    |
| `bun run drift:ai class-construction`      | Prototype class-construction evidence for classes with no direct construction signal; optional unused-export report correlation, never a deletion verdict.          |
| `bun run drift:ai hotspots`                | Advisory git-history lenses (`churn`, `coupling`, `fragmentation`, `suppression-churn`, `thrash`); not a trusted finding stream.                                    |
| `bun run drift:ai coldspots`               | Advisory git-history lenses (`coldspot`, `stale-markers`); `coldspot` considers files touched in the effective git window.                                          |
| `bun run drift:ai harness-freshness`       | Musi-only docs freshness check for `docs/ai-harness.md` against `docs/guides` and backtick paths.                                                                   |
| `bun run drift:ai config`                  | Read-only inspection of the effective drift:ai config (source, repo root, roots, source extensions, default/implemented checks); runs no checks and writes nothing. |

### Per-check timing

Every report records the wall-clock each check took, skips included (a cheap skip
reads as `0ms`). Text output adds a `timing:` line under the summary; JSON adds
`checkTimings` (one `{ check, durationMs }` per dispatched check, in run order)
and `totalDurationMs` (their sum). Durations are whole milliseconds, so a
sub-millisecond check reads as `0ms`.

This is **evidence only** — timing never changes the exit code, finding order, or
severity. Use it to decide whether a check is cheap enough to run by default. The
fields are additive (report schema v4); a tolerant reader can ignore them, while a
strict reader must accept the new version.

### Portable JSON report contract

`--format json` is the **portable report contract** for downstream/foreign-repo
consumers: a `DriftReport` with a top-level `schemaVersion` (`DRIFT_SCHEMA_VERSION`),
optional `details`/`provenance` on findings, machine-readable `code` on skips, and
`scope` only when `--include-scope` is passed. Its shape is pinned by golden
fixtures in `fixtures/report-contract.*.json` (see `report-contract.test.ts`):
adding, removing, renaming, or reordering a key fails that test until the fixtures
are regenerated with `UPDATE_DRIFT_CONTRACT=1`, so schema changes stay deliberate.
Additive optional fields plus a documented `schemaVersion` bump remain allowed.

This JSON report is the only portable surface. The Musi-internal
`HARNESS_DIAGNOSTICS_OUTPUT` sidecar (`HarnessDiagnostics`) is a separate,
harness-facing envelope — not part of the foreign-repo contract — and depends on
the shared schema and Musi control ids, so do not treat it as the portable shape.
See [Musi integration](docs/musi-integration.md) for the sidecar's own contract.

## Config discovery

Config is discovered from the **target repo** (the cwd), not the tools checkout:

- With no `--config`, drift:ai looks for `drift-ai.config.json` at the **target
  repo root**. If absent, it falls back to built-in defaults (universal ignore
  segments like `node_modules`/`dist`/`build`, etc.).
- `--config <path>` loads an explicit file, resolved relative to the cwd (the
  target repo).

The `drift-ai.config.json` committed **in this repo** is **Musi's own config**
(its source roots, its ghost-file allow-pairs). It is **not** a default applied to
other repos — a foreign target gets the built-in defaults unless it supplies its
own config.

### Starter config

A target repo can start from a generic example and adapt it. A copyable
[`drift-ai.config.example.json`](../../drift-ai.config.example.json) lives at the
repo root. Copy the fields that fit your target and delete roots or globs that do
not apply.

Any example config is an **illustrative starting point**, not an authoritative
default. drift:ai's built-in defaults (universal ignores, etc.) are the real
defaults; the example just shows the shape and common knobs.

The example includes a `layer-direction` starter rule because that check has
**no** built-in rules at all: layering policy is repository policy, so it always
comes from your config. Copy the rule shape and swap in your own layer names and
path prefixes (and prune `allowedEdges` down to your own known exceptions).

Top-level `coverage.artifacts` is an evidence-source list for prototype coverage
surfaces. Each entry is read-only and has a repo-relative artifact path plus a
free-text label such as `unit`, `e2e`, or `prod`; artifacts are kept separate in
output and are never silently unioned.

## Deeper reference

The supported quick reference stays in this file; the material that only some
readers need is split into focused docs that travel with the tools checkout:

- [Portability contract](docs/portability-contract.md) — tools checkout vs.
  target repo, locating the checkout, installing implementation deps, the
  canonical invocation in full, why `cd` into the target and no `--repo` flag,
  target assumptions, and updating the checkout.
- [Check reference](docs/check-reference.md) — per-check implementation and
  calibration rationale for every implemented check, plus what a field-run
  calibration record must contain.
- [Supported subcommand reference](docs/subcommand-reference.md) — the `config`
  inspection subcommand and the `hotspots` advisory lenses in detail.
- [Musi integration](docs/musi-integration.md) — the Musi-only
  `harness-freshness` subcommand and the `HarnessDiagnostics` sidecar.

## Prototype advisory lane (heavy/experimental lenses)

Heavy, noisy prototype lenses are indexed in this README but documented in
focused files so the supported quick-reference stays skimmable:

- [Prototype advisory contract](docs/prototype-contract.md) defines the
  `kind: "advisory"`, `lane: "prototype"` envelope, partial-run disclosures,
  caps, prerequisites, and no-findings firewall.
- [Prototype subcommands](docs/prototype-subcommands.md) covers
  `clone-candidates`, `dolos-candidates`, `semgrep-candidates`,
  `coverage-evidence`, `coverage-unused-exports`, `env-branches`, `ownership`,
  `test-orphaning`, `birth-size-delta`, and `class-construction`.
- [Prototype calibration infrastructure](docs/prototype-calibration.md) covers the
  bounded full-history helper, clone/dead-code corpora, sibling naming classifier,
  and class-construction inventory.

Prototype subcommands are not check ids, are not included in `--check all`, and
never emit `DriftFinding` rows. Treat their output as review leads until a lens
earns promotion.

## Known gaps (tracked)

The contract above is the _supported_ behavior. A few pieces are still being
brought fully in line with it:

- **Additional portable checks.** More plugin-style checks and adapter skip
  reasons are tracked in the backlog; the current default surface stays limited
  to checks that can run usefully across arbitrary TypeScript repos.

For maintainers, the drift:ai task pack is complete; its archive summary and the
contract's rationale live in
[`docs/agent_notes/finished_work/drift-ai-next-items.md`](../../docs/agent_notes/finished_work/drift-ai-next-items.md)
(the individual leaves, including `01-shared-context.md`, are in git history before
the pack folder was removed).
