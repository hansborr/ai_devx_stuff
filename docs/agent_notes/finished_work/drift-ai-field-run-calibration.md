# drift:ai field-run calibration cadence

Date: 2026-06-05
Task: `docs/agent_notes/backlog/drift-ai-next-items/55-field-run-calibration-cadence.md`

This note is the repeatable calibration record template for `drift:ai` checks,
plus the first focused Musi baseline. Use it when a check is tuned, a prototype
lens is considered for promotion, a default-on decision is proposed, or field
noise needs to be distinguished from useful evidence.

## Cadence

Create or append a calibration record before:

- promoting an advisory/prototype lens to a check;
- making an opt-in check default-on;
- demoting, disabling, or materially weakening a default-on check;
- changing thresholds or suppression heuristics after a field report;
- relying on `drift:ai` evidence in a scheduled slow-drift lane.

Focused roots are acceptable and usually better than a slow whole-repo sweep when
the question is about one detector. Do not use a slow adapter such as knip as the
only proof unless the decision is specifically about that adapter. Record timing
from `checkTimings` when available; otherwise record wall-clock cost or a
qualitative cost note.

## Record template

```md
## YYYY-MM-DD - <repo/scope/check purpose>

- Command: `<exact command>`
- Repo and commit: `<repo path or name>`, `<commit sha>`, worktree state if relevant
- Date: `<UTC timestamp or date>`
- Config source: `<config path, generated config, or no config>`
- Scope: `<changed/current>`, base/ref if changed scope
- Roots: `<roots or config roots>`
- Checks: `<check ids>`
- Scope size: `<scopeCount or file count if known>`

### Raw result

| Check | Findings | Skips | Timing |
| --- | ---: | --- | ---: |
| `<check>` | `<count>` | `<skip reason or none>` | `<duration>` |

### Manual review

- Sample: `<all findings or sampling method>`
- True positives: `<count>`
- False positives: `<count>`
- Uncertain: `<count>`
- Top false-positive classes: `<short taxonomy with example paths>`

### Recommendation

`keep opt-in` / `keep default-on` / `tune` / `promote` / `demote` /
`split follow-up`: `<reason and linked follow-up, if any>`
```

## 2026-06-05 - Musi current-scope drift-ai focused baseline

- Command: `bun run drift:ai --scope current --root scripts/drift-ai --check duplicates --check ghost-files --check comments --format json`
- Repo and commit: `/workspace`, `631a60d2fbf71166755d9804fd2ac4fba9842cca` on branch `feat/drift-ai-next-items-pack-review`; worktree clean before the docs edits
- Date: `2026-06-05T02:41:16Z`
- Config source: auto-loaded `drift-ai.config.json`
- Scope: `current`
- Roots: `scripts/drift-ai`
- Checks: `duplicates`, `ghost-files`, `comments`
- Scope size: 316 files

### Raw result

| Check | Findings | Skips | Timing |
| --- | ---: | --- | ---: |
| `duplicates` | 0 | none | 1262ms |
| `ghost-files` | 1 | none | 215ms |
| `comments` | 0 | none | 1ms |

Total reported timing: 1478ms.

Finding:

- `ghost-files`: `scripts/drift-ai/env-define-evaluation.ts` <->
  `scripts/drift-ai/env-define-evaluator.ts`; message classified the pair as
  `near-edit-distance` with shared tokens `env`, `define`.

### Manual review

- Sample: all findings.
- True positives: 0.
- False positives: 1.
- Uncertain: 0.
- Top false-positive class: intentional public-entrypoint/internal-worker split
  where sibling basenames differ by a noun/agent suffix (`evaluation` vs
  `evaluator`). Task 43a already records the split: `env-define-evaluation.ts`
  owns deterministic expression evaluation, while `env-define-evaluator.ts` is
  the public helper entrypoint that collects env/define evidence over sources.

### Recommendation

