# Prototype Subcommands

## The `clone-candidates` prototype subcommand

`clone-candidates` is the first prototype-lane consumer. It runs the task-41a
MinHash/LSH shortlist over the same filtered function inventory as
`near-duplicates`, then records whether the existing ts-morph near-duplicate
engine selected each shortlisted pair. It is intentionally not a check id and is
not included in `--check all`. It needs **no setup** beyond the tools checkout's
own `bun install` — both the MinHash shortlist and the ts-morph agreement pass
run in-process.

```sh
bun run drift:ai clone-candidates --root scripts/drift-ai --top 20
bun run drift:ai clone-candidates --root src --format json --output clone-candidates.json
```

Rows carry MinHash provenance (`shingleSize`, `bands`, `rowsPerBand`, signature
length), estimated similarity, ts-morph score/threshold evidence, and an
agreement flag. Caps for function count, shingles per function, candidate pairs,
and display truncation are disclosed in the prototype advisory header/section so
a capped run is visibly partial.

When a shortlisted near-duplicate row compares two files in the same directory
whose basenames differ only by implementation-variant markers (`legacy`, `v2`,
`backup`, etc.), the row may include a `siblingNaming` overlay. This is extra
context only: it shows sibling paths, shared tokens, marker pattern, near-duplicate
supporting evidence, and caveats such as public API, framework entrypoint,
dynamic-use, or test-only risk. Pairs listed in `checks.ghost-files.currentAllowedPairs`
suppress this overlay while leaving the clone-candidate row intact.

## The `dolos-candidates` prototype subcommand

