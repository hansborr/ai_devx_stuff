# 54. Inline `eslint-disable` lowers ratchet counts — a suppression launders into a baseline tightening

Status: Done — option 1 implemented on 2026-07-04; option 2 rides leaf 50 step 3 as defense in depth; accepted cache-warmup caveat recorded on 2026-07-04. Re-verify file:line before acting.
Lens: pipeline · Area: suppression policy × ratchet · Severity: med-high · Size: S · Confidence: high
Theme: gate-wiring · Source: 2026-07-04 same-day review pass (Claude + Sonnet verification agent); companion to leaf 50

## Problem
The ratchet's generated isolated configs set no `linterOptions.noInlineConfig`
and the runner passes no `--no-inline-config`, so ratchet collection honors
inline `// eslint-disable-next-line <rule> -- reason` comments. Suppressing a
ratcheted violation therefore *lowers the collected count*: the gate reads it
as an improvement and demands `lint:ratchet:update`, the baseline tightens,
and the commit lands as apparent drain — the system launders the suppression
into a tighter floor, with no ledger entry anywhere (leaf 50). This is the
sharpest form of the owner-priority question ("if an agent disabled a rule
in-file, would anything fail?"): for ratcheted rules the answer today is not
just "nothing fails" but "the floor rewards it."

## Evidence
- `scripts/lint-ratchet/eslint-config.ts:47-176` — the generated configs
  carry only `ignores`/`files`/`languageOptions`/`plugins`/`rules`; no
  `linterOptions.noInlineConfig`. Verified 2026-07-04 (verification agent).
- `scripts/lint-ratchet/eslint-runner.ts:127-137` — runner args are
  `--format=json --no-error-on-unmatched-pattern [--cache ...] --config
  <path> <files>`; no `--no-inline-config`. Verified.

## Proposed direction
Decision: **Option 1** is the structural fix. The ratchet now generates every
ESLint config with `linterOptions.noInlineConfig: true`, so collection counts
ratcheted violations even when source files carry inline `eslint-disable`
comments. A live audit of current ratcheted rule ids found no existing
`eslint-disable` directives for those ids, so no one-time baseline update was
needed for this leaf.

The options considered:
1. **Suppression-proof collection:** set `linterOptions.noInlineConfig: true`
   in every generated ratchet config so counts measure violations whether or
   not they are suppressed — suppressed debt is still debt. Changes
   collection semantics: first audit for existing inline disables of
   currently ratcheted rule ids; any hit means counts jump above baseline
   and need a one-time `lint:ratchet:update` in the same commit.
2. **Fence the disables instead:** fold every currently ratcheted rule id
   into leaf 50 step 3's `no-restricted-disable` set so the inline disable
   itself fails normal lint. Weaker alone (the list must chase the registry
   — generate it from `lint-ratchet-config.ts`), but avoids touching
   collection semantics.
Option 1 is the structural fix; option 2 composes with it as defense in
depth.

## Scope / caveats
- Coordinate with leaf 50: its step-2 identity ledger records *new*
  suppressions but does not undo the baseline tightening this leaf prevents.
- Envelope/baseline identity semantics must stay byte-for-byte outside the
  intended count change (pack promotion rule 4).
- Accepted limitation: a dev machine with a pre-branch warm `.eslintcache`
  could briefly serve pre-`noInlineConfig` counts until ESLint's own
  config-content invalidation observes the generated config change. This is
  known-benign: the ratchet cache key intentionally derives from ratchet
  config hash + rule-source hash to keep cache identity stable, CI starts cold,
  and the committed baseline is unaffected once ESLint invalidates stale cache
  entries.
- One commit for option 1: config-writer change + audit + a fixture test
  proving an inline-disabled violation still counts; option 2 rides leaf 50
  step 3.
