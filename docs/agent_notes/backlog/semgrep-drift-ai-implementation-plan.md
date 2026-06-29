# Semgrep support in drift:ai - implementation plan

Status: all slices done (engine installed, real output captured; rule-source
manifest, license gate, and args landed; runner and JSON parser landed;
advisory builder and formatter landed; command registered with docs and
parity updates; first calibration recorded — 0 TP across a 5-repo corpus,
recommendation keep opt-in and pursue the first-party pack). The successor
first-party `ai-footguns` pack was evaluated in lint-followups-2026-06 Leaf 10
and DEFERRED (0 rules): every evidenced footgun class is already enforced at
ESLint `error` and Musi is TS-only, so semgrep's value (specificity + multi-
language) does not apply here; the opt-in lane stays as-is, not retired. See
the lint-followups summary in
`docs/agent_notes/finished_work/lint-followups-2026-06.md`; that leaf's
original verdict now lives only in git history.
Date: 2026-06-05
Revised: 2026-06-05 after cross-review against the parked portable-AI-repo-scan
and security-sensor-evaluation notes; same day, added slice 0 results, then
slice 2 results, then slice 3 results, then slice 4 results; 2026-06-06,
added slice 5 results
Research: `docs/agent_notes/backlog/semgrep-drift-sensor-research.md`

## Goal

Add Semgrep as an opt-in `drift:ai` prototype-lane advisory that can scan Musi
and foreign repos for generic security/correctness candidates using
Semgrep-compatible rules, while preserving drift:ai's report-only and
evidence-not-verdicts contract.

The first user-facing surface should be:

```sh
bun run drift:ai semgrep-candidates --root src --rule-source-manifest semgrep-rules.json
```

It emits `kind: "advisory"`, `lane: "prototype"`, exits 0 for expected missing
tool/rule cases, and stays out of `--check all` and the `DriftFinding` stream.

## Non-goals

- No default-lane check and no CI gate.
- No automatic remediation.
- No automatic AI triage or persisted verdict store in the first slice.
- No vendored Semgrep registry snapshots, Trail of Bits rules, or other
  restricted/copyleft third-party rules in this repository by default.
- No changed-scope `--baseline-commit` lane in the first slice.
- No writes to target repos, ever — no Semgrep install, no `.semgrepignore`, no
  config or cache files. The target supplies source only; excludes travel as
  CLI flags.

## Design decisions

### 1. Prototype subcommand, not a check

Implement `semgrep-candidates` beside `dolos-candidates`:

- Register in `scripts/drift-ai/prototype-subcommands.ts`.
- Add docs in `scripts/drift-ai/docs/prototype-subcommands.md` and the README
  subcommand table.
- Update the existing parity tests that intentionally omit prototype subcommands
  from `harness.controls.json`.
- Do not add a `DriftCheckId`, do not touch main `DriftReport` fixtures, and do
  not register in `CHECK_PLUGINS`.

Rationale: Semgrep is noisy, externally supplied, rule-license-dependent, and
still uncalibrated for this repo. That matches the prototype advisory contract,
not the promoted finding stream.

### 2. Semgrep is an optional external binary

Resolution order:

1. `--semgrep-bin <path>` explicit override.
2. A tools-checkout managed path, e.g. `.tools/semgrep/.venv/bin/semgrep`.
3. `semgrep` on `PATH`.

The subcommand should not install Semgrep. A missing binary becomes an unmet
`semgrep engine` prerequisite and exits 0, matching Dolos behavior.

Invoke Semgrep with report-only, privacy-conscious defaults:

```sh
semgrep scan \
  --json \
  --metrics=off \
  --disable-version-check \
  --oss-only \
  --config <local-config-or-pack> \
  --exclude <ignore-glob> \
  <roots>
```

Do not pass `--error`; Semgrep's own docs say `semgrep scan` exits 0 when the
scan completes unless `--error` is used. Treat Semgrep exit 2+ and invalid JSON
as degraded prototype runs, not drift findings.