`dolos-candidates` surfaces fragment-level clone candidates from the external
[Dolos](https://dolos.ugent.be/) engine (tree-sitter + winnowing) through the
same prototype advisory contract. Like `clone-candidates` it is **not** a check
id and is not part of `--check all`. Dolos is **opt-in and never vendored**: if
the binary is not on `PATH` (or at `--dolos-bin <path>`), the advisory reports an
unmet `dolos engine` prerequisite and still exits 0 — a missing tool is an
expected absence, not a finding.

### Setup (one-time, operator-managed)

Install the Dolos CLI globally with npm (it is a Node tool; any Node-equipped
machine works) and confirm the binary answers:

```sh
npm install -g @dodona/dolos
dolos --version
```

drift:ai looks for `dolos` on `PATH`; a non-global install (or an npx shim)
works too if you point `--dolos-bin` at the executable. Nothing is installed
into the tools checkout or the target repo.

```sh
bun run drift:ai dolos-candidates --root src --top 20
bun run drift:ai dolos-candidates --root src --dolos-bin /opt/dolos --threshold 0.4
bun run drift:ai dolos-candidates --root src --format json --output dolos-candidates.json
```

Dolos runs over the same filtered source inventory the `near-duplicates` engines
use (drift ignore globs, `excludeGlobs`, `.d.ts`, and unsupported extensions are
all dropped first), in a temp report directory so the target repo stays clean.
Its similarity is Dolos' own fragment-overlap score, deliberately not tied to the
near-duplicates AST threshold; tune it with `--threshold` and `--language`. Rows
carry engine name/version (when Dolos reports it), language mode, score vs
threshold, file ranges, and overlap/coverage metrics. Caps for files, candidate
pairs, reported pairs, the wall-clock timeout, and display truncation are
disclosed in the advisory header/section so a capped, timed-out, or failed run is
visibly partial. Dolos' CSV output is file-pair oriented, so ranges are full-file
spans; any file missing a line-count source is disclosed as a `degraded:` line.

## The `semgrep-candidates` prototype subcommand

`semgrep-candidates` scans the current tree with the external
[Semgrep](https://semgrep.dev/) engine using **operator-supplied,
license-gated rule sources** and groups the matches by `(check_id, path)`
through the same prototype advisory contract. Like the other prototype lenses
it is **not** a check id, is not part of `--check all`, and never emits
`DriftFinding` rows. Semgrep is **opt-in and never vendored**: a missing
binary (resolution order: `--semgrep-bin <path>`, then the tools checkout's
`.tools/semgrep/.venv/bin/semgrep`, then `semgrep` on `PATH`) reports an unmet
`semgrep engine` prerequisite and still exits 0.

### Setup (one-time, operator-managed)

Two pieces are needed before the first scan: the **engine** and at least one
**rule source**. Neither is vendored; both live outside the repos being scanned.

**1. Install the Semgrep engine.** The tools-checkout convention is a Python
venv at `.tools/semgrep/.venv` (gitignored, per-checkout) — that path is
resolution rung 2, so once it exists no flag is needed. Pin the version so
calibration runs stay comparable (`1.165.0` is the version the Musi field runs
validated):

```sh
cd <tools-checkout>
python3 -m venv .tools/semgrep/.venv
.tools/semgrep/.venv/bin/pip install semgrep==1.165.0
```

Any other install (`pipx install semgrep`, `brew install semgrep`) works too —
either let it land on `PATH` or pass `--semgrep-bin <path>`.

**2. Supply rules.** There is no default rule set, and drift:ai does not
distribute Semgrep rules. Declare what to run and under which license. You have
two practical starter paths:

- **Live Semgrep Registry/community packs** such as `p/default`: easiest to try,
  but mutable and not reproducible. They require explicit `--allow-live-registry`
  and license consent.
- **Local third-party/community rule repos** that you clone yourself: better for
  repeatable scans. Prefer permissively licensed repos when possible, record the
  license, and pin the checkout commit plus a config hash in the manifest.

For local rules, clone the rule repo into your tools checkout or another
operator-managed location, then either pass the rule config directly or copy
[`semgrep-rules.example.json`](../../../semgrep-rules.example.json) (repo root)
and adapt it:

```sh
git clone https://github.com/<org>/<permissive-rules-repo> \
  <tools-checkout>/.tools/semgrep/rules/<rules-repo>
cp <tools-checkout>/semgrep-rules.example.json semgrep-rules.json
# edit semgrep-rules.json: point `config` at the rule file/dir, record the
# license, and pin `commit`/`sha256` so the run reports `reproducible: true`
```

Manifest `config` paths and the `--rule-source-manifest` path itself resolve
**relative to the scanned repo's root** (the cwd's repo), not the tools checkout.
When scanning a foreign target, use absolute paths for both the manifest and any
rules kept in the tools checkout; otherwise a relative `.tools/...` path points
at the target repo. Alternatively skip the manifest: pass ad-hoc
`--semgrep-config <path> --rule-license <license>` pairs, or use a live
`--registry-pack p/...` (which needs the consent flags shown below and is never
reproducible).

```sh
bun <tools-checkout>/scripts/drift-ai.ts semgrep-candidates --root src \
  --rule-source-manifest /abs/path/to/semgrep-rules.json
bun <tools-checkout>/scripts/drift-ai.ts semgrep-candidates --root src \
  --semgrep-config /abs/path/to/rules/mit-rules.yml --rule-license MIT
bun <tools-checkout>/scripts/drift-ai.ts semgrep-candidates --root src --registry-pack p/default \
  --allow-live-registry --allow-rule-license Semgrep-Rules-License-1.0
```

Rule sources are **explicit and license-classed**; there is no default rule
set. Declare them as repeatable `--semgrep-config <path>` /
`--rule-license <license>` pairs, as live `--registry-pack p/...` packs, or in
a structured `--rule-source-manifest` JSON document (`schemaVersion: 1`, a
`sources` array of `local` / `registry-pack` entries with license and
commit/sha256 pinning metadata). `local` configs must be local files or
directories; URL and registry-shaped configs are rejected so mutable network
rules cannot bypass `--allow-live-registry`, and registry packs must keep the
`p/<pack>` shape so `auto`, single registry rules, URLs, and local paths cannot
ride the registry-pack label past those checks. Known registry packs carry
curated licenses (`p/default` and the other Semgrep-maintained packs are
Semgrep-Rules-License-1.0, `p/trailofbits` is AGPL-3.0); the curated license
always wins, and a manifest that declares a conflicting license for a known
pack is rejected as a manifest defect — consent belongs in
`operatorAcceptedLicense` or `--allow-rule-license`, not a relabel. A declared local config that is
not on disk is a blocked source (relative paths resolve from the repo root), so
one typo'd path cannot fail the whole scan or read as a satisfied rule-source
prerequisite. Permissive licenses (MIT,
Apache-2.0, BSD, ISC, CC0) run by default; the Semgrep Rules License, copyleft
licenses, and undeclared/unknown licenses are **blocked without an explicit
`--allow-rule-license <license>` opt-in**, and live registry packs additionally
require `--allow-live-registry` because they fetch mutable network-hosted
rules. A blocked or missing rule source is an unmet `semgrep rule source`
prerequisite (exit 0); only a malformed/unreadable manifest or invalid CLI
pairing is a usage error (exit 2). With no allowed source the scan is
**skipped** and the engine prerequisite reads "not probed".

Unlike the JS/TS-gated clone lenses, roots pass to Semgrep **unfiltered** —
Semgrep's own language detection chooses files, so Go and other non-TS files
in foreign repos stay visible. The drift `ignore` config travels as repeated
`--exclude` flags; drift:ai never writes a `.semgrepignore`, config, or cache
into the target repo. Mirroring current scope — where an explicitly requested
root overrides its own matched ignore prefix — any exclude glob that would
swallow a requested root wholesale is dropped for that run, so
`--root src/generated` under an ignored `generated` segment scans instead of
silently reporting no matches. Rows carry the namespaced rule id, path, hit
count and ranges, severity, and rule metadata (confidence/likelihood/impact,
category, CWE/OWASP, references) sorted by confidence, severity, then group
size — **never source snippets** (`extra.lines` is never read), so secret-rule
matches stay safe to hand off by default. Semgrep **renders matched
metavariable values into rule messages**, so messages can embed matched source
too: default output withholds them (rows carry `message: null` and the section
says `rule messages: withheld`), and `--include-rule-messages` opts in with the
interpolation risk disclosed beside the rows. The section header carries engine version, scanned-file count, and
per-source provenance (license class, pinning, `reproducible:` marker —
live-registry sources are never reproducible). Semgrep scan errors, skipped
rules, and malformed result rows render as degradations, and the wall-clock
timeout is a disclosed cap.

Semgrep also applies its own target filters, and a completed scan **discloses
that scope** rather than letting "no matches" read as a full current-tree
claim: Semgrep's default target filters (default ignore patterns plus target
`.gitignore` / `.semgrepignore` handling) are rendered as a `scan scope:` line
beside the scanned-file count and carried as `scanScope` data in the JSON
section; and when the target carries one or more `.semgrepignore` files (which
Semgrep honors silently, on top of the drift `--exclude` flags), the run
renders a `degraded:` line saying the target shaped the scan. That probe runs
only behind a completed scan, is scoped to the scan roots — a nested
`.semgrepignore` governs only its own subtree, so with `--root src` the probe
covers `src/**` plus the repo root and the root's ancestor directories (whose
files govern subtrees that include the root), not an unrelated
`docs/.semgrepignore` — and skips the scan's own `--exclude` scope plus the
`.tools/` checkout, so a `.semgrepignore` vendored inside an excluded tree
(e.g. an engine venv) never reads as target scan shaping.

