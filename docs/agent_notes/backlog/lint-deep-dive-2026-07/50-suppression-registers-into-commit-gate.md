# 50. Suppression registers run only in doctor — wrong-way suppressions pass the commit gate; inline disables have no ledger at all

Status: **All three steps done.** Steps 1 and 3 landed 2026-07-04; step 2
(the identity ledger) landed 2026-07-25 on `feat/suppression-identity-ledger`,
merged into the wave-1 integration as `8220ec4f`. Archived as `F6` in
`../../finished_work/ready-2026-07-drain.md`; the ready-queue row is closed.

> **2026-07-25 dispatch notes.** The originating question ("if an agent
> disabled a rule in-file, would anything fail?") is already answered: step 1
> put `suppressions` in all four slot sets **including pre-commit**
> (`scripts/verify/steps.generated.sh:12-15` → `scripts/lint-suppressions.sh:30-31`),
> and step 3's `eslint-comments/no-restricted-disable` fence covers 16 ratcheted
> rule ids. So scope step 2 to **identity and trend** over the ~243 remaining
> non-test inline disables — not to the gate hole, and not to allowlist
> externalisation, which already happened by another route: both allowlists are
> now data files (`scripts/data/eslint-disable-broad-allowlist.txt`,
> `scripts/data/ts-nocheck-allowlist.txt`, loaded at
> `eslint-disable-register.sh:111-124` and `suppression-register.sh:116-125`).
>
> Copy the landed knip identity ledger v2 shape
> (`sensor-knip-unused-exports.baseline.json`: `version: 2`, `summary`,
> `entries[]`) rather than inventing one. The leaf's claim that `doctor.sh` is
> "the only gate-ish invoker" is false now. Keep the leaf's own rule that the
> migration commit carries no policy change.
Lens: pipeline · Area: suppression policy · Severity: med-high · Size: M · Confidence: high
Theme: gate-wiring · Source: Musi lint deep-dive 2026-07-04 (3 parallel Codex xhigh lanes + Claude verification agents)

## Problem
Suppression policy is split across two layers with a gap between them. Normal
lint (every gate) enforces the *shape* of disables via `eslint-comments`
rules: a reason is required, rules must be named, unused disables fail. The
deeper *policy* lives in `scripts/eslint-disable-register.sh` (broad
file-level disables must be in the in-script `BROAD_ALLOWLIST`; every
directive needs `-- reason`) and `scripts/suppression-register.sh`
(`@ts-ignore` banned, `@ts-expect-error` needs a reason, `@ts-nocheck`
allowlisted, broad Stryker disables banned) — but both run **only from
`doctor.sh`**. Consequences:
- A file-level `eslint-disable rule -- reason` (the wrong way to record an
  exception — including for whole-file rules like `local/max-lines`, whose
  sanctioned path is the centralized `maxLinesExceptionConfigs`) passes
  pre-commit, verify, and CI; only an ad-hoc doctor run flags it.
- `@ts-ignore` and unlisted `@ts-nocheck` likewise pass every gate.
- A *reasoned inline* disable passes everything by design and is counted
  nowhere: no ledger, no identity, no trend. Reviewers see it once in a diff
  or never.
- For *ratcheted* rules the same inline disable is worse than uncounted: it
  lowers the ratchet's collected count and launders into a baseline
  tightening — split out as leaf 54 (2026-07-04 review pass).

## Evidence
- `eslint-config/rule-groups.js:48-53` — gate-enforced shape rules (`require-description` with `ignore: []`, `no-unlimited-disable`, `no-unused-disable`). Verified 2026-07-04.
- `scripts/eslint-disable-register.sh:22-33` — `BROAD_ALLOWLIST` (10 file|rule pairs); `:100-127` broad-disallowed + missing-reason failure paths; exit 1 on either.
- `scripts/suppression-register.sh:1-9,25-31` — TS/Stryker policy + `TS_NOCHECK_ALLOWLIST`.
- ~~`scripts/doctor.sh:780-788` — the only gate-ish invoker~~ **Stale since step 1 (2026-07-04).** `scripts/lint-suppressions.sh` is wired into all four slot sets including pre-commit; `doctor.sh` is one of several invokers, not the only one. Corrected 2026-07-25.
- **The "~243 remaining inline disables" figure was also wrong.** It counted raw
  `grep` hits, which include prose in docs, fixture strings inside tests, and
  `.md` mentions. The registers' own scanners — the authority on what a
  directive is — find **89 directives** in code (46 eslint-disable: 30 inline +
  16 broad; 43 TS/Stryker: 32 `@ts-expect-error`, 11 Stryker, zero `@ts-ignore`
  and zero `@ts-nocheck`). Those expand to **94 ledger identities**, because a
  directive naming several rules or mutators yields one identity per target.
  Measured 2026-07-25.

## Proposed direction
1. **Wire both registers into the commit gate.** They are plain grep passes
   over tracked files (sub-second); add a `suppressions` slot to the generated
   verify steps for all consumers (full + changed + pre_commit). Changed-aware
   narrowing is an optimization, not a requirement, at this cost.
2. **Upgrade count/allowlist to an identity ledger** (the ratchet debt-log
   pattern): key every suppression as `(path, rule-or-directive, kind)` in a
   committed register file; the gate fails when a new identity appears without
   a same-diff ledger entry carrying a reason. This makes inline disables
   reviewable in one place, gives drain visibility, and replaces the
   in-script `BROAD_ALLOWLIST` with reviewable data. (Mirrors leaf 61's
   identity upgrade for the knip floor — same design decision, keep them
   consistent.)
3. **Hard fence (promoted from optional, 2026-07-04 review):**
   `@eslint-community/eslint-comments/no-restricted-disable` for rules that
   must never be inline-disabled (raw-SQL fence, `local/concurrency-guard`,
   transaction-boundary rules, plus every currently ratcheted rule id per
   leaf 54 option 2) so the ledger is the only exit for the highest-value
   guards. Verified 2026-07-04: the installed
   `@eslint-community/eslint-plugin-eslint-comments@4.7.1` ships the rule.

## Step 2 identity-ledger design (owner-review draft, no implementation yet)

Use the same identity-ledger pattern as leaf 61's knip baseline v2: a committed
JSON document with deterministic ordering, a summary block for humans, and an
`entries[]` list whose keys are stable enough to survive line churn. The
suppression implementation should prefer a single source of truth such as
`suppression-ledger.json` over script-local allowlists.

Proposed shape:

```json
{
  "version": 1,
  "tool": "suppression-ledger",
  "summary": {
    "eslintDisable": 0,
    "typescriptSuppression": 0,
    "strykerDisable": 0
  },
  "entries": [
    {
      "key": "eslint-disable|packages/server/src/example.ts|no-restricted-syntax|file|sha256:...",
      "path": "packages/server/src/example.ts",
      "kind": "eslint-disable",
      "target": "no-restricted-syntax",
      "scope": "file",
      "selectorHash": "sha256:...",
      "duplicateIndex": 0,
      "reason": "Existing broad suppression migrated from BROAD_ALLOWLIST.",
      "status": "allowed-existing"
    }
  ]
}
```

Identity keying:
- Never key on line number. A nearby edit must not create a new suppression
  identity by moving a directive.
- Key as `(kind, path, target, scope, selectorHash, duplicateIndex)`.
  `target` is the ESLint rule id, TypeScript directive name
  (`@ts-expect-error`, `@ts-nocheck`, `@ts-ignore`), or Stryker directive.
  `scope` is `file`, `block`, `line`, or `next-line`.
- `selectorHash` should hash the normalized directive subject, excluding
  whitespace and the free-text reason. For `eslint-disable-next-line`, include
  the normalized disabled rule list and directive kind; optionally include a
  normalized next-code-line hash only as a tie-breaker, not as the primary
  line-number substitute.
- `duplicateIndex` disambiguates identical repeated directives in one file,
  ordered by current file order. This accepts coarse granularity: inserting an
  identical directive before another identical directive may require a ledger
  touch, which is preferable to line-number churn.

Gate semantics:
- The collector emits the current identity set. The gate fails on any identity
  present in the current set but absent from the committed ledger unless the
  same diff adds a ledger entry with a reason.
- The gate also fails on ledger entries whose identities disappeared, requiring
  a baseline-tightening update so drains are visible.
- Existing shape rules remain in normal lint and the step 3 hard fence remains
  non-negotiable: rules in `no-restricted-disable` cannot enter this ledger as
  inline ESLint disables.

Migration plan:
- Run the existing register collectors once and write every currently accepted
  suppression into the ledger, including reasoned inline disables, existing
  `@ts-expect-error` directives, Stryker disables, and the current
  `BROAD_ALLOWLIST` / `TS_NOCHECK_ALLOWLIST` entries.
- Replace script-local allowlists with ledger reads in the same implementation
  commit. The first generated ledger should be a pure migration: no policy
  tightening, no count changes, and no allowlist deletion without a matching
  ledger entry.
- Keep summaries derived from `entries[]`; do not hand-maintain counts.

## Step 2 as built (2026-07-25)

Landed as `suppression-ledger.json` plus `scripts/suppression-ledger*.ts` and a
`suppression-ledger` slot in all four slot sets. **94 identities** migrated.

**Shape.** Exactly the knip identity ledger v2 pattern, through the same
`BaselineMetricSpec` facade over the grouped-baseline kernel: `version: 2`,
`tool`/`metric`, spec `meta` spread at top level, `regenerate`, a derived
`summary`, and a key-sorted `entries[]`. The verdict is the kernel's symmetric
`gateEntries`. Nothing about the document format is bespoke.

**One scanner, not two.** The registers own the comment/string/template state
machine that decides what a directive is. Rather than reimplement it in
TypeScript — two definitions of "suppression" that can drift — both registers
gained `--identities-out <path>`, emitting `kind/path/line/text` records during
their existing single scan behind a `#scope` header (plus `#path` lines in
changed mode). The emission is additive: no register verdict, count, or exit
code moves, and records are still written when a register's policy check fails.

**Deviations from the draft above, and why.**
- `version: 2`, not the drafted `1` — the drafted `tool: "suppression-ledger"`
  survives, but the version and envelope come from the shared kernel.
- No `status` field. Every migrated entry would carry the same constant
  `"allowed-existing"`, which is noise, not review signal.
- `reason` is **derived from the directive text**, never hand-maintained, and a
  shared identity whose recorded reason no longer matches the tree fails the
  gate with the regeneration command. Hand-authored reasons would have been a
  second source of truth for something the registers already enforce in code.
- `scope` is `file` | `line` | `next-line`; the drafted `block` is not
  derivable, because neither register tracks `eslint-enable`, so a bounded
  block range does not exist in a single directive record. A bare
  `eslint-disable` records as `file`, matching the register's "broad" vocabulary.
- `selectorHash` is `sha256:` + 12 hex digits over the directive keyword and its
  full normalized rule/mutator list. Including the sibling list is deliberate: a
  solo `no-console` disable and the `no-console` half of a two-rule disable are
  different review objects. The drafted optional next-code-line tie-breaker was
  **not** implemented — it would reintroduce exactly the churn the line-free key
  exists to avoid. The collision it would have closed is recorded under
  *Accepted limitations* below.
- **The allowlists were not folded into the ledger.** The draft called for that,
  but both are already external reviewable data
  (`scripts/data/eslint-disable-broad-allowlist.txt`,
  `scripts/data/ts-nocheck-allowlist.txt`) via another route, and moving policy
  into the ledger would have made the migration commit a policy change — which
  this leaf forbids. Policy stays in the registers; the ledger only records what
  exists.

**Changed-mode scoping.** A key-set gate cannot run on a partial scan without
reading every unscanned identity as a removal. In changed mode the comparison is
restricted to the paths the registers actually read, applied symmetrically to
both the ledger and the tree, so a narrowed scan gates less but never fails
falsely. Whole-tree gating happens only when *every* register reported a full
scan.

**Accepted limitations.**
- A reason that continues onto later lines of a block comment records as an
  empty `reason` (the scanners are line-based and never join continuations).
  One entry is affected today. It is stable, not flaky: editing the
  continuation prose does not churn the ledger.
- `duplicateIndex` is coarse by design: inserting an identical directive above
  another identical one in the same file renumbers both. That is the price of
  never keying on a line number.
- **Identical directives in one file can trade places unreviewed.** Neither the
  key nor the payload carries any context about the code a directive covers, so
  byte-identical occurrences in a file are distinguished only by scan order.
  Concrete case: `packages/server/src/socket/broadcast-registry.test.ts` holds
  the same `@ts-expect-error` with the same reason at two lines, recorded as
  `duplicateIndex` 0 and 1. Remove one of those negative tests and add the same
  directive before unrelated code elsewhere in that file and both keys and both
  payloads are unchanged, so the full and changed gates pass and the
  substitution never reaches ledger review. The count is conserved and no *new*
  suppression gets in, which is why this is accepted rather than fixed: the only
  close is the next-code-line tie-breaker rejected above, and it would churn the
  ledger on every ordinary edit to a suppressed line. Reconsider it if
  suppression substitution ever shows up as a real review miss.
- A rename's old path leaves stale ledger entries that changed mode will not
  see; the full slot and CI catch them. This matches the existing treatment of
  other changed-scope narrowing.
- The tree is scanned twice per gate run — once by the `suppressions` slot for
  policy, once by `suppression-ledger` for identity — because the two live in
  separate slots. Folding them into one wrapper was rejected: the register smoke
  tests run `lint-suppressions.sh` inside a bare temp repo with no `node_modules`,
  so it cannot invoke a TypeScript CLI. **Open for owner review:** consolidating
  the two slots would halve full-verify suppression cost (about 62s whole-tree,
  both scanners concurrent).
- No semantic merge driver is installed for `suppression-ledger.json`, unlike
  the other four committed baselines. Disjoint drains that both touch
  suppressions will conflict on it and must resolve by regenerating.
  **Open for owner review** — it is the natural follow-up if this ledger sees
  parallel-lane traffic.

## Scope / caveats
- Line-number churn: keying identities by line breaks on unrelated edits; key
  by `(path, rule, kind)` + occurrence index, or content-hash of the directive
  line, and accept coarse granularity (any change to the set for a path needs
  a ledger touch).
- Step 1 alone closes the "wrong way passes the gate" hole and is one small
  commit (register scripts already exit nonzero correctly; just add the slot
  via `scripts/harness/generate-verify-steps.ts` + `harness.controls.json`
  registration — see memory: config-file/slot registration chains).
- Steps 2-3 are separate commits; step 2 wants a short design note in the
  leaf before implementation (ledger format, migration of current counts).
- Accepted limitation for step 3: the generated restricted-disable fence file's
  freshness is enforced by `harness:check` in CI and by the scripts smoke slot
  (`test-harness-check`), not by a dedicated verify slot. Under fast-commit, a
  stale generated fence can therefore be deferred to CI when the slow scripts
  slot is skipped; that matches the existing treatment for
  `docs/generated/harness-controls.md` and hook-wiring freshness.