Map the drift-ai `ignore` config to repeated `--exclude` globs so fixture and
generated directories do not dominate results. Excludes are CLI-only: never
write `.semgrepignore` or anything else into the target repo. (The parked
Musi-lane security note recommends a committed `.semgrepignore`; that applies
to Musi's own future `semgrep:audit` lane, not this portable adapter.)

Parse `--version` for engine provenance, but do not enforce a documented
minimum version yet; set one only after calibration exposes a real feature
dependency.

### 3. Rule sources are explicit and license-classed

First slice supports two source mechanisms:

1. Repeatable local configs:

   ```sh
   --semgrep-config /path/to/rules.yml --rule-license MIT
   ```

2. A structured manifest:

   ```sh
   --rule-source-manifest semgrep-rules.json
   ```

Manifest shape:

```json
{
  "schemaVersion": 1,
  "sources": [
    {
      "kind": "local",
      "config": "/home/alice/rules/patched-codes-semgrep-rules.yml",
      "license": "MIT",
      "sourceUrl": "https://github.com/patched-codes/semgrep-rules",
      "commit": "abc123",
      "sha256": "..."
    },
    {
      "kind": "registry-pack",
      "pack": "p/default",
      "license": "Semgrep-Rules-License-1.0",
      "operatorAcceptedLicense": true
    }
  ]
}
```

License classes:

| Class | Examples | Default behavior |
| --- | --- | --- |
| `permissive` | `MIT`, `Apache-2.0`, `BSD-2-Clause`, `BSD-3-Clause`, `ISC`, `CC0` | allowed |
| `restricted-internal-use` | `Semgrep-Rules-License-1.0` | blocked without explicit opt-in |
| `copyleft` | `AGPL-3.0`, `GPL-3.0` | blocked without explicit opt-in |
| `unknown` | missing or unrecognized license | blocked without explicit opt-in |

Operator opt-in:

```sh
bun run drift:ai semgrep-candidates \
  --root src \
  --registry-pack p/default \
  --allow-live-registry \
  --allow-rule-license Semgrep-Rules-License-1.0

bun run drift:ai semgrep-candidates \
  --root src \
  --semgrep-config /home/alice/rules/trailofbits-semgrep-rules \
  --rule-license AGPL-3.0 \
  --allow-rule-license AGPL-3.0
```

Registry packs require both:

- `--allow-live-registry`, because they fetch mutable network-hosted rules.
- an allowed non-permissive license class when the pack is known restricted.

Live registry packs are exploration-only. A mutable pack has no content hash to
record, so advisory provenance must mark rows from live-registry sources as
`reproducible: false`. Calibration records (slice 5) only count as comparable
across runs when every rule source is a pinned local source with commit and/or
sha256.

Failure semantics:

- A malformed manifest or invalid CLI arguments is a usage/config error: exit 2.
- A valid-but-blocked source (license or registry gate) or a missing rule
  source renders an unmet `semgrep rule source` prerequisite and exits 0,
  matching the prototype advisory contract.

Known pack/license defaults:

- `p/default`, `p/security-audit`, `p/secrets`, `p/r2c-best-practices`,
  `p/typescript`, `p/nodejs`, `p/react`, `p/ai-best-practices`: classify as
  `Semgrep-Rules-License-1.0`.
- `p/trailofbits`: classify as `AGPL-3.0`.
- Unknown `p/...`: classify as `unknown` unless the manifest supplies a license.

Do not commit third-party rule snapshots until a human explicitly chooses a
license posture. MIT rule repos such as `AikidoSec/opengrep-rules`,
`patched-codes/semgrep-rules`, and `elttam/semgrep-rules` can be operator-managed
local sources or considered later for vendoring with notices.

### 4. Output shape

The runner parses Semgrep JSON and builds grouped advisory rows.

Group by:

```text
(check_id, path)
```

Group row fields:

- rule id (`check_id`)
- file path
- count and ranges
- severity
- confidence, likelihood, impact, category, subcategory when present
- CWE, OWASP, and references when present
- rule source provenance: engine version, source kind, config/pack, license,
  source URL/commit/hash when known, and a reproducibility marker
  (live-registry sources are `reproducible: false`)
- display rank
- inspect command or next step

Sort groups by:

1. confidence descending (`HIGH`, `MEDIUM`, `LOW`, unknown)
2. severity descending (`ERROR`, `WARNING`, `INFO`, unknown)
3. smaller group size first
4. rule id, then path

Use prototype sections rather than one flat list:

- `Semgrep candidate groups`
- `Semgrep scan errors and partial-parse disclosures` if useful as a separate
  zero-row/details section, or otherwise put parse errors in `degradations`.

Disclosure:

- Semgrep parse errors, invalid rules, timeout, unsupported language, and skipped
  paths go to prerequisites/caps/degradations. They are never findings.
- File/display caps use `PrototypeCap`.
- A missing rule source is an unmet `semgrep rule source` prerequisite.

### 5. Snippet and secrets policy

Semgrep Community Edition redacts `extra.lines` and `extra.fingerprint` when
logged out, so the adapter must not depend on those JSON fields.

First slice defaults:

- No source snippets in JSON or text output.
- Include path/range metadata and rule messages only.
- Add `--include-snippets` later only after redaction tests exist.
- Never include snippets for secret-detection rules unless a separate
  `--include-secret-snippets` flag exists; that flag should not be part of the
  first implementation.

This keeps AI handoff safe by default. A reviewer can open the file locally from
the reported path/range.

Amendment (2026-06-06, third review pass): "rule messages only" was not
snippet-safe — Semgrep interpolates matched metavariable values into the
rendered `extra.message` (see the pattern-syntax docs on displaying matched
metavariables in rule messages), so a one-line rule can put matched source,
including secrets, into the message. Default output now withholds rendered
messages (`message: null` on rows, `ruleMessages: "withheld"` on the section,
policy stated in text); `--include-rule-messages` opts in with the
interpolation risk disclosed beside the rows.

### 6. No persisted verdict store in the first slice

The first implementation only groups and ranks candidates. It does not deduplicate
across runs or remember triage verdicts.

Defer self-computed fingerprints and a verdict store until after one full
calibration pass. When added, compute:

```text
hash(check_id, path, normalized-span, snippet-hash)
```

Read snippets from disk for hashing only, not for default report output.

### 7. Current-scope only, and Semgrep does its own file discovery

Use `prepareCurrentRun` for repo root resolution, root validation, and config
discovery only, matching other prototype current-scope subcommands. Hand
Semgrep `prepared.roots` directly, normalizing empty or whole-repo roots to
`.`, and let Semgrep's own language detection choose files.

Do not pass `detectorScope.files`, `sourceExtensions`, or the
Dolos/near-duplicates filtered inventory to Semgrep. That inventory is
JS/TS-gated (`SOURCE_LIKE_EXTS` in `scripts/drift-ai/path-util.ts`), and the
Dolos command deliberately feeds it to its runner because Dolos is a JS/TS
tool. Copying that pattern here would silently blind the adapter to Go and
other non-TS files in foreign repos — multi-language reach is the point of
this sensor. The drift `ignore` config still applies, but via the `--exclude`
mapping in decision 2, not via the walker's extension filter.

Do not use Semgrep `--baseline-commit` initially. It has useful recurring-lane
properties, but it also requires clean-enough git state, non-shallow history, and
careful merge-base selection. Add it only after current-scope calibration.

## Implementation slices

### Slice 0 - Engine install and real-output capture (done 2026-06-05)

Semgrep 1.165.0 (matching the research setup) is installed at
`.tools/semgrep/.venv/bin/semgrep` — resolution-order entry 2 in decision 2 —
and `.tools/` is gitignored. A real logged-out smoke scan over
`scripts/drift-ai` with a throwaway first-party rule confirmed the contract
assumptions slices 2-3 encode, plus two facts the plan did not predict:

- `semgrep scan --json --metrics=off --disable-version-check --oss-only`
  exits 0 with findings present (no `--error`), as decision 2 expects.
- Logged-out CE redacts `extra.lines` and `extra.fingerprint` to the literal
  string `"requires login"`, as decision 5 expects.
- Top-level JSON keys: `version`, `errors`, `paths`, `results`,
  `skipped_rules`, `time`, `profiling_results`, `engine_requested`.
- New: `check_id` is namespaced by the rule config's path stem (rule `x` in
  `/tmp/rules.yml` reports as `tmp.x`), so parser fixtures and the
  `(check_id, path)` grouping key must not assume bare rule ids.