## The `coverage-evidence` prototype subcommand

`coverage-evidence` reads existing artifacts from top-level `coverage.artifacts`
in the drift config and renders their raw hit evidence through the same prototype
advisory contract. It never runs tests, never computes a coverage gate, and never
correlates zero-hit code with reachability; that correlation is the separate
`coverage-unused-exports` subcommand below. A missing or malformed artifact is
disclosed as partial evidence, not a finding.

```sh
bun run drift:ai coverage-evidence --config drift-ai.config.json
bun run drift:ai coverage-evidence --config drift-ai.config.json --top 100
bun run drift:ai coverage-evidence --config drift-ai.config.json --format json --output coverage-evidence.json
```

Rows name the artifact path, configured label, parser format (`lcov` today),
timestamp when available, file/function or line range, and raw hit count. Each
configured artifact becomes its own section so unit, e2e, and production coverage
remain distinct. The `--top` cap applies per artifact section and is disclosed in
the advisory header/section when rows are hidden.

## The `coverage-unused-exports` prototype subcommand

`coverage-unused-exports` overlays runtime coverage onto static reachability: it
correlates a **supplied** knip unused-exports report against the configured
`coverage.artifacts` and reports where the two signals agree, conflict, or have no
coverage. Like the rest of the prototype lane it is **not** a check id, is not part
of `--check all`, and renders through the task-39 advisory contract
(`kind: "advisory"`, `lane: "prototype"`, no `findings`, no WARN/FIX).

