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
evidence. A parked tuning note lives at
`docs/agent_notes/backlog/drift-ai-ghost-files-agent-noun-pairs.md`.

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