- New: Semgrep applies its own target filters by default (default ignore
  patterns plus target `.gitignore` / `.semgrepignore` handling). Its Gitignore
  handling does not simply mean "tracked files only"; tracked files are not
  excluded by Gitignore and untracked non-ignored files can still be scanned.
  Relevant when calibrating against foreign repos carrying untracked work;
  decide during slice 5 whether the adapter should disclose this as a cap.

The capture is committed at
`scripts/drift-ai/fixtures/semgrep/scan-output.logged-out.json` (real 1.165.0
output with `/workspace/` path prefixes stripped, otherwise byte-identical
shape) together with the rule file that produced it
(`fixtures/semgrep/smoke-rules.yml`). Slices 2-3 should derive parser
fixtures from this capture rather than hand-written guesses. The raw
unsanitized run is also parked at `tmp/semgrep-smoke/` (gitignored,
per-checkout).

The engine venv and the parked raw output are per-checkout and gitignored.
To reproduce slice 0 on a fresh checkout:

```sh
python3 -m venv .tools/semgrep/.venv
.tools/semgrep/.venv/bin/pip install semgrep==1.165.0
.tools/semgrep/.venv/bin/semgrep scan --json --metrics=off \
  --disable-version-check --oss-only \
  --config scripts/drift-ai/fixtures/semgrep/smoke-rules.yml \
  scripts/drift-ai
```