It is **consume-don't-run** on both inputs: drift never runs tests and never runs
knip here. Produce the static report yourself and point the flag at it:

```sh
knip --reporter json --include exports,types,enumMembers,namespaceMembers > knip-unused.json
bun run drift:ai coverage-unused-exports --config drift-ai.config.json --unused-exports-report knip-unused.json
bun run drift:ai coverage-unused-exports --config drift-ai.config.json --unused-exports-report knip-unused.json --format json --output coverage-unused.json
```

Each row carries the static category and location (knip), the standing trap caveat,
and a per-artifact coverage result — `covered` (executed), `uncovered` (a record
exists but zero hits), or `unavailable` (no file/line match or no location). Runs
are **never unioned**: unit/e2e/prod each contribute their own state, so a symbol
uncovered in one run but executed in another stays visibly distinct. Rows are
summarized into three agreement states:

- `covered-but-unused` — knip calls it unused, yet some run executed it. The
  strongest false-positive lead: the static signal is likely wrong (dynamic import,
  reflection, framework entry, test-only use).
- `uncovered-and-unused` — both signals agree. Stronger evidence, **not** a deletion
  verdict; the standing caveat enumerates the invisibly-reachable patterns the
  task-40b corpus calibrates against.
- `coverage-unavailable` — coverage did not speak to the symbol.

`uncovered` and `unused` stay separate words on purpose. Missing locations,
unmatched files, path-suffix (source-map) matches, lcov-only/line-only precision,
and coverage/knip parse degradations are all disclosed in the advisory header. The
`--top` cap bounds the displayed correlation rows (conflicts first, then
agreements, then unavailable) and discloses truncation.

## The `env-branches` prototype subcommand

`env-branches` predicts stale guard branches from environment and bundler-define
reads. It inventories `process.env`, `import.meta.env`, `Bun.env`, and configured
`define` constants, then — under an **explicit, operator-supplied** matrix — reports
which guard conditions fold to a constant, which branch that leaves unreachable, and
whether a static bundler/minifier would erase it. Like the rest of the prototype lane
it is **not** a check id, is not part of `--check all`, and renders through the
task-39 advisory contract (`kind: "advisory"`, `lane: "prototype"`, no `findings`, no
WARN/FIX).

It never infers deployment environments: with no `envDefine` config the matrix
prerequisite is disclosed as **unmet** and no source is scanned. Supply the assumed
values in the top-level `envDefine` block (provider-specific tables override the
provider-agnostic `env` fallback; `source` defaults to the config key path):

```json
{
  "envDefine": {
    "processEnv": { "NODE_ENV": { "value": "production", "source": "prod deploy" } },
    "importMetaEnv": { "PROD": { "value": true, "source": "vite" } },
    "defines": { "__DEV__": { "value": false, "source": "vite define" } }
  }
}
```

```sh
bun run drift:ai env-branches --config drift-ai.config.json
bun run drift:ai env-branches --config drift-ai.config.json --top 100
bun run drift:ai env-branches --config drift-ai.config.json --format json --output env-branches.json
```

