# Leaf 20: Package Manifest Policy

Status: Parked
Source: `docs/agent_notes/backlog/lint-hardening/19-package-dependency-policy.md`

## Problem

`import-x/no-extraneous-dependencies` now catches source imports from the wrong
package dependency surface, but it does not validate package metadata
conventions. A separate manifest-policy sensor can catch workspace/package
drift without overloading ESLint import rules.

## Scope

Add a report-first package/workspace manifest policy script. Keep it separate
from `import-x`: manifest policy checks metadata, while ESLint checks source
imports.

Candidate checks:

- package naming conventions;
- expected `private` flags;
- `type: "module"`;
- internal dependency edges and package direction;
- required root scripts;
- root vs package dependency placement;
- decision on whether `bun run audit:deps` stays manual/CI/doctor/slow-tier.

## Candidate Work

- Write a small structured manifest parser instead of ad hoc string checks.
- Add fixture-backed script tests.
- Surface report-only output through `doctor` first.
- Add a harness control and generated docs entry.
- Gate package manifest edits only after exceptions and repair text are
  explicit.

## Exit Criteria

- Manifest policy exists as a report-only sensor, or the leaf records why the
  current `import-x` gate is sufficient for now.

## Verification

- Targeted manifest-policy script tests
- `bun run doctor`
- `bun run harness:check`
- `bun run docs:harness-controls:check`
- `bun run test:scripts:changed`
- `bun run verify:changed`