Slices 1-4 do not need the binary (tests use fake spawn); only re-capture and
slice 5 calibration do.

### Slice 1 - Arguments, manifest parsing, and license gate (done 2026-06-05)

Add:

- `scripts/drift-ai/semgrep-candidates-args.ts`
- `scripts/drift-ai/semgrep-rule-sources.ts`
- `scripts/drift-ai/semgrep-rule-sources.test.ts`

As landed, three deviations from that file list:

- The manifest parser lives in `semgrep-rule-sources.test.ts`-covered
  `scripts/drift-ai/semgrep-rule-manifest.ts` (the 300-line module ratchet forced
  the split; types and gate stay in `semgrep-rule-sources.ts`).
- `scripts/drift-ai/semgrep-candidates-args.test.ts` exists too, pinning the
  argv-order `--semgrep-config`/`--rule-license` pairing through the real parser.
- The shared `subcommand-args.ts` parser gained valueless `flagOptions` support
  (needed for `--allow-live-registry`).

Slice 4 consumes `ParsedSemgrepCandidatesArgs` (CLI sources arrive pre-collected
in argv order; the manifest path is unread — the command owns file IO) and
`evaluateRuleSources`, whose blocked decisions carry ready-made reason strings
for the unmet `semgrep rule source` prerequisite.

Tests first:

- permissive local source is allowed by default;
- AGPL source is blocked without `--allow-rule-license AGPL-3.0`;
- Semgrep Rules License source is blocked without
  `--allow-rule-license Semgrep-Rules-License-1.0`;
- registry source is blocked without `--allow-live-registry`;
- unknown license is blocked unless explicitly allowed;
- manifest parse errors are usage/config errors with exit 2.

### Slice 2 - Runner and JSON parser (done 2026-06-05)

Add:

- `scripts/drift-ai/semgrep-runner.ts`
- `scripts/drift-ai/semgrep-output.ts`
- `scripts/drift-ai/semgrep-types.ts`
- runner/parser fixtures under `scripts/drift-ai/fixtures/semgrep/`

As landed, four notes beyond that file list:

- Runner-facing types live in `scripts/drift-ai/semgrep-runner-types.ts`
  (mirroring the dolos-runner/dolos-runner-types split); the runner re-exports
  them. `tool-bin.ts` now exports its `toolsCheckoutBinPaths` ancestor walk so
  the runner could reuse it for the override -> tools-checkout -> PATH order
  without inheriting `resolveToolBin`'s target-repo probe (executing a binary
  out of an analyzed foreign repo is exactly what decision 2 avoids).
- Safety guard the plan did not spell out: with zero rule configs the runner
  refuses to spawn (`run-failed`) instead of letting Semgrep fall through to
  its own default/registry config resolution. Slice 4 gates upstream, so
  reaching this is a bug, but the failure mode had to be "no scan", not
  "scan with rules nobody declared".
- Malformed `results[]` rows are counted (`malformedResultCount`), not
  silently dropped — slice 3's partial-parse disclosure feeds from it. The
  parser also surfaces `skipped_rules` ids and a `paths.scanned` count for
  the same disclosure section.
- Parser fixtures: tests parse the slice-0 capture verbatim plus a new
  capture-shaped `fixtures/semgrep/scan-output.synthetic-rich.json` covering
  rich rule metadata (confidence/likelihood/impact/category/subcategory/
  cwe/owasp/references, scalar and list shapes), `errors[]`, and
  `skipped_rules`, which the real smoke rule could not produce.

Tests first with fake spawn:

