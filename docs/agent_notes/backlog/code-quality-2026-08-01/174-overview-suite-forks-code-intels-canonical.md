# 174. The overview suite bypasses code-intel's canonical fixture harness

Status: Landed on fix/cq-174
Theme: Canonical test fixtures · Area: harness · Severity: low · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The code-intel overview suite privately recreates the synthetic repository root,
ts-morph project, package-export map, source writer, and workspace resolver that
sibling suites obtain from the shared fixture helper. This gives one suite a
separate model of the workspace and requires compiler or package-export changes
to be repeated manually.

The copies have already drifted: overview tests recognize fewer shared package
exports and no server exports. That currently affects only one suite's fixture
fidelity, but it weakens the value of those tests as a check of code-intel's
actual resolver behavior.

## Evidence

- `scripts/code-intel/overview-query.test.ts:13-58` contains a private 46-line
  harness: `repoRoot`, `packageConfigs`, `createFixtureProject`, `sourcePath`,
  `addSource`, and `createFixtureResolver`.
- `scripts/code-intel/test-fixtures.test-helper.ts:9-94` already exports
  `repoRoot`, `createFixtureProject`, `addSource`, and
  `createFixtureResolver`; the resolver closes over the helper's canonical
  package map at `:10-46`.
- The overview copy recognizes only `@musi/shared` schema exports and gives
  `@musi/server` an empty export map
  (`scripts/code-intel/overview-query.test.ts:15-30`). The shared helper also
  models shared rules, dice, map, and constants exports plus the server
  `./router-type` export
  (`scripts/code-intel/test-fixtures.test-helper.ts:10-46`).
- Four of the overview suite's five tests construct their project and resolver
  through the private fork at
  `scripts/code-intel/overview-query.test.ts:120-186`; only the argument-parser
  test at `:110-118` does not use it.
- Nine sibling code-intel suites already import the shared helper; for example,
  `scripts/code-intel/definition-query.test.ts:9-14` imports the same four
  facilities needed by the overview suite.

## Proposed direction

Replace `overview-query.test.ts`'s local
`repoRoot`/`createFixtureProject`/`addSource`/`createFixtureResolver` and
`packageConfigs` copies with imports from
`scripts/code-intel/test-fixtures.test-helper.ts`, keeping only the
router-specific fixture source builder local.

Import the helper through `./test-fixtures.test-helper.js`, following the
existing sibling-suite pattern. Delete the local block at
`overview-query.test.ts:13-58`, retain the `target`, `addRouterFixture`, and
`routerFixtureText` definitions, and remove the direct `node:path`, ts-morph,
and `createWorkspaceResolver` imports once they become unused. The shared
resolver should continue to encapsulate `packageConfigs`; it does not need to
export that internal registry.

## Scope / caveats

- This is a test-harness deduplication. Do not change overview query behavior,
  output formatting, or production workspace-resolution rules.
- Keep the router fixture text local because it describes the overview
  subject's procedures, schemas, service calls, and broadcasts rather than
  generic workspace infrastructure.
- Adopting the shared helper intentionally gives the suite its fuller package
  export map. If that exposes an assumption previously hidden by the narrower
  copy, fix the overview fixture or assertion rather than restoring a private
  resolver configuration.
- There is no sequencing dependency or prior-pack ruling for this extraction.
