# 22. Bridge edit-time hook advisories to the envelope guidance

Status: Done — step (a) implemented on lane/lint-msg-coverage-bridge-fix (hook advisories bridge to the envelope via `bun run lint:agent:local-rules:changed`); step (b) implemented 2026-07-19 on auto/ready-b-hooks: the `--edit-check` wire row carries a ninth `repairCommand` column (adapter-enriched from rule docs for `repairKind: codemod`/`autofix`; the engine stays repo-agnostic) and the ratchet-regression advisory bullet names the exact repair command inline.
Lens: hooks · Area: discoverability · Severity: high · Size: M · Confidence: med-high
Theme: two-systems-no-bridge · Source: Musi lint-messaging review 2026-07-05 (5 Sonnet agents + Fable verification)

## Problem
The repo has two agent-facing lint systems that never reference each other.
The envelope path (`bun run lint:agent:local-rules[:changed]`) produces
structured per-rule `why`/`howToFix`/`repairCommand` — but is invoked only
on demand and is (deliberately) not a gate. The hooks that actually fire
while an agent edits (`lint-coverage-check`, `ratchet-regression-check`)
hand-compose their own prose and point at `bun run lint` /
`bun run lint:ratchet` only. An agent that doesn't already know the
envelope command exists gets none of the guidance machinery built for it —
including codemod `repairCommand`s for the exact rule it just regressed.

## Evidence
- `scripts/ai-hooks/ratchet-regression-check.sh:156-172` — advisory names
  rule/file/line but never a repair command nor the envelope command.
- `scripts/ai-hooks/lint-coverage-check.sh:128-143` — same pattern.
- `scripts/lint-ratchet/local-rule-fix-text.ts:62`
  (`localRuleMessageHowToFixFor`) — the fix-text logic the hooks bypass.
- Advisory-not-gate status for the envelope is a documented decision
  (`docs/guides/local-eslint-rules.md` severity-semantics section;
  harness-review leaf 53) — do not re-litigate gating; this leaf is about
  cross-referencing.

## Proposed direction
Two independent steps, smallest first:
(a) Append one pointer line to the ratchet-regression WARNING (and
optionally the coverage advisory): `For structured per-rule fix guidance:
bun run lint:agent:local-rules:changed`.
(b) When the regressed rule has `repairKind: codemod` (or autofix), name
the specific command in the advisory. Check whether
`lint-ratchet.ts --edit-check` output already carries repair metadata the
shell composer can use; if not, prefer extending that JSON over having the
hook shell out to a second bun process — the hook path is latency- and
throttle-sensitive by design.

## Scope / caveats
- Respect the existing throttling/caching (`AI_RATCHET_REGRESSION_*`);
  advisory length is budgeted — one added line, not a paragraph.
- (a) is a one-line change landable immediately; (b) may touch the
  edit-check JSON shape — keep it additive.
- Update the hook-body fixtures/tests under `scripts/tests/` that assert
  advisory text.