- missing binary returns `tool-unavailable`;
- `--version` is parsed for engine provenance;
- scan command includes `scan`, `--json`, `--metrics=off`,
  `--disable-version-check`, `--oss-only`, all allowed `--config` values, and
  roots;
- roots pass through to Semgrep unfiltered: a `.go` file under a root reaches
  the scan command's targets (no `sourceExtensions` gating), and empty roots
  normalize to `.`;
- drift `ignore` config maps to repeated `--exclude` arguments, and no
  `.semgrepignore` or other file is written;
- findings JSON parses when `extra.lines` and `extra.fingerprint` are
  `"requires login"`;
- Semgrep `errors[]` are preserved as degradations;
- timeout returns a timeout result with a cap;
- invalid JSON and non-zero failure exits become degraded run results.

### Slice 3 - Advisory builder and formatter (done 2026-06-05)

Add:

- `scripts/drift-ai/semgrep-advisory.ts`
- `scripts/drift-ai/semgrep-advisory.test.ts`

As landed, five notes beyond that file list:

- The 300-line module ratchet forced a split mirroring the birth-size-delta
  trio: data shapes live in `semgrep-advisory-types.ts`, text/JSON rendering in
  `semgrep-advisory-format.ts`, and `semgrep-advisory.ts` keeps the builder and
  re-exports both, so consumers (slice 4, the args module) import one facade.
  `SEMGREP_CANDIDATES_SUBCOMMAND`/`DEFAULT_SEMGREP_CANDIDATES_TOP` moved here
  from `semgrep-candidates-args.ts`, as the slice 1 note anticipated.
- The builder takes `{ ruleSources: RuleSourceDecision[], run:
  SemgrepRunnerResult | null }`; `run: null` means slice 4 skipped the scan
  because no source survived the gate, and the `semgrep engine` prerequisite
  then renders unmet as "not probed" rather than claiming anything about the
  binary. Exit codes are command territory: the slice's "exits 0" assertions
  land with slice 4's `runPrototypeCommand` wiring.
- Decision 4 lists rule-source provenance as a group-row field; as landed it is
  hoisted to the SECTION (`ruleSources`, `engineVersion`, `scannedCount`)
  because one scan has one rule-source set — every row would carry identical
  provenance. Blocked sources beside allowed ones render as degradations; with
  nothing allowed their reasons live in the unmet prerequisite instead.
- Decision 4's optional scan-error section landed as degradations: per-error
  lines capped at 5 plus a remainder line, with `skipped_rules` and the
  malformed-result count as their own lines. The per-row range list is capped
  at 5 in text only; JSON keeps every range.
- Rule-declared enums (severity/confidence/likelihood/impact) render lowercase
  in TEXT so the advisory surface carries no shouty WARN/ERROR-style tokens;
  JSON keeps the verbatim Semgrep values as data.

Tests first:

- output envelope is `kind: "advisory"`, `lane: "prototype"`, no `findings`;
- missing binary renders an unmet prerequisite and exits 0;
- missing/blocked rule source renders an unmet prerequisite and exits 0;
- groups sort by confidence/severity/small group size;
- display cap renders `showing N of M candidates`;
- source provenance includes rule license and source kind;
- live-registry sources render `reproducible: false` provenance; pinned local
  sources with commit/sha256 do not;
- secret findings do not include snippets.

### Slice 4 - Command integration (done 2026-06-05)

As landed, four notes beyond the file lists below:

- `scripts/drift-ai/semgrep-candidates-command.test.ts` exists too (tests
  first), driving the command through fake git/inventory/runner seams; the
  dispatch-level envelope and bare-machine assertions live in
  `prototype-subcommands.test.ts` beside the dolos ones.
- Manifest IO semantics the plan left implicit: the manifest path resolves
  against the repo root, an unreadable manifest is a usage error (exit 2)
  like a malformed one, and manifest sources scan ahead of CLI sources, each
  mechanism keeping its own declaration order.
- `readme-config-parity.test.ts` needed no edit — it derives from the live
  subcommand list, so it enforced the README table, README index sentence,
  and `docs/prototype-subcommands.md` heading instead. The `runner.ts`
  subcommand comment also needed no edit (it does not enumerate prototype
  ids); `RunOptions` only gained the `semgrep` injection seam.
- Smoke behavior verified for real on this checkout: the bare invocation
  below exits 0 with both prerequisites unmet, and a real engine run over
  `scripts/drift-ai` with the slice-0 smoke rules reproduces the captured
  groups (namespaced ids, 1 + 3 hits) through the full command path.