Resolved predictions and unresolved conditions are kept in **separate sections** so an
"unknown" branch (matrix insufficient or unsupported expression) is never mistaken for
a resolved lead. Each row names the condition and its file location, every env/define
read inside it with its assumed value and `source`, the predicted constant, the dead
branch (`then`/`else`), and a bundler-fold expectation: `static-define` (define /
`import.meta.env` reads a define-substituting bundler inlines), `env-inlining-dependent`
(a `process.env`/`Bun.env` read folded only if the bundler is configured to inline it),
or `not-static` (unresolved). The evaluator stays conservative — equality/inequality,
truthiness, negation, and short-circuit `&&`/`||` only — so an unsupported expression
stays unresolved rather than guessed. Provider flag systems (LaunchDarkly, Unleash,
Piranha, Harness) are out of scope; supply their resolved values through the matrix.
The `--top` cap applies per section and discloses truncation.

## The `ownership` prototype subcommand

`ownership` runs the bounded full-history collector and emits file-level ownership
/ DOA archaeology through the prototype advisory contract. It is **not** a check
id and is not part of `--check all`; rows are review leads, not ownership
verdicts.

```sh
bun run drift:ai ownership --top 30
bun run drift:ai ownership --since 2025-01-01 --max-commits 2000 --max-files 10000
bun run drift:ai ownership --agent-identity-pattern 'my-agent@example\.com'
bun run drift:ai ownership --format json --output ownership.json
```

Rows name the first author, dominant contributing owner, top primary author,
co-authors, matched agent hands, own-vs-other change counts, owner recency,
recent subjects, regex commit-intent labels over those subjects, and a copy-paste
`git log --oneline -- <path>` inspect command. Co-authors count as contributing
hands for the ownership score, but the JSON keeps `author`, `coAuthors`, and
`agentHands` as separate fields so agent involvement is not collapsed into human
ownership. `.mailmap` is honored through
`git check-mailmap` when available.

Agent-hand detection is regex-based and configurable with repeatable
`--agent-identity-pattern`. The defaults seed common Claude, Codex, Copilot, and
GitHub bot identity patterns; supplied patterns are added to that seed. Full
history caps (`--since`, `--max-commits`, `--max-files`, `--max-output-bytes`,
`--timeout-ms`) route through the bounded collector, and hit caps render as
partial-run disclosures in both text and JSON.

## The `test-orphaning` prototype subcommand

`test-orphaning` runs the bounded full-history collector and asks a different
archaeology question than `ownership`: not "who owns this?" but "did the tests
move with the source?" For each source file it infers candidate test paths from
configurable path conventions, then measures whether those tests co-changed with
the source. It is **not** a check id and is not part of `--check all`; rows are
review leads, not deletion or "add a test" verdicts.

```sh
bun run drift:ai test-orphaning --top 30
bun run drift:ai test-orphaning --min-source-commits 3
bun run drift:ai test-orphaning --test-pattern 'test/{name}.test{ext}'
bun run drift:ai test-orphaning --since 2025-01-01 --max-commits 2000
bun run drift:ai test-orphaning --format json --output test-orphaning.json
```

Output is split into two candidate sections so the two cases never blur together:

- **source files with no inferred test** — none of the candidate test paths appear
  in the scanned history. The row names the source churn, the paths it looked for,
  the last source change, recent subjects, commit-intent labels over those
  subjects, and an inspect command.
- **source files whose tests lag source churn** — a test exists but the source has
  changed without it. The row adds the related tests (each with its own churn and
  last-change date), test churn, source-only commit count, last source / test /
  co-change dates, source commits since the last co-change, and an `orphanScore`
  (`sourceOnlyCommits / sourceChurn`). A source whose tests co-changed every time
  appears in neither section.

Path conventions are mapping templates with `{dir}`, `{name}`, and `{ext}`
placeholders. The defaults cover the two layouts Musi and most TS packages use — a
sibling `*.test`/`*.spec` file and a `__tests__/` directory beside the source.
Repeatable `--test-pattern` appends extra templates (e.g. a parallel `test/` mirror
tree); each supplied template must include `{name}`. `--min-source-commits`
(default 2) is the churn floor that keeps files created once and never touched out
of the leads. Detection is path-convention only: a source tested through the import
graph rather than a sibling file reads as "no inferred test", so the rows stay
candidate-framed. Full-history caps route through the bounded collector and render
as partial-run disclosures in both text and JSON.

