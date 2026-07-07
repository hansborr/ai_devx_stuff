# 44. commit-msg rejection: restate the template + a worked example

Status: Done — implemented 2026-07-05; commit-msg failures now keep commitlint output and add the repo-specific template plus a worked example.
Lens: gates · Area: actionability · Severity: med · Size: S · Confidence: med
Theme: remedy-in-message · Source: Musi lint-messaging review 2026-07-05 (5 Sonnet agents + Fable verification)

## Problem
The `commit-msg` hook delegates entirely to commitlint, whose stock
rule-violation output ("subject may not be empty", "body must have at
least 40 characters") names rules without restating this repo's required
shape. Every other gate in the repo ends with the exact remedy; this one
makes the agent reconstruct the template from rule names or take a side
trip to AGENTS.md.

## Evidence
- `.husky/commit-msg:2` — bare commitlint invocation, no repo-specific
  text.
- `commitlint.config.js` — the enforced rules (type/scope shape, subject
  ≥ 20 chars, non-empty body ≥ 40 chars).

## Proposed direction
Wrap the commitlint call: on nonzero exit, print a short footer before
exiting nonzero —

    commit-msg: required shape:
      <type>(<scope>): <subject ≥20 chars>
      <blank line>
      <body ≥40 chars>
    example: fix(ratchet): resolve alias before name heuristic
             + one body line saying why.

## Scope / caveats
- Keep commitlint's own output first (it names the specific violated
  rule); the footer is additive.
- Derive the thresholds from `commitlint.config.js` if cheap, else accept
  hardcoding with a comment tying the two (they change together rarely).
- Check whether a smoke test asserts commit-msg hook output.