Add:

- `scripts/drift-ai/semgrep-candidates-command.ts`
- optional `SemgrepRunner` injection in `PrototypeSubcommandOptions` and
  `RunOptions`
- `semgrep-candidates` registry entry

Update:

- `scripts/drift-ai/prototype-subcommands.ts`
- `scripts/drift-ai/prototype-subcommands.test.ts`
- `scripts/drift-ai/runner.ts` subcommand comment
- `scripts/drift-ai/README.md`
- `scripts/drift-ai/docs/prototype-subcommands.md`
- `scripts/drift-ai/harness-controls-parity.test.ts`
- `scripts/drift-ai/readme-config-parity.test.ts` if the README table changes
- `docs/agent_notes/backlog/drift-ai-next-items/00-index.md` — amend the
  domain/security-sensor non-goal so it cannot be read as forbidding this lane:

  > A generic external bug-pattern engine (e.g., Semgrep) running
  > operator-supplied or drift-owned generic rule packs may run in the
  > prototype advisory lane; domain/security rule packs remain excluded and
  > belong to the security & architecture-fitness backlog item.

Smoke behavior:

```sh
bun run drift:ai semgrep-candidates --root scripts/drift-ai
```

On a machine without Semgrep or rule sources, this should exit 0 with unmet
prerequisites, not fail.

### Slice 5 - Calibration run and follow-up decision (done 2026-06-06)

After implementation, run a real calibration with an operator-managed local rule
source, preferably a permissive MIT source first:

- `patched-codes/semgrep-rules`
- `AikidoSec/opengrep-rules`
- `elttam/semgrep-rules`

Record in `docs/agent_notes/finished_work/drift-ai-field-run-calibration.md`:

- exact command;
- repo/commit/date;
- Semgrep engine version;
- rule source, license, commit/hash;
- raw findings, groups, parse errors, timing;
- reviewed true/false/uncertain counts;
- recommendation: keep prototype, tune, add fingerprint store, add changed-scope,
  or consider permissive vendoring.

Calibration entries are comparable across runs only when every rule source is
pinned (commit and/or sha256). Live-registry runs may be recorded for
exploration but must be flagged non-comparable.

As run, results in the calibration note's
`2026-06-05 - semgrep-candidates first calibration` record:

- Rule source: `patched-codes/semgrep-rules` (MIT) bundled 269-rule aggregate,
  pinned commit + sha256 in a gitignored operator manifest at
  `.tools/semgrep/rules/manifest.json`; `reproducible: true` on every run.
- Targets: Musi (`packages` + `scripts`) plus the four field-test corpus repos
  (ma-toki, gastown, openclaw, BatonLoop). 3,651 raw findings in 1,191 groups
  over 11,691 scanned files; 96 reviewed (full review on the three small
  targets, stratified per-rule samples on gastown/openclaw): 0 true positives,
  86 false positives, 10 uncertain.
- Adapter mechanics (license gate, pinned provenance, caps, degradations,
  exit 0) and multi-language reach all behaved as designed; the noise is a
  property of generic third-party packs, not the adapter.
- Slice-0 open question settled: Semgrep's default target filters and
  target-supplied `.semgrepignore` files (openclaw ships one) both shape
  coverage silently — decision is to disclose both; corrected post-review on
  2026-06-05 (`scan scope:` section fact plus `scanScope` JSON data, and target
  `.semgrepignore` files as a `degraded:` line; both only when a completed scan
  backs the section).
- Recommendation: keep opt-in; pursue the first-party `ai-footguns` pack next;
  fingerprint/verdict store is now motivated by re-noise over already-triaged
  `//nolint:gosec` sites; no vendoring.
- Second review pass (2026-06-06): local rule configs are existence-gated
  before the scan (a missing path is a blocked source / unmet prerequisite per
  the documented contract, instead of `rule source: ok` plus a late run
  failure); registry packs must keep the `p/<pack>` shape end to end so
  `auto`/`r/...`/URLs/local paths cannot ride the registry-pack label; the
  target `.semgrepignore` probe runs only behind a completed scan and skips
  scan-excluded directories plus `.tools/` (a vendored engine venv must never
  read as target scan shaping); the runner timeout-message fallback checks the
  configured SIGKILL kill signal (it could never fire against SIGTERM); and
  the advisory (check_id, path) group key joins on NUL. Verified against the
  pinned engine: the semgrep==1.165.0 wheel ships no `.semgrepignore`
  template, so the venv false-disclosure scenario was latent, not live.
