# 43. README Quickstart understates the Bun minimum (>= 1.2.0) below the engines-enforced >= 1.3.0 floor

Status: Proposed — codebase maintainability/onboarding audit 2026-06-13. Not yet started.
Theme: onboarding setup drift · Area: docs · Severity: low · Size: XS

Source: codebase maintainability/onboarding audit 2026-06-13 (lens: onboarding-setup); evidence independently re-verified (post-review addition, 2026-06-13). · Confidence: high

## Problem
The README Prerequisites tell a new developer to install `Bun >= 1.2.0`, but the
repo actually requires a higher floor: root `package.json` declares
`engines.bun: ">=1.3.0"` and pins `packageManager: "bun@1.3.11"`, and CI runs Bun
`1.3.11`. A newcomer who installs the version the README names (any `1.2.x`) is a
full minor below the enforced engine floor, so `bun install` can warn or — under
`engine-strict` / corepack-style `packageManager` selection — refuse, and any
behavior that depends on a 1.3 feature diverges silently from CI. This is the same
class of first-five-minutes doc-vs-contract drift as the phantom `JWT_REFRESH_SECRET`
(leaf #3): the very first setup instruction disagrees with the real requirement, so
the newcomer either trips a version error or runs an unsupported toolchain. The
report's Theme 1 names this drift, but no standalone leaf carried its evidence until
this one.

## Evidence
- `README.md:14` — Prerequisites: `- [Bun](https://bun.sh/) >= 1.2.0`. This is the version a newcomer installs.
- `package.json:14` — `"engines": { "bun": ">=1.3.0" }`: the real minimum is `1.3.0`, one minor above what the README states.
- `package.json:12` — `"packageManager": "bun@1.3.11"`: the pinned toolchain version, used for corepack-style auto-selection.
- `.github/workflows/ci.yml` / `.github/workflows/slow-drift.yml` — `setup-bun` is pinned to Bun `"1.3.11"`, so CI never exercises the `1.2.x` range the README sanctions.
- No other doc restates a Bun floor: `rg -n "Bun|bun@" README.md AGENTS.md .devcontainer/` shows the README `>= 1.2.0` line is the only human-facing version statement, so it is the single source a newcomer trusts.

## Proposed direction
Doc-only fix; no code change. Update `README.md:14` to state `Bun >= 1.3.0` (matching
`package.json` `engines.bun`), and optionally name the pinned `1.3.11` toolchain so the
Prerequisites, the `packageManager` field, and CI all agree. Keep `package.json`
`engines`/`packageManager` as the source of truth — the README is the thing that
drifted, exactly as with leaf #3 (phantom `JWT_REFRESH_SECRET`); fold this one-line edit
into the same Quickstart-drift cleanup so reviewers re-read the Prerequisites block once.
TDD-aware: there is no README/engines agreement check today; if a guard is wanted (cheap,
durable against this drift class), add a focused scripts-project test that parses the Bun
version named in the README Prerequisites and asserts it satisfies `engines.bun`, run via
`bun run test:scripts:file -- <new test file>`. The line edit alone resolves the finding.
No package-flow ordering concern (docs-only; no shared/server/client change).

## Scope / caveats
- Touch only `README.md` (and optionally one scripts-project guard test). Do **not** lower
  the `engines.bun` floor or change the `packageManager` pin to "make the README true" — the
  `>= 1.3.0` requirement is intentional (CI runs `1.3.11`); the README is wrong.
- This is a documentation-accuracy / onboarding finding, **not** a duplication or dead-code
  finding (those are owned by `docs/agent_notes/backlog/drift-ai-findings/`): nothing is
  duplicated or unused — a setup doc simply understates a version bound. It is distinct from
  the other onboarding-setup leaves (#1–#5), each of which targets a different Quickstart/setup
  drift, and unrelated to the harness-ergonomics, useEffect, Storybook, lint-debt, dep-bump,
  and UX/infra backlogs.
- Risk: none beyond the doc edit; the optional guard test only reads files. Sequencing:
  batch with any other README Quickstart corrections (notably leaf #3).
- Provenance: this leaf was added during the post-audit review pass (Claude + Codex) because
  the report's Theme 1 cited the wrong-Bun-version drift without a backing leaf; the evidence
  here was verified at HEAD on 2026-06-13.
