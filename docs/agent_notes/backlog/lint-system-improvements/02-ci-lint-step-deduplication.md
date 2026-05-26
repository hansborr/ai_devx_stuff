# CI Lint Step Deduplication

Status: Parked
Order: 2

## Context

`bun run lint` already runs ShellCheck, config sensors, and ESLint through the
parallel lint runner. The source review found CI also running `lint:shell` and
`lint:config-sensors` as separate steps, creating duplicate work and duplicate
failure surfaces.

The right shape depends on what is more important for CI: one composite floor
or step-visible failure labels.

## Scope

- Re-audit `package.json`, `scripts/lint*.sh`, and `.github/workflows/ci.yml`
  for current lint command composition.
- Choose one CI contract:
  - Composite floor: keep one `bun run lint` step and rely on subtask labels.
  - Step-visible floor: split the package scripts so pure ESLint has an honest
    command name, while `lint:shell` and `lint:config-sensors` stay separate.
- Avoid a command name meaning one thing locally and another thing in CI.
- Update harness controls and generated docs if package-script surfaces change.

## Definition Of Done

CI no longer runs ShellCheck or config sensors twice unless the duplication is
explicitly documented and intentional.

## Verification

- `bun run lint -- --max-warnings=0`
- `bun run lint:shell`
- `bun run lint:config-sensors`
- `bun run harness:check` if harness controls change
- Successful CI validate run