- Third review pass (2026-06-06): curated known-pack licenses now always win
  over a manifest-declared license, and a manifest that relabels a known pack
  (e.g. `p/default` as MIT) is rejected as a manifest defect — previously the
  relabel classified as permissive and `--allow-live-registry` alone ran the
  pack, skipping the `--allow-rule-license` consent the table exists to force.
  Nothing legitimate is lost: consent for a known restricted pack goes through
  `operatorAcceptedLicense` or `--allow-rule-license`. The target
  `.semgrepignore` probe is also scoped to the scan roots (plus the repo root
  and each root's ancestor directories): a nested `.semgrepignore` governs
  only its own subtree, so with `--root src` an unrelated `docs/.semgrepignore`
  no longer over-discloses as target scan shaping. And rendered rule messages
  are withheld from default output behind `--include-rule-messages` (see the
  decision 5 amendment): metavariable interpolation can put matched source,
  including secrets, into `extra.message`, which broke the "safe to hand off"
  claim even with `extra.lines` unread.

## Deferred follow-ups

- A first-party `ai-footguns` rule pack: 5-8 tested TS/Go rules for empty
  `catch` blocks, ignored Go `err` returns, stubbed-success handlers,
  placeholder/mock residue on production paths, and simple hardcoded-secret
  heuristics, each with `semgrep --test` fixtures. First-party authorship
  sidesteps the third-party license gate entirely and tests the
  AI-codegen-footgun hypothesis more directly than generic security packs.
  Slice 5 confirmed this is the successor leaf: the generic MIT pack produced
  0 true positives in 3,651 findings, dominated by capability-flagging rules.
  - EVALUATED AND DEFERRED (lint-followups-2026-06 Leaf 10, 2026-06-12): 0
    rules landed. The empty-`catch`, artifact-residue, and dropped-async
    classes are already enforced at ESLint `error` (a semgrep rule would be
    redundant and coarser); the Go-`err` and multi-language classes do not
    apply (Musi is TS-only, 0 Go files); conflict-marker/stubbed-success/
    hardcoded-secret classes lacked a citable in-repo incident. Not a lane
    retirement — the opt-in lane stays. Revisit when a named footgun appears
    in a class ESLint cannot express, or Musi gains a non-TS surface. Summary:
    `docs/agent_notes/finished_work/lint-followups-2026-06.md`; the original
    verdict lives only in git history.
- A lighter prepared-run path for `semgrep-candidates`: the command reuses
  `prepareCurrentRun` for config loading and root validation, but that helper
  also builds the full current-file inventory (`git ls-files` + per-file
  stat + by-dir index) that this subcommand never reads — Semgrep does its own
  file discovery per decision 7. Extract a config+roots-only prep helper if
  prototype-lane startup cost on large targets starts to matter.
- Self-computed finding fingerprints and verdict store. Slice 5 added field
  evidence: gastown re-raises sites its own gosec lane already triaged via
  `//nolint:gosec`, which a verdict store would absorb.
- `--baseline-commit` changed-scope lane.
- A rule refresh/cache command for operator-managed local rule sources.
- Optional Opengrep engine support if fingerprints or free taint analysis become
  important.
- Config-file integration after the CLI/manifest workflow proves recurring value.
- Optional vendoring of a small permissive ruleset with full license notices, if a
  human explicitly approves the maintenance and attribution burden.
- A documented minimum Semgrep version, only once calibration exposes a real
  feature dependency.

## Source references

- Semgrep drift-sensor research:
  `docs/agent_notes/backlog/semgrep-drift-sensor-research.md`
- Semgrep Rules License:
  `https://semgrep.dev/legal/rules-license/`
- Semgrep CLI exit-code and local-scan behavior:
  `https://semgrep.dev/docs/getting-started/cli`
  `https://semgrep.dev/docs/cli-reference`
- AGPLv3 text:
  `https://www.gnu.org/licenses/agpl-3.0.en.html`
- Permissive rule candidates:
  `https://github.com/AikidoSec/opengrep-rules`
  `https://github.com/patched-codes/semgrep-rules`
  `https://github.com/elttam/semgrep-rules`
- AGPL rule source to keep opt-in:
  `https://github.com/trailofbits/semgrep-rules`
