# Leaf 41c Config Sensors

Landed: 2026-05-21 on
`feature/lint-hardening-leaf-41c-config-sensors`.

## Scope

`bun run lint:config-sensors` now runs four independent sensors:

- actionlint over `.github/workflows/*.yml` / `*.yaml`
- yamllint over `.yamllint.yml`, `.github/workflows/*.yml` / `*.yaml`,
  `docker-compose.yml`, `.devcontainer/docker-compose.yml`, and
  `.codex/skills/*/agents/openai.yaml`
- taplo `fmt --check` plus `lint` over `bunfig.toml` and `.codex/config.toml`
- hadolint over `.devcontainer/Dockerfile`; the ignored local
  `docs/refs/5e-database/Dockerfile` is also checked when present, using
  reference-only ignores for inherited low-value findings

`.playwright-cli/**` stays excluded from discovery and changed-path matching.

## Install Paths

- actionlint: pinned npm wrapper `@tktco/node-actionlint@1.6.0`. The expected
  `@rhysd/actionlint` npm package was not present in the registry; this wrapper
  was current and worked against explicit workflow file paths.
- yamllint: system `yamllint` from `PATH` (`apt install yamllint`, version
  >=1.29.0; verified with `/usr/bin/yamllint` 1.29.0 in the 2026-05-21
  follow-up). The prior repo-local Python venv was removed per user preference
  for apt-provided packages. The tested npm port `yamllint-js@0.2.4` was
  rejected because it produced false duplicate-key findings for valid nested
  Docker Compose keys.
- taplo: pinned npm wrapper `@taplo/cli@0.7.0`, which currently reports
  Taplo 0.9.0 and supports the needed `fmt --check` and `lint` commands.
- hadolint: pinned npm wrapper `hadolint@0.4.2` with upstream Hadolint pinned
  to 2.14.0 through the root `package.json` `hadolint` field. The wrapper
  downloads the binary without executable bits, so `lint-config-sensors.sh`
  applies a narrow chmod guard before invoking it.

## Findings

- actionlint: zero findings on `.github/workflows/ci.yml`.
- yamllint: fixed two long Codex skill `default_prompt` strings by using folded
  YAML scalars. The `.yamllint.yml` profile uses line length 120, two-space
  indentation, no document-start requirement, one-space inline comment spacing,
  and disables truthy-key checks for GitHub Actions' `on` key.
- taplo: zero findings on the tracked TOML config files.
- hadolint: `.devcontainer/Dockerfile` only triggered `DL3007`; this is ignored
  for the maintained Dockerfile because the base is a local refreshed
  devcontainer image tag. The optional ignored reference Dockerfile keeps
  `DL3008`, `DL3015`, and `DL4006` ignored because those findings are inherited
  from reference material outside Musi's build targets.

No ratchet adapter or baseline was added.

## Wiring

Full `bun run lint` now runs ShellCheck, config sensors, then ESLint.
`scripts/lint-changed.sh` invokes config sensors in changed mode and includes
them in full-lint fallbacks. Changed-gate relevance and `.husky/pre-commit`
now include workflow YAML, root YAML/TOML, devcontainer YAML/Dockerfile,
Codex config TOML, and Codex skill agent YAML paths. Harness controls declare
the new `lint:config-sensors` package script as `check/config-sensors`.

Smoke coverage lives in `scripts/test-lint-config-sensors.sh`; the script uses
the system `yamllint` binary and creates fixtures for one known violation per
wired tool and checks changed-mode TOML failure. `scripts/test-lint-changed.sh`,
`scripts/test-scripts.sh`, `scripts/test-test-scripts.sh`, and
`scripts/test-verify.sh` were updated for the new floor and relevance paths.

## Verification

The final ordered verification pass completed:

- `bun run lint:config-sensors`
- `bun run lint -- --max-warnings=0`
- `bun run lint:ratchet`
- `bun run lint:ratchet:check-baseline`
- `bash scripts/test-lint-ratchet.sh`
- `bun run docs:lint-coverage-map:check`
- `bash scripts/test-verify.sh`
- `bash scripts/test-lint-config-sensors.sh`
- `bun run typecheck`
- `MUSI_INTERACTIVE_TIMEOUT=900 bun run verify:changed`

Additional sanity checks after adding `check/config-sensors`:
`bun run docs:harness-controls:check` and `bun run harness:check`.
