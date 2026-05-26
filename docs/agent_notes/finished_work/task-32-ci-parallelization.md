# Task 32: CI Parallelization

Date: 2026-05-26

## Current Ordering

The CI workflow is `.github/workflows/ci.yml`. Its `validate` job currently
runs one ordered lane:

1. Checkout, setup Bun, install dependencies, install system lint tools.
2. `bun run format:check`.
3. `bun run typecheck`.
4. `bun run lint`.
5. `bun run lint:shell`.
6. `bun run lint:config-sensors`.
7. `bun run lint:ratchet:check-registry`, `bun run lint:ratchet`,
   `bun run lint:ratchet:check-baseline`, and
   `bun run lint:ratchet:zero-baseline`.
8. Lint-ratchet summary, sticky PR comment, and diagnostics artifact upload.
9. Generated lint guidance, harness parity, harness controls, script smoke
   tests, module index, unit tests, and build.

The `e2e` job currently has `needs: validate`, so it does not start until the
entire validate lane finishes.

## ESLint Artifact Dependency

The genuine ordering dependency is `typecheck -> type-aware ESLint` on a fresh
checkout. `bun run typecheck` runs `tsc -b` and `tsc -p tsconfig.scripts.json`
in parallel. The root build references `packages/shared`, `packages/server`,
and `packages/client`.

`packages/shared` and `packages/server` inherit `composite: true`,
`declaration: true`, `declarationMap: true`, and `sourceMap: true` from
`tsconfig.base.json`, and both emit to `dist`. ESLint's type-aware project
service needs those emitted package declaration surfaces when resolving
workspace package exports:

- `packages/shared/dist/**/*.d.ts` for `@musi/shared/*` package exports.
- `packages/server/dist/**/*.d.ts`, especially
  `packages/server/dist/routers/app-router.d.ts`, for the client import of
  `@musi/server/router-type`.
- `packages/shared/tsconfig.tsbuildinfo` and `packages/server/tsconfig.tsbuildinfo`
  are build-mode bookkeeping for incremental `tsc -b`; they are not the module
  surface ESLint resolves, but they are produced alongside the needed outputs.

The scripts, config, and e2e tsconfigs are `noEmit` lint/typecheck inputs. They
do not provide the shared/server declaration artifacts that type-aware package
lint needs.

## Parallelization Options

After checkout, Bun setup, dependency install, and system lint tool install,
these checks are independent enough to split into jobs or parallel steps:

- `format:check`.
- Shell/config lint sensors. Note that `bun run lint` already runs ShellCheck,
  config sensors, and ESLint in parallel, so the current CI also repeats
  shell/config lint as separate later steps.
- Generated lint guidance, harness parity, harness controls, module index.
- Script smoke tests.
- Unit tests, assuming the job provides the same Postgres service/env.
- Build, because `bun run build` already performs the package build order.
- E2E, because it has its own Postgres service, dependency install, browser
  install, and test setup. Its current `needs: validate` is a policy/diagnostic
  choice, not an artifact dependency.

The options with real coordination cost are:

- ESLint can run in a separate job only if that job first runs `tsc -b` or
  downloads/restores the `packages/shared/dist` and `packages/server/dist`
  artifacts from a typecheck/build job.
- The lint-ratchet report, sticky PR comment, and diagnostics upload should
  stay attached to the `lint:ratchet` job that creates
  `lint-ratchet-diagnostics.json`.
- Splitting many small checks into separate CI jobs duplicates checkout,
  setup-bun, dependency install, and cache restore work unless a shared setup
  strategy is added.

## Measurement

GitHub Actions history was not available from this container: `gh run list`
requires authentication, and the unauthenticated GitHub API returns 404 for the
repository. Local measurement used the requested command with the verification
cache bypassed:

```sh
TIMEFORMAT='real %3R\nuser %3U\nsys %3S'; time env FORCE_VERIFY=1 bun run verify:changed
```

Result: `verify:changed` passed in 184s wall time. The wrapper mode was
`parallel-verify-changed`, so all steps started together:

| Step | Time |
| --- | ---: |
| `test` | 184s |
| `scripts` | 142s |
| `ratchet` | 85s |
| `typecheck` | 17s |
| `lint` | 12s |
| `zero-baseline` | 10s |
| `format-check` | 3s |
| `coverage-map` | 0s |

The current local long pole is tests, not the typecheck/lint pair.

## Recommendation

Do not split CI only to parallelize typecheck and ESLint right now. ESLint's
fresh-checkout dependency on emitted shared/server declarations is real, and
the measured local cost of typecheck plus lint is small compared with tests.
Moving ESLint to a separate job would add artifact/cache plumbing or duplicate
`tsc -b` work for little likely wall-time gain.

If CI timing later shows validate as the bottleneck, the first worthwhile
experiment is to run E2E independently of `validate` or to split a small number
of large lanes such as unit tests, script smoke tests, and build while keeping
ratchet diagnostics/report/comment behavior in one lint-ratchet lane. Revisit
typecheck/ESLint job splitting only if Actions timing shows that pair, not
tests or E2E, is on the critical path.
