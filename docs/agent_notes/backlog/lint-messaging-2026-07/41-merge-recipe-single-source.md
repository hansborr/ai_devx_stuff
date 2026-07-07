# 41. Single-source the baseline merge-conflict recipe

Status: Done — implemented on lane/lint-msg-ratchet-fix.
Lens: ratchet · Area: consistency · Severity: med · Size: S-M · Confidence: med-high
Theme: hand-duplicated-text · Source: Musi lint-messaging review 2026-07-05 (5 Sonnet agents + Fable verification)

## Problem
The numbered merge-conflict recovery recipe exists twice, hand-maintained:
the merge driver's fallback stderr text and the guide's "Merge Conflicts"
section, which even says "The driver prints this same recipe when the
conflict is created." They agree today; nothing stops the next edit to
either from silently splitting them — and this is the highest-stakes
message in the ratchet system (it fires exactly when an agent is
mid-conflict with no gate to catch a wrong recipe).

## Evidence
- `scripts/git/lint-ratchet-baseline-merge-driver.sh:64-90` — the recipe.
- `docs/guides/lint-ratchet.md:663-703` — the verbatim doc copy.

## Proposed direction
Prefer the cheap option: a smoke test that normalizes both texts (strip
markdown/indentation) and asserts equality, registered like other
`scripts/tests/test-*.sh` (smoke-subject headers + regen). Alternative if
the docs-generation machinery already covers guide sections: generate the
doc block from the script's heredoc the way `docs:harness-controls`
generates its doc. Don't build new generation machinery just for this.

## Scope / caveats
- New smoke test ⇒ follow the smoke-subjects registration path
  (`# smoke-subjects:` header + `bun run test:scripts:subjects`).
- Keep the shell script the source of truth — it's what the stuck agent
  actually sees.

## Implementation
The shell driver fallback heredoc is marked as the source recipe, and the guide
contains a marked text block with the concrete baseline filename substituted
for the runtime `$path`. `scripts/tests/test-lint-ratchet.sh` extracts both
blocks and asserts equality after that substitution. The smoke subject headers
now include `docs/guides/lint-ratchet.md`, and the generated smoke-subject
registry was refreshed.

Focused coverage: `bun run test:scripts:subjects` and the lint-ratchet smoke
recipe parity assertion.
