# 50. Suppression registers run only in doctor — wrong-way suppressions pass the commit gate; inline disables have no ledger at all

Status: In progress — Steps 1 and 3 implemented on 2026-07-04; CI suppression-register consumer wired on 2026-07-04; step 2 identity-ledger design drafted below and implementation remains deferred pending owner review; accepted step-3 freshness caveat recorded on 2026-07-04. OWNER PRIORITY (2026-07-04 session question: "if an agent disabled a rule in-file, would anything fail?"). Re-verify file:line before acting.
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
- `scripts/doctor.sh:780-788` — the only gate-ish invoker; absent from `scripts/verify/steps.generated.sh` consumers, `.husky/pre-commit`, and CI (verified by grep 2026-07-04).

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
