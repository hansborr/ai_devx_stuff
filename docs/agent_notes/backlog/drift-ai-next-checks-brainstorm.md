# drift:ai — next checks brainstorm (AI-slop auditing)

Date: 2026-05-30; status refreshed 2026-07-25
Status: brainstorm / research · drained — the prototype/heavy queue was
executed through `backlog/drift-ai-next-items/` and closed out; the Dolos and
MinHash advisory integrations landed 2026-06-04 (see
`finished_work/drift-ai-{dolos,minhash}-advisory-integration.md`) and all 43
pack leaves landed by the 2026-06-20 close-out
(`finished_work/drift-ai-next-items.md`). Retained for design rationale.
Updated 2026-05-30: second-pass review of the rejected-idea lists under a more
prototype-friendly posture.

**Default-lane baseline (2026-05-31):** the three default-lane tracks landed on
`feat/drift-ai-enhancements` — the `coldspots` subcommand (coldspot + stale-markers
lenses), the four non-function structural-duplication checks
(`duplicate-{types,schemas,literals,constants}`), and the `unused-exports` knip
pass-through. See `finished_work/drift-ai-next-checks-default-tracks.md` for the
build, decisions, and the still-open follow-ups (knip `duplicates`, the shared
ts-morph Project layer, and the whole prototype/heavy queue below).

Research synthesis on making `drift:ai` more useful for auditing codebases for "AI
slop" — duplication two agents write differently, dead code left after refactors,
and git-history coldspots. Produced by a 5-agent research+audit team; the seam
claims below were spot-verified against the tree.

## Decision model (default lane vs prototype lane)

The first-pass filter was useful for deciding what can ship in the default report,
but it was too harsh for a research/prototyping tool. Keep the conservative lane,
but do **not** use "evidence-not-verdicts", low false-positive expectations, or
zero-`node_modules` portability as reasons to kill an experiment prematurely.

Use two lanes:

1. **Default lane.** Low-noise, report-only, small setup surface, preferably
   tool-checkout owned dependencies. Rows should be immediately legible and safe
   to show in routine agent handoff.
2. **Prototype / heavy lane.** Opt-in checks may install dependencies, invoke
   Java/Python/Rust/Docker tools, require the target's `node_modules`, run a full
   type-checker, consume runtime artifacts, emit scores, and be noisy. Humans or
   AI review agents can triage false positives. The hard requirement is provenance:
   each row names the engine, version/config when available, candidate source,
   score/threshold if any, file ranges, and the raw evidence that caused the row.

Under this model, "evidence, not verdicts" means "show where the information came
from and how strong it is"; it does **not** mean scores, ML retrieval, generated
file labels, or noisy candidates are banned.

## Recommended order (value × feasibility × lane fit)

1. **Coldspots lens + stale-marker aging lens** (hotspots subcommand). Infra is
   already there; advisory-by-construction so the FP bar is automatically met;
   directly answers the ask. **Ship first.**
2. **Non-function near-duplicates** (duplicate type/interface shapes, Zod schema
   shapes, repeated literals/constants). Cheap, near-zero FP on exact structural
   matches, legible, and squarely the "near-duplicate code *and variables*" ask.
3. **Reachability / unused exports** — wrap more of knip first (`files`,
   `exports`, `types`, `enumMembers`, `namespaceMembers`, `duplicates`) when a
   target config is available; keep the portable ts-morph symbol graph as a
   separate offline experiment for uninstalled repos and richer local evidence.
4. **Better function near-dup** (MinHash/LSH candidate-gen, pq-gram comparator)
   and an opt-in winnowing engine (Dolos). Refinements, not headline wins.
5. **Architectural enabler:** a shared ts-morph `Project`/AST layer once ≥2 AST
   checks exist (today each one re-parses from scratch).

Prototype/heavy queue to try after the default tracks have a clean adapter shape:
**Dolos/PMD-CPD/APTED clone comparison**, **coverage-informed dead-code overlays**,
**feature-flag/env stale-branch detection**, **DOA/ownership decay**, and
**complexity-at-birth vs now**.

---

## Area 1 — Coldspots & git archaeology (ship first)

### The vacuum problem (the whole design hinges on this)

Sort a repo by "hasn't changed lately" and you get 80–95% of the files. Stability
is the *normal, desirable* state of production code, so naive coldspots are pure
noise. The fix, which also keeps it honest as evidence:

> **A coldspot is only surfaced when at least one independent amplifier suggests
> the stillness is concealment rather than quality.** The amplifier is a legible
> reason; the human still decides. A file in the list *without* an amplifier
> shouldn't be in the list.

### What's already there (verified)

The git collector needs **no changes**. `hotspots-history.ts` already yields, per
commit/file: revision count, line churn, author + `Co-authored-by` identities,
author dates, subjects — plus `linesAvailable` (blobless) and squash auto-detect
(`metric`/`metricAutoSwitched`/`singleRevisionRatio`). Per-file first-seen /
last-touched are computed on demand by lenses already — `hotspots-thrash.ts:121-128`
(`updateTouchDates`, `oldestTouchMs`/`newestTouchMs`) is the copyable pattern.

### Lens seam (verified, thin)

Mirror an existing lens: create `hotspots-coldspots.ts` (reduce fn + section
type), then edit `hotspots-format.ts` (add to `HotspotLens` union + `HotspotSection`
union), `hotspots-args.ts:10-25` (`CONCRETE_LENSES` + `LENS_SELECTIONS`),
`hotspots.ts` (`reduceSection` dispatch), `hotspots-format-sections.ts`
(`appendSection` dispatch). Every row carries the shared `HotspotRowContext`
(authors/agents, recent subjects, raw numbers, copy-paste `git log` inspect cmd).

### Coldspot lens design

Gate: `age > AGE_THRESHOLD` AND `revisions <= REVISION_FLOOR` AND **≥1 amplifier**.
Threshold logic mirrors churn's median-standout (`hotspots-churn.ts:22-45`) but
inverted and amplifier-gated — never a fixed top-N. Amplifiers, all git+fs only:

- **stale-in-hot-neighborhood** — the file's directory churns while the file
  doesn't (`dir_churn / file_churn ≥ K`). Strongest, purely git. A fossil sitting
  in an active module is exactly what a maintainer wants flagged.
- **write-once birth-burst** — introduced in a large multi-file commit
  (`git show --stat` on the birth commit: ≥N files, ≥M lines added) and never
  meaningfully touched since. The purest "agent scaffolded a module in one run and
  nobody revisited it" signal. **Must degrade on squash repos** (reuse the
  existing squash flags) where single-revision is meaningless.
- **gone-silent author** — the file's dominant author's most recent repo-wide
  commit is old (orphaned ownership / bus-factor).
- **large-file cold** — size as a secondary amplifier (a 500-line cold file is
  higher-stakes than a 12-line one).

Row context names *which* amplifier(s) fired. Degradation reuses `linesAvailable`
and the squash detection already in the collector.

### Companion lens — stale-marker aging

Cheap, extremely legible, AI-specific ("promised and forgotten"): TODO / FIXME /
HACK / XXX / `@deprecated` markers, aged by `git blame` introduction date. Surface
a file when its oldest marker crosses a threshold; row shows marker counts by
type, age + text of the oldest, and the introducing author/SHA. Empirical anchor:
median TODO lifespan ~246 days, ~62% of live TODOs are >1yr old (Morlion). Caveat:
`git blame` is slow on blobless clones — gate behind a `git log` pre-filter and
disclose the limitation, same as `thrash`.

### Git-archaeology initially rejected ideas and revisit status

The first pass was too quick to reject several archaeology lenses because it
treated "heavy" as equivalent to "not useful." Heavy is fine in the prototype
lane if the output names its source and cost.

| Idea | First-pass rejection | Second-pass status |
|---|---|---|
| File access time (`atime`) | Reset by IDEs, linters, tests, `relatime`/`noatime`; not a code signal. | **Keep rejected.** Cheap but actively misleading. |
| Commit-message NLP / "AI-written message" detection | Needs model/API; high FP because humans write terse messages too. | **Revisit only as an overlay.** Do not claim "AI-written"; classify maintenance intent (`fix`, `refactor`, `scaffold`, `generated`, `update`) and show the subjects that drove the label. |
| DOA / per-line code longevity | Blame-per-line across every commit was considered too expensive. | **Revisit.** Classic Degree of Authorship can start at file/symbol level from `git log --numstat`, not per-line. Blame caching is a heavy-mode upgrade, not a prerequisite. |
| Knowledge concentration / gone-silent author trend | Medium FP and lower value than simple coldspot amplifiers. | **Revisit as an ownership lens.** The existing gone-silent author amplifier is the cheap version; a fuller lens can emit dominant owner, owner recency, and successor candidates. |
| Test/source orphaning | Ranked below coldspot amplifiers. | **Revisit.** Source files that churn without matching test co-change are noisy but valuable candidates for agent review. |
| Complexity-at-birth vs now | Interesting, but ranked below coldspots. | **Revisit in heavy mode.** It is a strong "scaffolded complex once and abandoned" signal when combined with coldness or ownership concentration. |
| PR-review-count ownership | Needs GitHub/GitLab/host API. | **Keep out of default; revisit only as a host-specific adapter.** |

