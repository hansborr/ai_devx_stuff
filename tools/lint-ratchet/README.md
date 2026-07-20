# @musi/lint-ratchet

A portable, repo-agnostic lint-ratchet engine. It is a source-only workspace
package (no build step): consumers run under Bun and import the TypeScript
sources directly through per-layer subpath exports.

## Layers

- `kernel/` — baseline codec, current-state collection, comparison, update, and
  the injected engine context (`LintRatchetEngineContext`).
- `git-rail/` — pure merge-driver operations, merge-driver presence checks, and
  the `.git/info/attributes` block renderer.
- `governance/` — debt log, zero-baseline lifecycle audit, trend, summary,
  propose, edit-check, retirement, baseline debt-accounting, the shared
  `WorseBaselineError`, and the neutral gate/update application operations
  (`operations.js`: hashes → collect → build/compare → round-trip-validate →
  gated apply, as pure data-in/data-out functions).

The package carries **layers 1–3 only**. The repo adapter — registry data,
path/context construction, harness wiring, CLI composition, and the
harness-diagnostics envelope render — stays outside the package (in Musi it
lives under `scripts/`). See
`docs/agent_notes/backlog/lint-arch-review-2026-07/02-slice-plan.md`.

## Adopting it

Copy `tools/lint-ratchet` into your repo, declare its dependencies, and write a
thin adapter that:

1. constructs a `LintRatchetEngineContext` for your repository, and
2. supplies your own ratchet registry.

`examples/lint-ratchet-demo` is a second, non-Musi adapter that proves the seam.

## Supported entry points

`package.json#exports` enumerates every supported subpath — exact keys, no
wildcards (lint-arch leaf 14). The exports map is the machine-readable
authority; this section explains what each entry is *for*. Everything under
`src/` that is not listed is package-private: an unlisted import fails module
resolution at typecheck and test time. Adding an entry point is a contract
review, not a convenience; the `enumerated exports contract` test in
`test/package-structure.test.ts` pins the shape, imports every entry, and
proves private modules stay unimportable.

### kernel/ — engine binding and the sensor toolkit

- `kernel/engine-context.js` — construct the injected `LintRatchetEngineContext` an adapter binds the engine with.
- `kernel/config-types.js` — the registry/config type vocabulary adapters author their ratchet registry in.
- `kernel/runtime-config.js` — runtime-config resolution for the bound engine.
- `kernel/baseline.js` — the committed baseline codec: parse, serialize, validate.
- `kernel/baseline-constants.js` — baseline wire-format version constants for fixtures and tooling.
- `kernel/baseline-compare.js` — compare two baselines and classify regressions/improvements.
- `kernel/baseline-merge.js` — three-way semantic baseline merge used by the merge driver.
- `kernel/merge.js` — the whole-document merge facade sensors bind their merge CLIs to.
- `kernel/current-collector.js` — collect current lint state for comparison against the baseline.
- `kernel/eslint-runner.js` — the ESLint invocation seam behind the collector; adapter tests mock it here.
- `kernel/eslint-config.js` — build the engine's ESLint flat config (rule probing, collection).
- `kernel/gate.js` — the symmetric item-keyed gate: worse fails, better requires baseline lock-in.
- `kernel/entry-baseline.js` — the flat item-keyed baseline facade custom sensors build on.
- `kernel/group-baseline.js` — grouped-baseline operations behind the flat facade.
- `kernel/single-group-spec.js` — declare a single-group baseline spec for one-metric sensors.
- `kernel/zero-baseline-types.js` — disposition types for zero-baseline (rule-at-zero) policies.
- `kernel/ratchet-globs.js` — the glob matcher shared by registry ratchets and baseline coverage checks.
- `kernel/git-tracked-files.js` — deterministic tracked-file enumeration that defines collection order.
- `kernel/rule-source.js` — resolve which config source declares each ratcheted rule.
- `kernel/rule-source-drift.js` — detect drift between baseline rule sources and the live config.
- `kernel/removed-path-improvements.js` — classify baseline entries freed by deleted paths.
- `kernel/recovery-command.js` — the single source of truth for baseline-update recovery commands in output.
- `kernel/metrics-types.js` — shared metric/result types and `ConfigError`.
- `kernel/markdown-escape.js` — markdown escaping that keeps engine finding prose (inline code spans) intact in reports.

### kernel/ — utility contract

Generic helpers the engine uses internally, exported for adapter convenience;
they are deliberately *not* part of the engine contract and adapters should
funnel them through one local seam (Musi: `scripts/lib/*.ts`).

- `kernel/atomic-write.js` — reader-atomic same-directory temp+rename file replacement.
- `kernel/codepoint-compare.js` — locale-independent codepoint comparator for byte-stable committed artifacts.
- `kernel/eslint-json.js` — defensive parser for ESLint `--format=json` output (single shared implementation; forks drifted before).

### git-rail/ — merge-driver integration

- `git-rail/merge-cli.js` — the merge-driver CLI kernel sensors wrap into their `%O %A %B` entry points.
- `git-rail/merge-driver-presence.js` — detect whether the clone has the baseline merge driver installed.
- `git-rail/info-attributes.js` — render the managed `.git/info/attributes` block.

### governance/ — lifecycle operations

- `governance/operations.js` — the neutral gate/update application pipeline (hashes → collect → compare → validate → apply).
- `governance/propose.js` — propose a baseline update as reviewable data.
- `governance/baseline-update-apply.js` — apply an accepted baseline update.
- `governance/edit-check.js` — validate a hand-edited baseline against policy.
- `governance/edit-check-protocol.js` — the wire protocol types for edit-check hook bindings.
- `governance/debt-log.js` — read and query the append-only accepted-debt log.
- `governance/baseline-debt-accounting-git.js` — git-derived debt-accounting reconciliation check.
- `governance/zero-baseline.js` — audit the zero-baseline lifecycle (rules pinned at zero).
- `governance/retire-update.js` — retire a ratchet with its promotion proof.
- `governance/ratchet-coverage.js` — report which tracked files each ratchet covers.
- `governance/trend.js` — debt trend series derived from baseline history.
- `governance/summary.js` — render the human-facing ratchet summary.
- `governance/errors.js` — the shared governance error taxonomy (`WorseBaselineError`, …).

## Boundary invariant

Every `.ts` under this directory — the sole exception being the pinned repo
test-runner config (`vitest.config.ts`), which an adopter replaces — may import
only: a relative or self (`@musi/lint-ratchet/…`) specifier that **resolves to
an existing file** inside the package (self-imports through the `exports` map),
a `node:`/`bun:` built-in on the explicit engine allowlist, or a bare specifier
whose package root is a declared, portably-versioned dependency in this
`package.json`. No `@musi/*` other than this package itself, no repo-relative
reach, no unresolved import. The boundary checker is resolver-aware and
fail-closed; its exception set is sealed (see `ALLOWED_IGNORE_PATHS`) and the
`package structure` test pins it so no engine or test file can be excluded.