## The `birth-size-delta` prototype subcommand

`birth-size-delta` runs the bounded full-history collector, finds each current
source file's earliest observed touch for its current path, reads that old blob
with `git show <sha>:<path>`, and compares it with the current file. It is **not**
a check id and is not part of `--check all`; rows are then-vs-now evidence, not
abandonment or refactor verdicts.

```sh
bun run drift:ai birth-size-delta --top 30
bun run drift:ai birth-size-delta --max-blob-reads 100 --max-blob-bytes 1048576
bun run drift:ai birth-size-delta --since 2025-01-01 --max-commits 2000
bun run drift:ai birth-size-delta --format json --output birth-size-delta.json
```

Rows carry birth commit/date/author/subject, commit-wide birth-burst file and
line counts, current-vs-birth UTF-8 bytes, current-vs-birth effective LOC,
per-path churn since observed birth, a `git show` blob command, and a
`git log --oneline -- <path>` inspect command. Effective LOC is the same
comment-aware line scanner used by the comments check: lines with code outside
comments count; blanks and pure comments do not.

Each row also carries a `branch-points` complexity overlay (metric name and
version are disclosed in the header). It is a deterministic, parser-only count of
AST decision points — `if`, `for`/`for..in`/`for..of`, `while`, `do..while`,
`switch` `case` clauses, `catch`, ternary `?:`, and the `&&`/`||`/`??` operators —
run on the same birth and current blobs. It is **not** ESLint cyclomatic
complexity (no `+1` base, no type information, no ESLint run) and is not labeled as
such; routine complexity enforcement stays with lint-ratchet. The overlay reports
then-vs-now totals and delta plus the heaviest contributing functions in the
current blob, and only strengthens or weakens the size evidence — it is never a
standalone abandonment or refactor verdict. A blob that is missing or fails to
parse yields a null overlay and a row caveat (a degradation), never a finding.

The lens uses current paths only. The bounded collector runs `git log
--no-renames`, so pre-rename history may be absent and the advisory discloses
that caveat. If the history walk is capped or `--since`-limited, row birth data
means "earliest observed touch", not guaranteed original creation. Missing old
blobs stay visible in rows with null birth metrics instead of being silently
dropped.

Blob comparisons are separately bounded: `--max-blob-reads` caps how many
path-history candidates get current/birth blob reads before display ranking,
while `--max-blob-bytes` and `--blob-timeout-ms` bound each `git show` read. A
hit cap is disclosed in the prototype advisory header so a large or blobless
repo run cannot look exhaustive.

## The `class-construction` prototype subcommand

`class-construction` inventories TypeScript/TSX class declarations and reports
classes with no direct construction signal or only ambiguous name-based evidence.
It is **not** a check id and is not part of `--check all`; rows are review leads
for runtime construction paths, not deletion or dead-code verdicts.

```sh
bun run drift:ai class-construction --root packages/server/src
bun run drift:ai class-construction --unused-exports-report knip-unused.json
bun run drift:ai class-construction --format json --output class-construction.json
```

Rows carry the class location, declaration/export status, direct construction
counts (`new`, subclassing, JSX references, custom-element registrations),
reference counts (value, decorator, type-only, string-keyed), static factory
methods, caveats, and an inspect reminder. The parser inventory is intentionally
limited: it does not run the type checker, model framework host APIs, or prove
runtime registration. The advisory header discloses that limitation as a
degradation.

When `--unused-exports-report <path>` is supplied, the command reads an existing
`knip --reporter json` unused-exports report and correlates matching class symbols
into the rows. The command never runs knip itself. A missing, unreadable, or
unparseable report is disclosed as an unmet prerequisite, while the class
inventory still runs.
