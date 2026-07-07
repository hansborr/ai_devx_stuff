# 30. `audit:licenses` findings need a remedy path

Status: Done — implemented 2026-07-05; audit license findings now print a pointer-only remedy to record owner review in docs/agent_notes.
Lens: sensors · Area: actionability · Severity: med · Size: S-M · Confidence: med
Theme: finding-without-remedy · Source: Musi lint-messaging review 2026-07-05 (5 Sonnet agents + Fable verification)

## Problem
`audit-dependency-licenses.ts` lists strong-copyleft / review-copyleft /
unknown-license packages and sets a failing exit code — and stops there.
No allowlist mechanism, no "what to do next" line, no pointer to where a
review decision gets recorded. It is the only failure in the whole lint
messaging inventory with zero remedy text. An agent hitting it can neither
fix nor legitimately accept the finding.

## Evidence
- `scripts/audit-dependency-licenses.ts:322-357` — summary + package lists,
  `process.exitCode = 1`, no remedy text anywhere in the file.
- Contrast: every ratchet/sensor failure names its acceptance path
  (`--allow-worse --reason`, `--update`, allowlist file with reason).

## Proposed direction
Decision first, recorded in this leaf when made: allowlist mechanism vs.
pointer-only.

**Decision (2026-07-05, owner): pointer-only.** No allowlist file for now;
add the one-line next-step remedy naming where review decisions get
recorded. Revisit the allowlist mechanism only if findings recur.
- **Allowlist (preferred, matches house pattern):** a reviewed-licenses
  file (`package@version: reason`) consumed by the script; failure text
  then ends with the standard two-branch remedy: "replace the dependency,
  or after review add `<pkg>@<version>` to `<allowlist file>` with a
  reason."
- **Pointer-only (minimum):** one line naming the next step and where
  decisions are recorded (docs/agent_notes note or backlog leaf).

## Scope / caveats
- Audit-lane only (`bun run audit:deps` family) — low urgency, but the
  message pattern matters for the public-reference goal.
- If the allowlist route is taken, follow the blob-size allowlist format
  precedent (`sensor-blob-size.ts`: `<key> # reason` lines) rather than
  inventing a new shape, and check registration needs for any new config
  file (memory: rootJsConfigFiles / tsconfig.configs.json /
  lint-coverage-map rows).
