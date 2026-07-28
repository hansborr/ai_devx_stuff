# Semgrep as a generic drift sensor — research

Status: research · shipped — the semgrep drift-sensor prototype landed in
`59db58a8` (`feat(drift-ai): add semgrep prototype advisory builder and
formatter`); see `scripts/drift-ai/semgrep-*.ts` and
`semgrep-drift-ai-implementation-plan.md`
Date: 2026-06-05 · semgrep CE 1.165.0, logged out, `--metrics=off`
Branch: `feat/semgrep`

The question: can off-the-shelf semgrep serve as a **generic** drift sensor —
general bugs, security issues, sloppy code, AI-generated problems — across Musi
*and* arbitrary other repos (including other people's AI-generated codebases),
with an AI doing the triage so noise is acceptable? Explicitly **not** the
question: writing Musi-specific semgrep rules.

Everything below splits into web-verified facts (URLs in [Sources](#sources))
and **field runs executed today** against five local repos. Numbers without a
citation were measured locally.

## TL;DR

Yes, with a specific shape:

- **Engine:** Semgrep Community Edition (CE), installed via pip/pipx, logged
  out. The engine is LGPL; scanning your own repos with registry rules is
  explicitly permitted by the rules license. Cross-file taint and ~50–70% of
  *cross-file* vuln recall are paywalled, but single-file pattern rules — the
  bulk of the "sloppy/AI-slop" signal — run fully in CE.
- **Rules:** a fixed battery of registry packs (`p/default`,
  `p/security-audit`, `p/secrets`, `p/r2c-best-practices`, `p/trailofbits`,
  plus per-language packs). Vendor pinned snapshots of the pack YAML for
  reproducibility — packs are mutable server-side.
- **Mode:** report-only JSON, whole-tree for the first calibration sweep,
  `--baseline-commit <merge-base>` for the recurring changed-scope lane.
- **Triage:** group findings by `(rule, file)` before handing to AI. Measured:
  a 428-finding Go repo collapses to 22 distinct rules / 194 groups; one
  glance at a rule-group routinely kills a dozen findings.
- **Caveat that matters most:** logged-out CE **redacts the per-finding
  `fingerprint` and matched `lines`** in JSON output. Dedup across runs needs a
  self-computed key. The Opengrep fork un-gates exactly this (plus
  cross-function taint) if it ever becomes the bottleneck.
- **It will not find much on a disciplined codebase.** Musi produced 27
  findings from 1,058 default-pack rules, all audit-class. The value shows on
  unfamiliar/AI-generated corpora: gastown (Go) produced 428 findings in 31
  seconds, and on openclaw the battery surfaced **genuine GitHub Actions
  shell-injection instances** (HIGH-confidence rule, spot-verified) among 898
  rows — a class nothing else in the current tool stack looks for.

## 1. Framing: what "drift sensor" means here

Same posture as `drift:ai`: **report-only evidence for an AI/human reviewer,
never a gate.** The drift:ai brainstorm's two-lane model applies cleanly:

- Semgrep is a **prototype/heavy-lane** citizen: external tool, noisy is fine,
  the hard requirement is **provenance** (engine version, pack identity, rule
  id, severity/confidence metadata, file ranges). Semgrep's JSON output
  carries all of that natively — see §5.
- It is *not* a default-lane candidate today: registry packs mutate
  server-side, the tool needs a Python runtime, and untuned output on a messy
  repo is hundreds of rows.

Semgrep complements rather than overlaps drift:ai's existing checks: drift:ai
covers duplication/structure/history archaeology; semgrep covers
**security-pattern and correctness-pattern** classes (injection sinks, bad
crypto, dangerous exec, footgun APIs, hardcoded secrets, concurrency
patterns) that none of the existing checks attempt.

## 2. Product and licensing landscape (June 2026)

Facts that bear on "use it across many projects, indefinitely, for free":

- **Engine:** LGPL 2.1, open source. "Semgrep OSS" was renamed **Semgrep
  Community Edition (CE)** in Dec 2024.
- **Registry rules:** moved to the **Semgrep Rules License v1.0**
  (Dec 13, 2024). It permits "internal business purposes" — individuals and
  companies scanning **their own code are explicitly unaffected**. What it
  prohibits: redistributing the rules or offering them as part of a competing
  service. Practical consequence for us: vendoring pack snapshots for private
  use is fine; publishing a curated rules mirror is not.
- **Paywalled (Pro/login):** cross-file + cross-function taint analysis,
  ~1,500 Pro rules, secrets *validation*, the AppSec platform, **and — less
  obviously — some JSON output fields in logged-out CE** (see §5). Free tier
  of the platform covers 10 contributors / 10 private repos if login ever
  becomes worth it.
- **CE vs Pro recall:** Doyensec measured CE finding 44–48% of true positives
  vs Pro's 72–75% on deliberately vulnerable apps (WebGoat, Juice Shop) — but
  **false positive counts were essentially identical**. Pro's advantage is
  recall on *cross-file* flows, not precision. Single-file pattern rules are
  unaffected, and those carry most of the drift-sensor signal.
- **Opengrep:** the Jan 2025 fork (Aikido, Endor Labs, Jit, Legit, Orca, +6
  more vendors; full-time OCaml team). One year in: ~weekly releases,
  restored-for-free **cross-function taint** (`--taint-intrafile`) and
  **finding fingerprints**, no telemetry, static binaries, claims 25–74%
  faster scans. Rule-format/JSON/SARIF compatible. The catch: **no hosted
  registry** — its fork of the rules repo was archived Nov 2025; you assemble
  rules yourself (e.g. `AikidoSec/opengrep-rules`, MIT). Verdict: stronger
  free *engine*, weaker turnkey *rules story*. Start with CE; revisit if
  fingerprint dedup or taint recall becomes a real need.
- **CodeQL is not a competitor here:** license forbids scanning private
  non-OSS code without paying (~$30/committer/month as of 2025).

## 3. Ruleset menu (verified counts, fetched 2026-06-05, logged out)

Pack YAML is directly fetchable: `curl https://semgrep.dev/c/p/<pack>`. Counts
are what a logged-out client receives — login serves more "Community" rules
(e.g. `p/default` advertises itself as larger when authenticated).

| Pack | Rules | What it is | Field-run behavior |
| --- | ---: | --- | --- |
| `p/default` | 1,058 | curated high-confidence security+correctness, all languages | quiet on clean code; the baseline pack |
| `p/owasp-top-ten` | 543 | OWASP-mapped security | 0 findings on Musi |
| `p/security-audit` | 225 | broader "audit points", lower confidence by design | 0 on Musi; the bulk of gastown's pile |
| `p/cwe-top-25` | 215 | CWE-mapped | 0 on Musi |
| `p/r2c-best-practices` | 125 | correctness/best-practice | 22 on Musi, all one rule (`no-replaceall`, Bun-irrelevant browser-compat) |
| `p/trailofbits` | 120 | Trail of Bits' audit rules (note: repo is AGPLv3) | high-signal classes: Go mutex misuse, Rust `panic!`-in-`Result`, generic transport checks |
| `p/typescript` | 74 | TS language rules | 0 on Musi |
| `p/secrets` | 51 | hardcoded-credential regexes (validation is Pro) | FP-prone by nature; 1 FP on ma-toki (TOTP test fixture) |
| `p/nodejs` | 36 | Node rules | 0 on Musi |
| `p/ai-best-practices` | 27 | **agent-infra risks**: MCP command injection/SSRF/tool poisoning, Claude Code hook footguns, `bypassPermissions` in settings, hidden unicode in AI config, unbounded agent loops | 7 on Musi's own `.claude/hooks` + `scripts/ai-hooks` — all contextual FPs but reasonable audit flags |
| `p/react` | 4 | (tiny logged out) | 0 on Musi |
| `p/python`, `p/golang`, `p/rust` | — | language packs used in the cross-repo battery | see §4 |

Notes:

- **`p/llm-security` does not exist** (404), despite third-party sites citing
  it. `p/ai-best-practices` is the real registry pack in this space. Be
  suspicious of pack names from blog posts; verify with a `curl` probe.
- `p/ai-best-practices` targets **codebases that embed AI/agents** (MCP
  servers, hooks, LLM API calls) — it is *not* "rules that catch AI-written
  bugs". No registry pack specifically targets AI-authorship patterns;
  the closest general proxies are the correctness/security packs above plus
  drift:ai's own duplication/ghost-file checks.
- **Hallucinated dependencies (slopsquatting) are out of scope for semgrep** —
  that is a registry/lockfile verification problem, not a code-pattern
  problem. Treat as a separate potential check.
- Third-party collections worth knowing: `trailofbits/semgrep-rules` (AGPLv3,
  also a registry pack), `0xdea/semgrep-rules` (C/C++ vuln research),
  `dgryski/semgrep-go`, GitLab's SAST rules, and the aggregator
  `iosifache/semgrep-rules-manager` (~4,000 rules from 14 sources).
- "Ran N rules" in output is the pack filtered to languages present in the
  repo — e.g. Musi runs 265 of `p/default`'s 1,058.

## 4. Field runs

Setup: `python3 -m venv && pip install semgrep` (1.165.0), logged out,
`--metrics=off`, container with 4 usable cores. All runs JSON-output.

### 4.1 Musi (~1,990 TS files, 2,644 scanned files)

| Pack | Rules ran | Time | Findings |
| --- | ---: | ---: | ---: |
| `p/default` | 265 | 33s | 27 |
| `p/security-audit` | 31 | 11s | 0 |
| `p/secrets` | 42 | 3s | 0 |
| `p/owasp-top-ten` | 105 | 15s | 0 |
| `p/cwe-top-25` | 47 | 16s | 0 |
| `p/r2c-best-practices` | 8 | 10s | 22 |
| `p/typescript` | 74 | 20s | 0 |
| `p/react` | 4 | 3s | 0 |
| `p/nodejs` | 36 | 14s | 0 |
| `p/trailofbits` | 50 | 3s | 19 |
| `p/ai-best-practices` | 12 | ~5s | 7 |

Whole battery: **under 2.5 minutes.** The 75 findings decompose into:

- 21× `detect-non-literal-regexp`, 2× `detect-replaceall-sanitization`
  (audit-class, all in scripts/lint tooling), 4× bash `ifs-tampering`;
- 22× `no-replaceall` — browser-compat rule, irrelevant under Bun; one
  `semgrepignore`/rule-exclusion kills the whole class;
- 19× trailofbits: `redis://` URLs in `.env.example`/compose (9), compose
  ports binding all interfaces (9), one CORS audit — local-dev noise;
- 7× ai-best-practices on the agent harness itself: `hooks-unconditional-allow`
  on a deliberate allow helper, `hooks-dns-exfiltration` on the firewall
  script's fixed-domain `dig` loop, etc. Wrong in context, but exactly the
  lines a security reviewer would want to glance at once.

Reading: **a disciplined, heavily-linted codebase is near-silent.** That is
the correct baseline behavior for a drift sensor — the absence of findings is
itself calibration evidence, and anything that *does* appear in a changed-scope
run is worth the look.

### 4.2 Cross-repo battery (foreign corpora in `/home/node/tmp`)

One combined invocation per repo: `p/default + p/security-audit + p/secrets +
p/r2c-best-practices + p/trailofbits` + language packs.

| Repo | Profile | Rules ran | Files | Time | Findings | Distinct rules | (rule,file) groups |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| BatonLoop | 21-file Python | 424 | 18 | 3s | 3 | 2 | 3 |
| gastown | Go agent-orchestration (~1,180 .go) | 761 | 944 | 31s | 428 | 22 | 194 |
| ma-toki | Rust+TS+shell mixed | 670 | 610 | 15s | 66 | 11 | 23 |
| openclaw | TS monorepo (15,507 .ts) | 784 | 11,857 | 319s | 898 | 34 | 511 |

gastown's 428 decompose (top classes, with rule confidence metadata):

| n | conf | rule | read |
| ---: | --- | --- | --- |
| 195 | — | `incorrect-default-permission` (0644/0755 file modes) | posture signal in aggregate, noise per-row |
| 74 | LOW | `string-formatted-query` | needs triage — real if any user input reaches them |
| 68 | LOW | `dangerous-exec-command` | expected for an agent tool that shells out; each is an audit point |
| 27 | LOW | `gosql-sqli` | same family as string-formatted-query |
| 13 | MED | trailofbits `missing-runlock-on-rwmutex` | **spot-checked: all 13 are FPs** — rule misfires on plain `mu.Lock()/mu.Unlock()` write sections; all in one file, killed in one glance |
| 3 | HIGH | `go-unsafe-deserialization-interface` | the "read these first" rows |

ma-toki's 66: 17× `ws://` websocket (likely localhost), 15× compose
port-binding, 12× `redis://` transport, 11× trailofbits
`panic-in-function-returning-result` (HIGH conf — genuinely useful Rust
code-quality class), 1× `detected-generic-secret` — **spot-checked: FP**, a
base32 TOTP fixture inside a `#[test]`.

openclaw's 898 (the AI-generated-monorepo profile this research targets):

| n | conf | rule | read |
| ---: | --- | --- | --- |
| 384 | — | `no-replaceall` | one exclusion kills 43% of the pile |
| 167 | LOW | `detect-insecure-websocket` (`ws://`) | mostly local/test endpoints; triage by group |
| 111 | LOW | `detect-non-literal-regexp` | audit-class |
| 47 | LOW | `prototype-pollution-loop` | worth a real pass on a JS codebase that merges objects |
| 35 | — | leftover debugging (`confirm`/`prompt`) | classic slop signal |
| 27 | LOW | `spawn-shell-true` | agent tool, expected — but each is an audit point |
| 13 | — | `useless-eqeq` | correctness slop |
| 6 | **HIGH** | `run-shell-injection` (GitHub Actions) | **spot-checked 2 of 6: genuine instances** of `${{ inputs.* }}` interpolated into `run:` shell — the canonical Actions injection pattern; exploitability depends on trigger surface, but exactly what a reviewer should see |

Observations:

- **Speed scales fine for a periodic lane**: ~700-rule batteries finish in
  seconds-to-half-a-minute on thousand-file repos; the 15.5k-file openclaw
  monorepo took 5.3 minutes for the full battery (and 6s in diff-aware mode
  would be the recurring cost, not 5 minutes).
- **Findings cluster hard.** gastown: 428 findings → 22 rules → 194
  (rule,file) groups. openclaw: 898 → 34 rules → 511 groups, where a single
  rule exclusion (`no-replaceall`) removes 43% of rows. AI triage at the
  group level is tens of judgment calls per repo, not hundreds.
- **Severity/confidence metadata is honest.** The LOW-confidence rules
  produced the piles; the HIGH-confidence rows were few and worth reading —
  on openclaw the only HIGH-confidence class (Actions shell injection) was
  the one that spot-checked as *real*, while two scary-looking
  LOW/MEDIUM-class groups (gastown rwmutex, ma-toki secret) spot-checked as
  FPs. Sorting groups by confidence is the right first cut; dropping LOW
  entirely would cost the posture signals.
- **Parse errors are per-file and non-fatal**: 12 on gastown, 8 on ma-toki,
  126 on openclaw — nearly all partial-parses of bash (Experimental-tier
  language) and bash embedded in YAML workflows, plus a couple of per-rule
  timeouts. The scan continues; errors are enumerated in JSON. A drift
  adapter should disclose them, not fail on them.

### 4.3 Diff-aware mode (the recurring-lane mechanic)

Verified on Musi: `--baseline-commit $(git rev-parse HEAD~50)` (224 changed
files) → **6 seconds**, scanned only changed files, and skipped the baseline
re-scan entirely when all current findings were in files that didn't exist at
the baseline. Caveats from docs, consistent with observed behavior: requires
git ≥ 2.30 (uses `git diff --merge-base`), a clean-enough tree, and a
non-shallow clone; CI should compute the merge-base rather than passing
`main`.

## 5. Mechanics for an AI-triage pipeline

### JSON contract

`--json` emits per finding: `check_id`, `path`, `start/end` (line/col/offset),
`extra.severity` (INFO/WARNING/ERROR), `extra.message`, `extra.fix` when the
rule has one, and `extra.metadata` with **`confidence`
(LOW/MEDIUM/HIGH), `likelihood`, `impact`, `category`,
`subcategory` (`audit` vs `vuln`), `cwe[]`, `owasp[]`, `references[]`,
`source` URL** — i.e. the triage-ranking features arrive pre-attached. SARIF
is also available; JSON is the richer surface.

**The logged-out gotcha (verified locally):** `extra.fingerprint` and
`extra.lines` are the literal string `"requires login"` in CE without auth.
Consequences:

- Stable cross-run dedup needs a self-computed key. Recipe:
  `hash(check_id, path, normalized-span, snippet-hash)` with the snippet read
  from disk at `start..end` — drift:ai already has `feature-hash.ts`-style
  plumbing for exactly this shape of problem.
- The matched source text must be read from the file, not the JSON.
- Opengrep ships fingerprints un-gated, if this ever matters enough.

### Noise controls

- `--severity ERROR` / metadata-confidence filtering (post-hoc on JSON —
  preferable for us, since dropped rows can still be counted in a disclosure).
- `.semgrepignore` (gitignore syntax, v2; sensible defaults: `node_modules`,
  `dist`, `vendor`, minified, etc. — note it also skips `tests/` by default
  template in some setups; verify per-repo what got skipped via `--verbose`).
- `// nosemgrep: <rule-id>` inline, for accepted findings — a
  suppression-churn signal drift:ai's `suppressions` check could learn to
  count, same as `eslint-disable`.
- `--exclude-rule <id>` / pack-level excludes for classes ruled irrelevant
  (e.g. `no-replaceall` under Bun).

### Reproducibility

Registry packs are **mutable server-side and need network at scan time**. For
a sensor whose value is *comparability across runs*, pin both:

- the engine (`pip install semgrep==X.Y.Z`), and
- the rules: vendor `curl https://semgrep.dev/c/p/<pack>` snapshots into the
  tools checkout (private vendoring is within the rules license; redistribution
  is not) and scan with `--config <local-file>`. Offline scans then also work.

### Language maturity

GA tier (relevant here): TypeScript/JSX, JavaScript, Go, Python, Rust, Kotlin,
Swift, Java, C#, Ruby, PHP, C/C++, Terraform. Bash/Dockerfile are
Experimental — visible in the field runs as partial-parse errors on hook
scripts. Generic/regex mode covers everything else (the trailofbits
`redis://`/compose rules above are `generic`).

## 6. Triage pipeline shape (the AI part)

What the field runs suggest as the working unit:

1. **One combined invocation** per repo (multiple `--config` flags), JSON out.
2. **Mechanical pre-pass** (no AI): drop parse-error noise into a disclosure
   block; group findings by `(check_id, path)`; order groups by
   `(confidence desc, severity desc, group size asc)` — small HIGH-confidence
   groups first, 195-row LOW piles last.
3. **AI triage per group**, with the rule's `message`, `metadata.references`,
   and the on-disk snippet for each member. Verdicts: real / FP-in-context /
   accepted-risk, plus a one-line reason. The two spot-checks today
   (rwmutex, TOTP fixture) show group-level verdicts are usually one glance.
4. **Persist verdicts keyed by the self-computed fingerprint** so the next run
   only surfaces new/changed groups — this is the actual "drift" sensor; the
   first run is calibration.

Independent support that this division of labor works: Semgrep's own paid
Assistant claims ~60% of findings auto-triaged with 96% human-agreement —
i.e. the vendor's monetization *is* this pipeline. Published research
(SAST-Genius hybrid) reports an LLM layer cutting 225 semgrep FPs to ~20 on
a benchmark. OWASP Benchmark places untuned semgrep at ~87% TP / ~42% FP —
high recall, noisy, which is precisely the profile an AI-triage layer wants.

There is an official MCP server (`semgrep-mcp` on PyPI; repo folded into the
main semgrep repo Oct 2025) exposing scan/rule tools. For interactive Claude
Code use it works logged-out; for the batch sensor lane, plain CLI + JSON is
simpler and keeps the run reproducible.

## 7. Fit with drift:ai

Two viable integration shapes, not mutually exclusive:

1. **Runbook only (zero code):** a documented battery + the triage pipeline
   above, run ad hoc against targets. Everything in §4 was done this way.
   Cheapest, available today; no contract surface.
2. **Prototype-lane adapter** (the dolos pattern): an opt-in
   `semgrep-candidates` subcommand that resolves a `semgrep` binary
   (tools-checkout venv first, then PATH), runs the pinned vendored packs,
   maps JSON to the advisory envelope, and **skips with a reason** when the
   binary is missing (`tool-not-installed`) or rules are absent. Provenance
   per row: engine version, pack snapshot id, rule id, severity, confidence,
   CWE — all present in semgrep's JSON already. Findings stay
   `kind: "advisory"`, `lane: "prototype"`; parse errors and rule timeouts go
   in the partial-run disclosure. Notably semgrep needs **no target
   `node_modules`** — it parses source directly — so it fits the
   tools-checkout/target split better than knip does (closer to jscpd:
   external binary, target as cwd, repo-relative paths).

What semgrep should *not* become here: a default-lane check (registry
mutability + Python-runtime dependency + untuned noise floor all violate the
default-lane bar) or a CI gate (counter to the report-only posture).

The existing field-run calibration template
(`finished_work/drift-ai-field-run-calibration.md`) applies as-is: today's
runs are the first calibration records; gastown's 428 and openclaw's pile are
the natural first full triage exercises.

## 8. Alternatives positioning (brief)

- **Opengrep** — same engine lineage, free fingerprints + cross-function
  taint, static binaries (no Python), no telemetry; you curate rules yourself.
  The likely *eventual* engine if the sensor matures; not the fastest start.
- **CodeQL** — deeper semantics, but licensing excludes free private-repo use.
  Out.
- **ast-grep** — very fast structural search/rewrite, great for *writing*
  custom rules, ships no curated security ruleset. A complement, not a
  replacement — drift:ai's ts-morph checks already occupy this niche for TS.
- **Joern** — expert interactive vuln-research workbench; wrong shape for a
  fire-and-forget periodic sensor.
- **GitLab SAST / betterscan etc.** — orchestration wrappers *around* semgrep;
  no advantage over invoking semgrep directly here.

## 9. Decision points and suggested next steps

Decisions this research surfaces (none taken yet):

1. **Engine posture:** CE logged-out now; revisit login (free ≤10 repos) or
   Opengrep when cross-run dedup or taint recall starts to matter.
2. **Battery composition:** proposed default —
   `default + security-audit + secrets + r2c-best-practices + trailofbits` +
   language packs + `ai-best-practices` for agent-bearing repos. Per-target
   excludes accumulate in config, not in forked rule files.
3. **Pin/vendor strategy:** vendor pack snapshots in the tools checkout vs
   live registry fetch. Vendoring is the drift-sensor-correct answer
   (comparability, offline); costs an occasional refresh chore.
4. **Integration depth:** runbook now; adapter only if the runbook proves
   recurring value (matches the prototype-promotion bar).

Natural next steps, smallest first:

- [ ] Run the full AI-triage pipeline once over gastown's 428 (the richest
      corpus) and record a calibration note — measures real triage cost and
      FP classes, which no web source provides.
- [ ] Vendor pinned pack snapshots + a tiny runner script (battery, JSON,
      grouping pre-pass) in the tools checkout.
- [ ] Add the self-computed fingerprint + verdict store; second run against a
      moved baseline proves the "only new groups" property.
- [ ] Then decide on the drift:ai adapter (backlog item alongside the dolos
      precedent).

## Sources

Verified-locally: all §4 numbers; pack rule counts and `p/llm-security` 404
(registry `curl` probes, 2026-06-05); fingerprint/lines login-gating (JSON
output inspection); baseline-commit behavior.

Web (researched 2026-06-05):

- CE rename + rules license: semgrep.dev/blog/2024/important-updates-to-semgrep-oss/ · semgrep.dev/legal/rules-license/
- CE vs Pro split: docs.semgrep.dev/semgrep-pro-vs-oss · JSON field gating: docs.semgrep.dev/semgrep-appsec-platform/json-and-sarif (and semgrep/semgrep#10762)
- Doyensec CE/Pro comparison: doyensec.com/resources/Comparing_Semgrep_Pro_and_Community_Whitepaper.pdf (via semgrep.dev/blog/2025/security-research-comparing-…)
- Pricing: semgrep.dev/pricing/
- Opengrep: opengrep.dev · aikido.dev/blog/opengrep-sast-one-year · github.com/opengrep/opengrep-rules (archived Nov 2025) · github.com/AikidoSec/opengrep-rules · docs.semgrep.dev/faq/comparisons/opengrep
- Trail of Bits adoption guidance: blog.trailofbits.com/2024/01/12/how-to-introduce-semgrep-to-your-organization/
- ai-best-practices: github.com/semgrep/ai-best-practices (migrated into semgrep-rules/ai/) · semgrep.dev/blog/2026/security-skills-ai-agents/
- Guardian (agent-IDE scanning product): semgrep.dev/products/product-updates/detect-risks-in-ai-generated-code-with-semgrep-guardian/
- Assistant triage metrics: semgrep.dev/blog/2025/semgrep-is-confidently-handling-60-of-all-triage-…
- LLM-triage research: arxiv.org/pdf/2509.15433 (SAST-Genius) · OWASP Benchmark FP data via getautonoma.com/blog/sast-tools
- Diff-aware docs: docs.semgrep.dev/semgrep-ci/ci-environment-variables · semgrep/semgrep#6621
- Language tiers: docs.semgrep.dev/supported-languages
- MCP server: github.com/semgrep/mcp (archived → main repo) · PyPI `semgrep-mcp`
- Slopsquatting (out of semgrep scope): snyk.io/articles/slopsquatting-mitigation-strategies/
- CodeQL licensing: docs.github.com/en/billing/concepts/product-billing/github-advanced-security