Prototype shapes worth adding:

- **DOA / ownership decay lens.** Compute file-level first author, dominant owner,
  own vs other-authored changes, normalized DOA-style ownership score, last
  repo-wide activity for the dominant owner, and `Co-authored-by` identities.
  Use `.mailmap` when present. This is a medium-cost full-history pass; reserve
  per-line ownership for the blame-cache tier.
- **Blame cache.** `git blame --porcelain` / `--incremental` is machine-readable
  and unlocks stale-marker age, line-age histograms, and line ownership. Cache by
  `HEAD`, path/blob OID, blame flags, and ignore-revs hash; disclose cache
  hit/miss and blobless/partial-clone limitations.
- **Test/source orphaning.** Start with path-convention mapping plus git
  co-change counts; later add import-graph mapping and coverage overlays. Emit
  related-test inference, source churn, last source/test co-change, and
  source-only commit count.
- **Complexity-at-birth vs now.** Use `git show <birth-sha>:<path>` rather than
  checking out old revisions. Emit birth commit/date/author, birth-burst size,
  LOC/complexity then and now, and rename-tracking caveats.
- **Commit-message intent overlay.** Regex is enough for a first pass; local NLP
  can be tried later. It should amplify other rows, not stand alone.

Research anchors for the next agent: DOA/code ownership literature, Microsoft
ownership studies, `git blame` porcelain/incremental docs, and production-test
co-evolution studies.

---

## Area 2 — Near-duplicate code **and variables** (second)

### Where the current near-dup sits

`near-duplicates` is **function-only**: top-level/named functions, class methods,
and arrow/assignment functions with a reportable name. It normalizes identifiers
& literals to an AST feature multiset, buckets candidates by *statement signature*,
and scores with a composite Dice coefficient at 0.85 (`near-duplicates.ts:210-217`,
`near-duplicates-fingerprint.ts`). By construction it ignores anonymous functions,
nested functions, and **everything non-function** — no variables, types, schemas,
constants, enums, or literals. jscpd (`duplicates`) is token-based and misses the
same semantic/structural class. That non-function gap is the user's "variables"
call-out and the cheapest, highest-precision win.

### New checks — non-function structural duplication (cheap, near-zero FP)

All pure ts-morph AST, no type-checker, no `node_modules`; exact structural hashing
→ essentially no false positives, only a triviality filter:

- **duplicate type/interface shapes** — canonicalize each `interface`/`type` to a
  sorted `[propName, typeText]` bag, hash, group cross-file. Catches two agents
  defining the same DTO. Guard: min ~3 props. (Text-structural, not semantic — won't
  unify `string` vs an alias; acceptable for evidence.)
- **duplicate Zod (and similar) schema shapes** — schemas are call expressions;
  normalize `z.object({...})` by sorting keys, hash, group. Catches the same schema
  written twice with different field order. Lossy on `.min(1)` vs `.nonempty()` — fine.
- **repeated literals / magic values** — string/number literals appearing in ≥N
  distinct files. Cross-file `sonarjs/no-duplicate-string`. Guards filter the
  obvious noise (import paths, test titles, short/trivial values) — that's
  noise-filtering, not adjudication.
- **duplicate constant values** — module-level `const`s holding the same non-trivial
  literal value across files (a missed shared constant).

Reuse: the fingerprint primitives (`signatureForNode`/`featureKind`/`hashFeature`/
`multisetDice`) generalize to these new feature sets; the inventory/scope walk
(`source-walk.ts` → `walkSourceFiles`, with ignore/excludeGlobs/sourceExtensions/
`.d.ts` filtering) is the same seam near-dup already consumes.

