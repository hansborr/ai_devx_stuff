# Lane 06 — test suites and test infrastructure

Status: Dispatch material — not a schedulable note

**Scope.** All unit/integration tests across the three packages and
`scripts/`, test helpers (`*.test-helper.*`, shared fixtures, mock layers),
`scripts/tests/` (the shell-smoke substrate — dedup against prior-pack
leaf 27's plan in the corpus), `e2e/` (specs, page objects, helpers), and
the test-infra config surface: vitest configs, `playwright.config.ts`,
Stryker configs, test-related package.json scripts.

**Precedence.** This lane owns test-shaped findings **repo-wide**: other
lanes exclude test files from their scope and hand you what they notice as
`coverage.pointers` one-liners. Those pointers reach you via your wave-2
top-up brief — the orchestrator aggregates and routes them after wave-1
banking, so do not expect them during wave 1. A test-shaped problem
anywhere is yours to report.

**Emphasis.** Tests as documentation: can a new contributor read a test and
learn the system? Look for: assertion styles and helper idioms that differ
per suite without reason; fixture/factory duplication (open leaf 40 owns the
typed-factory push — find what it does not cover); tests pinned to
implementation details that make refactors needlessly expensive; e2e page
objects bypassed by raw selectors; slow or serial test shapes that resist
parallelism; test files whose names lie about their subject; coverage
theater (tests that execute code but assert nothing meaningful).

**Known context.** Dedup against open leaves 40, 41 (only optional tidy
remains), 42 (e2e encounter narrative — has its own plan), and the landed
57/65 vacuous-guards work. Bug hunting is out of scope; a flaky or wrong
test is a `bugsSideList` entry, not a finding.