`tune`: keep `ghost-files` report-only/default-on behavior unchanged from this
single focused run, but track the noun/agent role-pair class as follow-up
evidence. The parked tuning note
(`drift-ai-ghost-files-agent-noun-pairs.md`) closed Done —
`currentAllowedPairs` covers the pair — and was removed at the 2026-07-19
triage (git history).

## 2026-06-05 - semgrep-candidates first calibration (Musi + 4-repo corpus, generic MIT pack)

Slice 5 of `docs/agent_notes/backlog/semgrep-drift-ai-implementation-plan.md`:
first real calibration of the `semgrep-candidates` prototype subcommand with a
pinned permissive rule source, against Musi and the four field-test corpus
repos. All five runs exited 0 with both prerequisites satisfied.

- Command (Musi):
  `bun run drift:ai semgrep-candidates --root packages --root scripts --rule-source-manifest .tools/semgrep/rules/manifest.json --top 500 --format json --output /tmp/calib-musi.json`
- Command (corpus, from each target root):
  `bun /workspace/scripts/drift-ai.ts semgrep-candidates --root . --rule-source-manifest /workspace/.tools/semgrep/rules/manifest.json --top 500 --format json --output /tmp/calib-<repo>.json`
  (openclaw re-run with `--top 2000` to clear the display cap: 825 groups > 500)
- Date: `2026-06-06T00:26Z` (runs started 2026-06-05 local)
- Engine: semgrep `1.165.0`, tools-checkout venv
  `.tools/semgrep/.venv/bin/semgrep`, logged out, `--oss-only`
- Rule source: `patched-codes/semgrep-rules` bundled aggregate
  `patched-codes-semgrep-rules.yml` (269 rules, multi-language), license MIT,
  pinned local clone at commit `1118d79823ae756534678378a4aac0cbfa5d3041`,
  sha256 `40ab4181f092667be7af4f9c0f52a2f18a19242391d365cb1201d4dcba33b098` —
  `reproducible: true` provenance on every run; comparable across runs.
- Scope: `current` on every run.
- Config source: Musi auto-loaded `drift-ai.config.json` (ignore prefixes
  `docs/`, `packages/server/prisma/migrations/` mapped to `--exclude`); the
  four corpus repos had no drift config.

### Raw result

| Repo (commit, clean) | Scanned | Groups | Raw findings | Wall | Scan-error degradations |
| --- | ---: | ---: | ---: | ---: | ---: |
| Musi `b7987d2a` | 1901 | 19 | 22 | 14.1s | 4 |
| ma-toki `27643fcb` | 130 | 4 | 4 | 4.6s | 0 |
| gastown `e7949128` | 656 | 341 | 712 | 10.9s | 0 |
| openclaw `4fae13e2` | 8991 | 825 | 2911 | 75.3s | 34 |
| BatonLoop `94d0f675` | 13 | 2 | 2 | 3.7s | 0 |

Totals: 3,651 raw findings in 1,191 groups over 11,691 scanned files.

Rule mix: dominated everywhere by capability-flagging audit rules —
`non-literal-fs-filename` (665 groups, openclaw alone 663),
`non-literal-regexp` (140), gosec-style Go file-permission/fileread/subproc
(322, gastown), `possible-timing-attacks` (38), `concat-sqli` (13). All
degradations were Semgrep syntax errors (TSX generics/JSX-entity quirks in
Musi and openclaw; openclaw also 29 more under the 5-line text cap, all
preserved in JSON).

### Manual review

- Sample: all findings for Musi (22), ma-toki (4), BatonLoop (2); stratified
  per-rule samples for gastown (42 of 712: all 19 `concat-sqli` lines, all
  singleton/small classes, 4 each of the four bulk Go classes) and openclaw
  (26 of 2911: 6 pathtraversal, 4 regexp, 4 timing, all 6 `non-literal-require`,
  all singletons, both Go classes). 96 findings reviewed.
