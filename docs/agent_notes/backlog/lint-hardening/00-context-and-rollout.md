# Lint Hardening Context And Rollout

Date: 2026-05-16
Status: On-demand rationale

Read this only when the chosen lint-hardening leaf needs provenance from the
external repo review. Implementation agents should read one leaf file directly.

## Source

The plan came from a direct review of external reference repos `ma-toki` and
`hookrail`, checked out under temporary local paths at the time of writing,
plus Musi lint and harness state.

## Core Rationale

Musi already has strong type-aware ESLint plus local architecture rules. The
gap is not "more lint everywhere"; it is a few Clippy-style tripwires for
dangerous primitives and better test-quality linting.

This plan also tracks adjacent structural sensors that act like lint for
agent-facing quality: spell-checking, blob-size policy, manifest policy, and
harness-inventory freshness. Keep those separate from ESLint rule rollout so
ESLint remains focused on code semantics and local architecture constraints.

Important rollout difference: ma-toki can set many Clippy lints to `warn`
because `just lint` runs `cargo clippy --workspace --all-targets -- -D
warnings`, so warnings still fail the lint gate. Musi's `bun run lint` and
`bun run lint:changed` currently do not fail on warnings. Stable Musi rules
therefore need to become `error` or run under a zero-warning gate.

## Direct ma-toki Findings

- ma-toki pins the Rust toolchain in `rust-toolchain.toml` and gates Clippy with
  `cargo clippy --workspace --all-targets -- -D warnings` from `justfile` and
  `scripts/verify.sh`.
- Workspace lint policy lives centrally in `Cargo.toml`: correctness/perf are
  denied, pedantic is warned, and selected footguns are added one at a time
  (`unwrap_used`, `panic`, `assertions_on_result_states`, `indexing_slicing`,
  `allow_attributes_without_reason`, async lock/future lints, unsafe-comment
  hygiene, float/numeric lints).
- `clippy.toml` carries the agent-tuned primitive bans as data with required
  reason text: `std::process::exit`, `std::process::abort`,
  `tokio::runtime::Runtime::new`, `tokio::runtime::Handle::block_on`, and
  `futures::executor::block_on`.
- ma-toki explicitly deferred tempting bans until helper boundaries exist:
  direct env reads, direct clock reads, direct NATS publish, direct SQLx query
  calls, and snowflake-generator construction. The useful rule is to ban a
  primitive only when the diagnostic can name a sanctioned path.
- Its suppression register is current-state, not only diff-scoped: it scans
  Rust allow/expect attributes, ESLint disables, and TypeScript directives;
  reports by lint and crate/package; has JSON and `missing-only` output; and
  hard-fails only in checked mode.
- Its assertion-quality lesson comes from avoiding assertions that only print
  boolean state. The direct TypeScript analogue in Musi is Zod
  `safeParse(...).success` assertions, not a broad ban on all boolean
  expectations.
- ma-toki does not prove the Vitest plugin idea. It uses Vitest in the web
  package but has no Vitest ESLint plugin. That candidate remains a Musi-native
  gap.
- ma-toki's changed-lint flow has a useful staged-content lesson for Musi:
  prefer staged TS paths, reject staged lint targets with unstaged edits, and
  pass `--max-warnings=0`.
- ma-toki adds structural checks that are not ESLint rules: codespell with a
  domain dictionary, ASCII/smart-character hygiene for high-signal docs, staged
  blob-size checks with reasoned allowlist entries, manifest policy checks,
  architecture-boundary config checks, and an AI-harness inventory freshness
  scan.

## Direct hookrail Findings

- hookrail reinforces the zero-warning lesson with `cargo clippy --workspace
  --all-targets -- -D warnings`, plus `cargo deny check` as a separate
  dependency/license/source policy gate.
- Its protected-file and doc-length advisories are deliberately not code lints:
  they fire as agent-hook context around edits to global config, hooks, harness
  docs, and startup-context docs. Musi already has equivalents, so treat them
  as adjacent sensors, not ESLint candidates.
- Its policy block is command-level safety, not source lint. Musi already has
  similar shell-hook policy; no extra ESLint work follows from it.
- Its `docs/ai-harness.md` promotion rule is useful for any new Musi sensor:
  every control should have a guide, a deterministic sensor/gate, and repair
  text or a codemod.

## Non-Goals

- Do not copy Rust lints literally into TypeScript.
- Do not ban a primitive until a sanctioned helper or scope exception exists.
- Do not add lint rules that merely encode personal style.
- Do not put slow semantic scans into pre-commit.
- Do not turn structural sensors like spell-check, blob-size, or harness
  freshness into ESLint rules.
- Do not replace mutation testing or approved behavior fixtures with test
  linting.
- Do not adopt broad plugin presets (`eslint-plugin-unicorn`,
  `eslint-plugin-sonarjs`, `eslint-plugin-promise`, full
  `eslint-plugin-react`) wholesale. Cherry-pick only when a specific
  footgun is observed in a postmortem or code-review and no existing
  rule covers it. See Leaf 27 for the protocol.

## Contributor-Experience Framing

This workstream optimizes the *failure-time* experience, not the
*config-reading* experience. Contributors and AI agents are not expected
to read `eslint.config.js`. They are expected to read the diagnostic when
lint fails. That means:

- Every rule should have a clear message and, where useful, a named
  alternative or guide reference.
- When a rule fires legitimately on a real bug or smell, fix the code.
  This is the right response for strong-semantic rules — local Musi rules,
  `typescript-eslint` correctness rules, accessibility rules with clear
  remediation.
- When a rule fires on intentional code, silence with a single-line
  `// eslint-disable-next-line <rule> -- <reason>` directive. Do not weaken
  rules globally to avoid churn — global weakening cancels the leverage
  that justifies adding the rule.
- When a broad ecosystem-plugin rule fires *repeatedly* on intentional
  patterns, that is signal about rule fit, not signal to disable
  everywhere. Drop the rule from the chosen subset and record the verdict
  in the leaf. The goal is "fix real findings; scope or reject rules that
  cannot explain a real bug or smell."

## Current Musi State

- Type-aware ESLint is enabled through `typescript-eslint` strict checked
  config.
- Local rules already cover async array callbacks, swallowed console-only
  catches, explicit `any`, tRPC schemas, socket broadcasts, Prisma concurrency,
  shared runtime neutrality, e2e selector shape, max effective lines, and test
  file location.
- Suppression hygiene exists in `scripts/eslint-disable-register.sh` and
  `bun run drift:ai --check suppressions`.
- Vitest is installed, but no Vitest ESLint plugin is currently configured.
- `bun run lint` and `bun run lint:changed` run ESLint without
  `--max-warnings=0`.
- Musi already has protected-file advisories, doc-length advisories, dependency
  freshness checks, Prisma client freshness checks, and a Prisma migration
  safety scanner.
- Musi does not currently have a spell-check gate, ASCII/smart-character check
  for hot docs, staged blob-size policy, package manifest policy verifier, or
  `docs/ai-harness.md` freshness checker.
