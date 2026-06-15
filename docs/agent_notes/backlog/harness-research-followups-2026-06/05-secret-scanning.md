# SEC-1 - Secret scanning (gitleaks/trufflehog)

> **STATUS: DESIGN-GATED — DO NOT IMPLEMENT YET.**
> This is a real gap, but the right shape for *this* repo is unresolved. Do not
> promote during routine backlog draining. Answer the open questions below with
> a human decision first.

## Problem

The harness research (`14-security-and-supply-chain.md`) notes AI code leaks
secrets at roughly twice the human rate and recommends secret scanning in
pre-commit *and* CI. Musi currently has **no secret scanning** anywhere — not in
`.husky/pre-commit`, not in `.github/workflows/ci.yml`.

This is distinct from the parked `semgrep-drift-*` work, which scans code
*patterns* (footguns), not credentials. A committed API key, DB URL with
password, or token would not be caught today.

## Why this is design-gated (not just "go add gitleaks")

1. **Where it runs vs. the pre-commit budget.** Pre-commit already runs gates in
   parallel under a ~260-300s budget with a last-verified marker. Adding a scan
   to that path needs a latency review; a full-history scan on every commit is a
   non-starter. CI-only? Staged-diff only in pre-commit?
2. **Existing mitigations change the risk math.** The devcontainer firewall
   (`.devcontainer/init-firewall.sh`) is default-deny egress with an allowlist,
   which already constrains exfiltration. That lowers urgency and changes whether
   pre-commit blocking is worth the friction.
3. **False-positive tuning is the real cost.** Test fixtures, seed data, and
   example env values will trip naive rules. A scanner without a tuned
   allowlist/baseline becomes noise the author learns to bypass — the opposite
   of the goal.
4. **Tool choice + supply chain.** gitleaks vs trufflehog vs a semgrep secrets
   ruleset; each is another pinned dependency subject to the cooldown policy and
   the firewall allowlist (the binary/install host must be reachable).
5. **Solo-repo blocking semantics.** With one author, a hard pre-commit block is
   pure self-friction; a CI warning may be the better first cut.

## Open questions to answer before implementing

- Pre-commit (staged diff only) vs CI vs both? What latency budget?
- Which tool, and does its install/update fit the firewall allowlist + cooldown?
- What is the initial allowlist/baseline for known-safe fixtures and seed data?
- Block or warn for the first iteration?
- Does the existing egress sandbox make pre-commit blocking unnecessary?

## Sketch (only after the above is decided)

- Most likely first cut: a CI job scanning the PR diff (not full history) with a
  tuned config, warn-then-block once the false-positive rate is known.
- A pre-commit hook would scan staged changes only, gated behind the budget.

Do not write any of this until the open questions are resolved.
