# 46. Portable shellcheck install guidance

Status: Done — implemented 2026-07-05; lint-shell missing-shellcheck guidance now names portable package managers instead of apt-only installation.
Lens: gates · Area: correctness-of-remedy · Severity: low · Size: XS · Confidence: high
Theme: wrong-remedy · Source: Musi lint-messaging review 2026-07-05 (5 Sonnet agents + Fable verification)

## Problem
`lint-shell.sh`'s missing-shellcheck message says to
"install the system package with `apt install shellcheck`" — but the
repo's own dev container is Fedora (no apt). The one remedy in the lint
stack that is actively wrong on the reference environment. Verified
2026-07-05.

## Evidence
- `scripts/lint-shell.sh:134-137` (apt at `:136`).
- Container: Fedora (`Linux …fc44…`), where the command fails.

## Proposed direction
Replace with package-manager-agnostic text, e.g.:
"install shellcheck with your system package manager (dnf/apt/brew) —
see https://github.com/koalaman/shellcheck#installing". If the dev
container is the only supported environment, name `dnf install shellcheck`
first.

## Scope / caveats
- One-line change; check for a smoke test asserting this message.