- True positives: 0.
- False positives: 86.
- Uncertain: 10 — gastown's 9 SQL identifier-interpolation sites
  (`fmt.Sprintf("USE \`%s\`", dbName)`-style; identifiers cannot be
  parameterized in MySQL, exploitability needs hostile local DB names in a
  single-operator tool) and openclaw's `shell=True` in an agent skill script.
- Top false-positive classes:
  1. Capability-not-vulnerability: non-literal fs/regexp/require/subproc and
     0644/0755 perms flagged in tools whose purpose is file IO, process
     orchestration, or pattern compilation (drift-ai scripts, gastown
     orchestrator, openclaw gateway, e2e helpers). ~85% of raw volume.
  2. Name-heuristic timing rules: `hash === null`, `token === undefined`,
     `apiKey !== undefined` presence checks (all 38 timing groups sampled
     across Musi/openclaw were this).
  3. Rule-precision bugs: `concat-sqli` matched literal queries
     (`"SELECT 1"`, `"SHOW DATABASES"`) and non-SQL `*.Exec` APIs
     (`syscall.Exec`, an internal process wrapper).
  4. Already-triaged re-noise: gastown carries `//nolint:gosec` justifications
     on the exact sites the Go rules re-flagged; Semgrep cannot see
     gosec-lane triage.
  5. Mitigated sinks: ma-toki's two `dangerouslySetInnerHTML` rows sit behind
     `escapeHtml` + DOMPurify (verified in `renderMarkdown`).

Calibration-campaign observations beyond the counts:

- Multi-language reach worked as designed (decision 7): Go rules fired in
  gastown, Python in BatonLoop and openclaw, JS/TS everywhere — no extension
  gating losses.
- Adapter mechanics all behaved: license gate, pinned provenance,
  `--top` cap with `showing N of M`, JSON keeping full ranges, scan-error
  degradations capped in text but complete in JSON, exit 0 throughout.
- Target-side coverage shaping is real and currently silent: Semgrep honors
  the target repo's own `.semgrepignore` (openclaw ships one excluding all
  test/fixture/QA paths — it runs its own opengrep CI lane) and applies its own
  default target filters, including target `.gitignore` handling. Decision from
  the slice-0 open question: both belong in disclosure; see recommendation.

### Recommendation

`keep opt-in` (prototype lane), and redirect rule investment: 3,651 raw
findings, 0 confirmed true positives. The adapter is sound — every failure
mode here is a property of generic third-party security packs, not of the
runner/builder/gate. Follow-ups, in order of expected value:

