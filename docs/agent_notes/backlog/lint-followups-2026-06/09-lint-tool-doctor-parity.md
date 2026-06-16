# Lint Tool Doctor Parity

Status: Done (2026-06-12, landed in "feat(lint): add a lint host-tool
inventory section to doctor")
Order: 09
Source: promoted from the lint-review-2026-06 watchlist ("Lint tool
doctor parity", carried from Codex review item 6), 2026-06-12 re-triage.

## Context

The lint surface depends on host/system tools beyond the Bun-managed
dependency graph: ShellCheck, yamllint, actionlint, taplo, hadolint, plus
ESLint/Prettier/Bun versions. A contributor (or reference adopter) has no
single command that says which tools are required, which are present, and
which versions are known-good. `scripts/doctor.sh` is the established
diagnosis surface (note from the prior pack's leaf 13a: `doctor --json`
is invoked from repo root by `harness:check`).

## Scope

- Add a lint-tools section to doctor: for each required tool, report
  presence, version, and the known-good version (single-sourced — if a
  version is already pinned in config or docs, read it from there rather
  than duplicating).
- Distinguish hard requirements (verify fails without them) from
  optional/degraded tools, matching how the lint scripts actually behave
  when a tool is missing (`scripts/lint-shell.sh` and friends — verify
  the actual degradation behavior, don't guess).
- Keep it report-first: doctor describes, it does not install.
- Update the contributor-facing doc that covers environment setup to
  point at the doctor command.

## Definition Of Done

`bun run doctor` (and `--json`) enumerates every host tool the lint
surface invokes, with version and required/optional status, and the JSON
shape is covered by a test.

## Verification

- Doctor run on the dev container shows all-green; temporarily shadowing
  one tool off `PATH` flips its row without crashing doctor.
- `doctor --json` parses and the new section is asserted in a script test.
- `bun run verify:changed`.

## Notes (2026-06-12)

- Added a `check_lint_tools()` section + `doctor-check/lint-tools` control
  (kept the existing yamllint/shellcheck checks as-is — option b). Covers
  eslint, prettier, taplo, node-actionlint, hadolint, bun.
- Known-good versions are read from their single source: package.json pins
  for the npm-managed tools, `HADOLINT_VERSION` in
  `scripts/lint-config-sensors.sh` for the hadolint binary, and the
  `packageManager` field for Bun.
- Version display: for npm-managed tools, report the **installed npm package
  version** (`node_modules/<pkg>/package.json`), which shares a namespace
  with the pin — node-actionlint exposes no usable `--version` (it lints
  instead) and taplo versions its bundled binary (0.9.0) independently of the
  npm package (0.7.0), so `--version` would be misleading. hadolint and bun
  are genuine binaries, so they use `--version`.
- Missing tools warn (not fail), matching the existing precedent and the
  config sensors' actual behavior (hard-fail only when matching files exist).
- Stale leaf ref corrected: the leaf says `harness:check` invokes
  `doctor --json`; it is the reverse — `doctor` invokes `bun run harness:check`
  from the repo root (asserted in `test-doctor-json.sh`).
- Test coverage added to `test-doctor-json.sh`: a default-mode section-header
  assertion and a missing-tool scenario (node_modules/.bin stripped from PATH,
  node-actionlint guaranteed missing) that asserts a warn under
  `doctor-check/lint-tools`; fixtures stub the tools so the existing
  single-finding assertions still hold. `.devcontainer/README.md` updated.