### Better function near-dup (refinement, later)

The statement-signature bucketing misses Type-3 clones where a helper was extracted
or statements moved across buckets. Two pure-TS upgrades (no ML): a **MinHash/LSH**
candidate generator over normalized token shingles (catches "same algorithm + one
extra guard clause" that diverges in node sequence), feeding the existing comparator;
and/or **pq-gram** approximate tree-edit distance as a comparator that tolerates
local structural edits (`@se2p/pq-distance`, MIT, O(n log n)). Both raise tuning/FP
cost, so they rank below the non-function checks.

### Opt-in deep engine

**Dolos** (`@dodona/dolos-lib`, MIT, winnowing/MOSS, ships its own tree-sitter →
no target `node_modules`) as an opt-in `near-duplicates` engine alongside the
existing `similarity-ts` option. Fragment-level output reads as evidence.

### Clone ideas initially rejected and revisit status

The clone skip list is where the relaxed prototype lane changes the most. The
default lane should still lead with exact/non-function structural duplication and
cheap near-dup refinements, but the "no Java/Python/Rust, no scores, no noise"
filter cut useful experiments too early.

| Idea/tool | First-pass rejection | Second-pass status |
|---|---|---|
| `jscpd` | Already integrated; token/exact duplicate baseline. | **Keep as baseline.** Treat as exact/token evidence, not semantic clone coverage. |
| Dolos (`@dodona/dolos-lib` / CLI) | Kept only as opt-in. | **Revisit strongly.** It uses tree-sitter, k-grams, Rabin-Karp/winnowing, and supports TypeScript out of the box; good fragment-level evidence for a second engine. |
| PMD-CPD | Java runtime, no obvious advantage over `jscpd`. | **Revisit.** CPD supports JavaScript/TypeScript and is a practical comparison wrapper after `jscpd`; Java is acceptable in prototype mode. |
| APTED / full tree-edit distance | No native TS implementation; O(n³) all-pairs cost. | **Revisit as second-stage comparator.** Generate candidates with MinHash/SimHash/`jscpd`/Dolos, cap AST node counts, then run Java/Python APTED on the shortlist. Do not run all-pairs. |
| SimHash | Too coarse as standalone function detector. | **Revisit only as candidate generation.** Use normalized token shingles and min-token guards; never emit a standalone "clone" row from SimHash alone. |
| PDG clone detection | Needs def-use/type information; too heavy for portable default. | **Revisit in research mode, not first.** Prefer Joern/CPG-backed CFG/PDG extraction over a bespoke ts-morph PDG-lite. Requires JDK/Joern, cache, memory budget, and TS coverage validation. |
| ML/embedding clone detection (CodeBERT/GraphCodeBERT/GNNs) | Infra-heavy, noisy, hard to explain. | **Revisit as semantic retrieval.** Use top-k nearest functions as candidates, then ask APTED/AST/token overlap or human/agent review to validate. Emit model, score, rank, and source snippets. |
| `jsinspect` | Unmaintained since 2017, no serious TS path. | **Low-priority revisit for JS-only calibration only.** Not a primary TS engine unless parser behavior is tested and acceptable. |
| NiCad / Open-NiCad | No TS parser, TXL toolchain, language support mismatch. | **Keep low priority for TS.** Worth revisiting for non-TS repos or if someone wants to maintain a TS grammar. |
| SourcererCC | Java/Python pipeline, GPL, built for huge corpora. | **Do not wrap first.** Steal the bag-of-tokens + positional filtering idea for candidate generation; only run the tool itself for large-corpus experiments. |

Prototype `clone-deep` output should include `engine`, engine version, language
mode, candidate generator, comparator, score/threshold, file ranges, snippet
hashes, AST/token sizes, timeout/cap flags, and whether another engine agreed.
Noisy scores are acceptable if they are clearly scores rather than deletion
advice.

Open benchmark need: build a small fixture corpus with exact clones, renamed
clones, extracted-helper clones, reordered-statement clones, same-behavior
different-structure examples, and known non-clones. Use it to decide whether each
engine stays in the prototype matrix.

---

## Area 3 — Symbol-level dead code (third; highest FP risk)

### The gap

Existing coverage: `orphan-files` (knip pass-through, **file-level**, needs the
target's `node_modules` + knip config), `ghost-files` (sibling naming),
`import-cycles` (**file-level** ts-morph graph). ESLint/tsc cover the within-file
cases (`no-unused-vars`, `no-unreachable`, `noUnusedLocals`) — leave those to the
lint baseline. The one genuinely cross-file thing nothing here catches is **unused
exports**: an exported symbol never imported anywhere in the resolved graph.

### Reachability tracks, cheapest first

- **(a) Expand the knip pass-through first.** The current adapter parses only the
  `files` category (`knip-orphan-files.ts:73-92`) and the runner includes only
  `files`. Before rebuilding reachability, parse and surface more target-configured
  knip issue types: `exports`, `types`, `enumMembers`, `namespaceMembers`, and
  `duplicates`. This gives immediate prototype coverage with the framework/plugin
  knowledge knip already owns, stamped `[target-config]`.
- **(b) Portable ts-morph symbol graph as a separate experiment.** The
  `import-cycles` graph proves offline alias/relative resolution without
  `node_modules`, but it records **file→file edges only**:
  `extractSpecifiers` (`import-cycles-graph.ts:245-273`) captures module path +
  `typeOnly`, **not** imported symbol names, and no export set. A portable
  unused-exports check is real new code — export extraction, per-import symbol
  names, a reverse index, plus barrel/re-export transitivity. Keep it because
  uninstalled-target coverage and richer local evidence are valuable, but do not
  treat it as a replacement for knip's plugin ecosystem.
- **(c) Coverage/runtime overlays.** Static reachability and runtime coverage
  answer different questions. Coverage can say "this range was not executed in
  this run"; static reachability can say "no static import/reference found."
  Combined rows are much stronger than either signal alone.

### False-positive traps (where provenance matters most)

Barrels/re-exports, public-API entrypoints, dynamic `import()` (already parsed in
the graph), test-only usage, framework magic, string-keyed/reflection access.
Mitigations stay on the "evidence" side: treat barrels as transparent pass-through,
take an `entrypoints` glob from config, surface test-only usage as a *separate
labeled signal* rather than suppressing or adjudicating it, skip `.d.ts`. Keep it
**opt-in** and framed as candidates.

### Tombstone / refactor-residue (be conservative here)

AI-specific but heuristic — guard against over-cleverness:

- **commented-out code blocks** — ≥N consecutive comment lines that parse as TS.
  Cheap, legible standalone signal; label it "commented-out code", not "dead code".
- **`@deprecated` + unreferenced** — explicit tombstone that never got removed
  (an overlay on the unused-exports result).
- **sibling-impl naming** (`foo`/`fooV2`/`fooLegacy` where the old one is
  unreferenced) — real AI pattern but ~10–20% FP; better surfaced as an *overlay*
  on coldspots/near-dup than as its own confident check.

### Dead-code ideas initially rejected and revisit status

| Idea/tool | First-pass rejection | Second-pass status |
|---|---|---|
| Coverage-informed dead code | Needs runtime data; not static or portable. | **Revisit, high value.** Consume artifacts first (`coverage-final.json`, `lcov.info`, V8 coverage), optionally run a configured command later. Emit artifact source, timestamp/command if known, file/range/function, hit count, and whether static reachability also flagged it. |
| Never-instantiated classes | DI, factories, decorators, and framework registration make this an FP minefield. | **Revisit as noisy candidates.** Emit class declaration, export status, `new` count, value references, type-only references, decorators, inheritance, JSX/custom-element hints, and factory/static references. Do not call it dead code. |
| Reimplementing knip reachability | Knip has framework plugins; rebuilding all entrypoint logic is a bad trade. | **Wrap more first; reimplement targeted gaps later.** Knip JSON categories are the cheap calibration source. Portable ts-morph reachability is still useful for offline repos and evidence enrichment. |
| Feature-flag / env branch detection | Requires environment-specific evaluation; brittle allowlists. | **Revisit, split in two.** (1) Static env matrix: `process.env`, `import.meta.env`, `Bun.env`, bundler-defined constants. (2) Feature-flag lifecycle: flag key references plus provider metadata when supplied. |
| `ts-prune` / `ts-unused-exports` / `fallow` / Unreach / similar tools | Older tools overlap knip or have maintenance risk. | **Use for calibration, not primary adoption yet.** Run them on the same fixture repos and compare disagreement with knip + ts-morph. |

Expected coverage false positives: live-but-untested code, error paths, admin
flows, rare feature-flag paths, build/source-map mismatches, and client/server
coverage artifacts that only cover one runtime. This is fine in prototype mode if
the row names the coverage source and command.

Expected class-instantiation false positives: Nest/Angular-style DI, decorators,
ORM entities, React class components, custom elements, `Object.create`,
reflection/string lookups, abstract base classes, tests, fixtures, and factory
registries. Start with "no value references and no obvious framework/decorator
markers" to keep the first prototype reviewable.

Feature-flag/env rows should emit the condition, assumed environment map or flag
metadata source, branch predicted dead/alive, provider pattern, and whether a
bundler/minifier transform would be expected to erase the branch. Piranha,
LaunchDarkly code references, Unleash lifecycle metadata, Harness cleanup, and
FlagShark are worth checking as prior art.

---

## Cross-cutting

- **Shared ts-morph layer.** Each AST check re-parses from scratch (no shared
  `Project` cache). Once a second AST check lands (any Area-2 non-function check),
  a shared parse+normalization layer pays off in both speed and reuse of the
  fingerprint primitives. Architectural enabler, not a user-facing feature.
- **Adding a check** (verified recipe): new `DriftCheckId` in `types.ts`; a
  `*-check-config.ts` (`CheckConfigMetadata`, set `runByDefault:false` for
  whole-project analyzers); a `*-check.ts` (`defineCheckPlugin`); register in
  `check-metadata.ts` + `check-registry.ts`. Consume files via `walkSourceFiles`.
- **Experimental output contract.** Prototype checks need a separate
  `candidate`/`experimental` severity or lane marker so noisy rows do not read
  like the default report. JSON should preserve per-engine provenance, raw scores,
  thresholds, caps/timeouts, artifact paths, and disagreement between engines.
- **Dependency posture.** Default checks should still prefer tool-checkout
  dependencies and graceful skips. Prototype checks can require target installs,
  external runtimes, or cached artifacts, but the report must make those
  prerequisites visible.

## Positions on the open questions (Claude, 2026-05-30)

Answers to the second-pass review's open questions, in the two-lane spirit. Three
are flagged **(needs sign-off)** — privacy, licensing, and product-identity calls
the maintainer should own rather than the next implementing agent. The rest are
recommended defaults an implementer can build against.

**Caching & history**

1. *Cache location → OS user cache, keyed by repo identity; configurable.* Default
   `${XDG_CACHE_HOME:-~/.cache}/drift-ai/<git-toplevel-hash>/`, with a `--cache-dir`
   flag + config override. **Not** repo-local by default: drift:ai runs from a
   tools-checkout against a *foreign target* whose tree it must not write into (the
   "target supplies only source" contract). Always disclose the resolved cache dir
   and hit/miss in output. Repo-local `.drift-ai/cache` is an opt-in for the
   run-inside-Musi single-repo case only.

2. *Archaeology history depth → quick lanes are windowed; heavy lanes are
   capped-full.* Default/coldspot-style lenses reuse the existing window machinery
   (14d default, auto-widen to 180d on sparse history). Heavy lenses whose question
   requires old history (code-age, first-seen, DOA) run full-history analysis under
   explicit commit/file/time caps. If a cap is hit, either skip with a clear reason
   or honor an explicit `--since` / `--max-commits` operator limit and disclose the
   exact range scanned. Never silently truncate.

**Ownership & mapping**

3. *Co-authored-by → both, as distinct fields.* Count co-authors as contributing
   hands for ownership/DOA, but emit `author`, `coAuthors`, and `agentHands` as
   **separate** columns so a human reads ownership and agent-involvement
   independently. Agent-hand detection should be configurable identity patterns
   (seeded with common Claude / Codex / Copilot noreply patterns), not a hard-coded
   list. Don't collapse them; the fragmentation lens already treats co-authors as
   distinct hands. Honor `.mailmap` for identity coalescing.

4. *Source/test mapping order → path/naming conventions first, configurable from
   day one.* Cheapest (git+fs only, no graph build): `foo.ts` ↔ `foo.test.ts` /
   `__tests__/foo.ts`. Import-graph mapping second (reuses the ts-morph graph once
   it exists). Coverage mapping last (needs artifacts). Ship the cheap one, layer up.

**ML & privacy**

5. *Local models / hosted APIs.* Local models — **yes in the prototype lane**:
   explicit opt-in, disclosed model id, nothing leaves the machine. Hosted embedding
   APIs on private code — **default off, explicit operator opt-in only, never the
   default lane, with a data-egress disclosure. (needs sign-off)** — the privacy
   posture for private source is yours to set.

**Output & filtering**

6. *Generated/vendor/i18n → configured ignores first; no hidden heuristic filter.*
   Apply the user's explicit `ignore` / `excludeGlobs` config as usual. After that,
   the default lane should not silently remove rows because a file "looks
   generated" or "looks vendored." Prototype lane may attach a
   *disclosed-heuristic* label (evidence, reversible) but must not remove rows.
   Hard removal stays the user's job through explicit config, never an internal
   guess. This keeps the earlier steer against generated-file cleverness while
   allowing labels in the heavy lane.

**Coverage**

7. *Consume vs run → consume artifacts by default; run is explicit opt-in.* Read
   `coverage-final.json` / `lcov.info` / V8 json from a configured/auto-discovered
   path. Running a coverage command is a heavy-lane `--run-coverage <cmd>` opt-in,
   never implicit (test-runner assumptions, side effects, wall-clock).

8. *Coverage sources → per-artifact, labeled by config, never merged.* The row names
   the artifact path and a user-supplied label (unit/e2e/smoke/prod). "Uncovered by
   unit but covered by e2e" is exactly the distinction the human needs; drift:ai
   shouldn't guess the kind or union the bitmaps.

**External tools & licensing**

9. *External-tool defaults → acceptable in prototype mode with mandatory provenance.*
   Reuse the existing `ConfigSource` stamps (`target-config` / `tool-default` /
   `drift-baseline`) so a tool's own default is never read as the target's verdict.
   The default lane still prefers target-authored config.

10. *GPL tools (NiCad, SourcererCC) → operator-installed, shell-out-only, never
    vendored or distributed. (needs sign-off)* Detect on PATH, skip-with-reason if
    absent (same pattern as `similarity-ts` / jscpd-bin resolution). This is an
    intended distribution boundary, not legal advice; the distribution-policy call
    is yours to confirm before implementation.

**Feature flags**

11. *Provider parsing → generic env-matrix first.* `process.env`, `import.meta.env`,
    `Bun.env`, bundler-defined constants — provider-agnostic, covers the common
    dead-branch. Provider-specific (LaunchDarkly code-refs, Unleash lifecycle,
    Piranha) is later / opt-in / config-driven; those two carry the cleanest metadata
    if we go there.

**Product identity**

12. *Auto-fix → stay report-only. (needs sign-off.)*
    Report-only is drift:ai's whole contract (the exit-0 sensor). Point at the fixer
    (`knip --fix`, piranha) in a hint, but never mutate the target. Codemods are a
    different tool's job; folding them in would dissolve the report-only guarantee
    every consumer relies on.

**Budgets & benchmarks**

13. *clone-deep budget → explicit disclosed caps.* Wall-clock + per-pair AST-node
    cap + candidate-count cap, tuned against the benchmark corpus, with a
    "stopped after N pairs / Xs, M unexamined" disclosure. No silent truncation —
    a capped run that reads as complete is the failure mode to avoid.

14. *Benchmark fixture set → a committed labeled corpus for calibration and
    regression.* Under `scripts/drift-ai/fixtures/`, covering both clone types
    (exact, renamed, extracted-helper, reordered, same-behavior/different-structure,
    plus known non-clones) and dead-code FP-traps (barrel re-exports,
    dynamic-import-only usage, test-only usage, framework-entry, reflection access).
    The corpus should set minimum precision/recall expectations and catch
    regressions, but it is not enough by itself to prove an engine is useful. Keep
    engines in the prototype matrix only after both corpus results and field-trial
    runs justify the cost/noise tradeoff. Building the corpus is itself an early
    task.

The three **(needs sign-off)** items (5 hosted-API, 10 GPL distribution, 12 auto-fix)
are the only ones I won't unilaterally close; the rest are recommended defaults.

## Revisit source trail

- Clone detection: [Dolos languages](https://dolos.ugent.be/about/languages.html)
  and [algorithm](https://dolos.ugent.be/about/algorithm.html),
  [PMD CPD JS/TS support](https://pmd.github.io/pmd/pmd_languages_js_ts.html)
  and [CPD docs](https://pmd.github.io/pmd/pmd_userdocs_cpd.html),
  [Joern CPG](https://cpg.joern.io/) and
  [JavaScript frontend](https://docs.joern.io/frontends/javascript/),
  [CCGraph PDG paper](https://yinxingxue.github.io/papers/ase2020_CCGraph%20A%20PDG%20based%20Code%20Clone%20Detector%20With%20Approximate%20Graph%20Matching.pdf),
  [CodeBERT paper](https://huggingface.co/papers/2002.08155),
  [GraphCodeBERT clone examples](https://github.com/microsoft/CodeBERT/tree/master/GraphCodeBERT/clonedetection),
  and [APTED](https://github.com/DatabaseGroup/apted).
- Dead code and flags: [Knip issue handling](https://knip.dev/guides/handling-issues),
  [Knip CLI](https://knip.dev/reference/cli),
  [Knip reporters](https://knip.dev/features/reporters),
  [Vitest coverage](https://vitest.dev/config/coverage.html),
  [c8](https://github.com/bcoe/c8),
  [V8 coverage](https://v8.dev/blog/javascript-code-coverage),
  [webpack DefinePlugin](https://webpack.js.org/plugins/define-plugin/),
  [Piranha](https://github.com/uber/piranha),
  [LaunchDarkly code references](https://launchdarkly.com/docs/eu-docs/home/flags/code-references),
  and [Unleash flag lifecycle](https://docs.getunleash.io/concepts/feature-flags).
- Git archaeology: DOA/code-ownership literature
  ([Linux authorship study](https://link.springer.com/chapter/10.1007/978-3-319-57735-7_15)),
  [Microsoft ownership study](https://www.microsoft.com/en-us/research/publication/dont-touch-my-code-examining-the-effects-of-ownership-on-software-quality/),
  [DOK paper](https://www.cs.ubc.ca/sites/default/files/tr/2009/TR-2009-13_0.pdf),
  [git blame docs](https://www.kernel.org/pub/software/scm/git/docs/git-blame.html),
  [production-test co-evolution](https://arxiv.org/abs/1709.09029),
  [commit-message quality](https://arxiv.org/abs/2202.02974), and
  [commit-message NLP overview](https://www.mdpi.com/2076-3417/12/21/10773).

## Resolved decisions (first pass, amended by 2026-05-30 review)

1. **Coldspots → new `coldspots` subcommand** (sibling to `hotspots`, not lenses
   folded into it). It reuses the same git collector (`hotspots-history.ts`,
   unchanged) and the shared row-context/format infra, but gets its own arg parser
   + dispatch + "these are not defects" advisory header, like `hotspots` does. The
   `coldspot` and `stale-markers` reducers become lenses *within* that subcommand
   (`--lens coldspot|stale-markers|all`). Keep the conceptual hot/cold split clean
   at the CLI; factor any genuinely shared subcommand wiring rather than copy it.
2. **Non-function near-dup → separate check ids per kind** (e.g.
   `duplicate-types`, `duplicate-schemas`, `duplicate-literals`,
   `duplicate-constants`), each its own opt-in `DriftCheckId` with its own config
   block and provenance, sharing the AST walk/fingerprint primitives underneath.
   More registry surface, but granular enable/disable and clearer findings.
3. **Reachability / unused exports → wrap more knip first, keep portable
   ts-morph as a parallel experiment.** The first pass picked the portable graph
   as the target; the revisit changes the order. Expand the existing knip adapter
   to more issue categories first because it gives immediate target-configured
   value and a calibration baseline. Then build the portable graph for
   uninstalled/offline targets and richer local evidence: per-file export sets,
   per-import symbol names, reverse index, barrel/re-export transitivity,
   `entrypoints` config, test-only labeling, `.d.ts` skip, and dynamic-import
   awareness. Keep both opt-in and candidate-framed.

These resolve the brainstorm into default implementable tracks plus a prototype
queue. The active follow-up execution queue now lives in
`backlog/drift-ai-next-items/`, with heavy clone, runtime/dead-code, and
archaeology ownership ideas kept prototype-only. The queue now also has a shared
bounded full-history foundation, separate clone and dead-code calibration
corpora, Dolos as a parked external clone engine, and noisy dead-code overlays
kept for opt-in experimentation rather than dropped.