1. First-party `ai-footguns` pack (already in the plan's deferred list): the
   corpus noise profile confirms generic packs cannot test the
   AI-codegen-footgun hypothesis; targeted first-party rules with `semgrep
   --test` fixtures can.
2. Disclose target-side coverage shaping: render a static scope disclosure for
   Semgrep's default target filters and when target `.semgrepignore` files
   exist. Small adapter change, now backed by field evidence.
3. Fingerprint/verdict store stays deferred but is now motivated by the
   re-noise class (4) above: without it, every run re-raises triaged sites.
4. No permissive vendoring yet — nothing in this pack earned vendoring.

Raw JSON captures parked at `/tmp/calib-{musi,ma-toki,gastown,openclaw,BatonLoop}.json`
(per-machine, not committed); operator manifest at
`.tools/semgrep/rules/manifest.json` (gitignored).

## 2026-07-20 - C3 jscpd repeated-block calibration

- Command: locked `jscpd@4.2.3` matrix over `scripts/drift-ai/fixtures/near-duplicates-v2`, then the same profiles over `scripts` and `eslint-rules`; selected-tree confirmation used `bun run drift:ai --scope current --check duplicates --format json --output /tmp/c3-duplicates-selected.json`.
- Repo and commit: `/home/node/lanes/lane-pkg`, v1 base `341505fc3722f3375698689c190cb190c4b077f4`; advisory implementation was uncommitted during calibration.
- Scope: current tree, 2,368 inventory files across the five configured roots.
- Matrix: `minLines` 8/10/12, `minTokens` 45/50/60, modes `mild`/`weak`; no percentage `--threshold`.

The required same-file eight-statement fixture was found only at the 8-line
floor; every 8-line matrix point found all three fixture clone rows. On the
scripts/eslint-rules sample, the least noisy accepting point was 8/60/mild at
63 rows in 4.949 s (8/45/mild produced 119). The first selected whole-root raw
pass produced 118 rows in 9.039 s; after production/test/generated ignores were
applied through the check, the portable drift command produced 91 rows in
9.076 s before the final `test/**` exclusion.

Manual review used the first 40 deterministic rows plus every shared and ESLint
row. Most rows were concrete duplicated validation, mutation, dialog, or shell
orchestration blocks; generated Prisma and JavaScript test/config rows were the
clear noise classes and are now excluded. Short imports and the fixture's short
configuration table were absent. Recommendation: one whole-root 8/60/mild
profile, report-only. Multiple-profile infrastructure and an AST statement
window detector are not justified by this calibration.

## 2026-07-20 - C3 exact-tier retain-the-slot decision

- Reproducible command: `bun scripts/benchmark-near-duplicates.ts --samples 5`
  (also exposed as `bun run sensor:near-duplicates:benchmark -- --samples 5`).
- Sampler: benchmark worker plus recursive descendants from `ps pid,ppid,rss`,
  polled every 25 ms; raw RSS is KiB. Each state receives five fresh-process
  samples followed by five immediate-repeat samples.
- Host/tree: `/home/node/lanes/lane-pkg`, optimized implementation commit
  `7b699ddc`; fuzzy-only and fuzzy+exact are exercised at the same HEAD.

| State | Fresh wall seconds | Fresh peak KiB | Repeat wall seconds | Repeat peak KiB |
| --- | --- | --- | --- | --- |
| fuzzy-only | 1.308, 1.506, 1.679, 1.465, 1.602 | 369012, 364148, 361860, 356580, 362852 | 2.687, 2.120, 2.270, 2.449, 2.282 | 355152, 358864, 367888, 366896, 359236 |
| scoped single-walk fuzzy+exact | 2.361, 2.361, 2.586, 1.882, 1.818 | 440168, 433740, 448976, 421628, 447512 | 1.875, 1.904, 1.848, 1.951, 1.838 | 451452, 437836, 437780, 449404, 450180 |

Optimization changed the evidence. Exact token allocation is now file-gated
before extraction and limited to the production `scripts/` and `eslint-rules/`
scope; 4,203 of 6,864 discovered functions were tokenized, and 4,156 cleared
the exact token floor. Terminals are collected in one source walk, each
terminal encoding is allocated once even when nested functions are active, and
each canonical sequence is encoded once for both hashing and collision-safe
grouping. Signature tokens now include defaults, async/generator syntax, type
parameters, parameters, and return syntax while omitting only the compared
function's own name.

The warm exact median was 1.875 s versus fuzzy-only 2.282 s: -0.407 s
(-17.85%), so it passes both incremental time limits and the 15 s total limit.
Warm median peak RSS increased by 90,168 KiB (359,236 to 449,404); maximum exact
peak was 451,452 KiB. The exact audit had 4,001 hash buckets, maximum raw/full
equality group 18, and 535 projected/post-overlap pairs, so the 100/50,000 caps
also pass.

Decision: retain report-only because the baseline-growth limb still fails.
The union contains 535 identities absent from the fuzzy baseline. Enforcement
requires reviewing and admitting or repairing every newly exposed identity one
at a time; bulk-grandfathering that initial corpus would violate the admission
contract. The existing fuzzy sensor therefore continues to disable exact-token
allocation and remains the single enforced slot. The legacy-header migration,
count-admission identifier, merge-policy change, and baseline metadata remain
conditional on a future corpus reduction that makes individual review
tractable; the blocking leaf stays open.
