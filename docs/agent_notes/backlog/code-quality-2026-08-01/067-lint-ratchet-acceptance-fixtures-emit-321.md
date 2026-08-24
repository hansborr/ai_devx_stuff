# 67. Five lint-ratchet acceptance fixture writers emit 321 lines of private, already-divergent copies of the package's exported config types

Status: Landed on fix/cq-067
Theme: fixture type single-sourcing · Area: tests · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The lint-ratchet acceptance suites build sandbox repos whose generated
`scripts/lint-ratchet/lint-ratchet-config.ts` is supposed to look like a real
adopter's registry. Instead of importing the portable package's config-type
vocabulary, each of the five fixture writers — one in the Vitest output suite
and four in the shell acceptance suite — emits its own private facsimile of
`@musi/lint-ratchet`'s `config-types` module before the two value exports the
engine actually reads. That is 321 emitted lines of type declarations across
five writers, all shadowing an 83-line authoritative module that is already on
the package's public exports map and already reachable from every sandbox via
the symlinks the fixtures create anyway.

The copies have already drifted. The authority grew `allowEmpty`, the
`typeAwareProject` field with its three-arm config union, and the full
three-member metric union; none of the five copies carries any of them, each
copy pins the metric union to whatever subset its own fixture happens to use,
three copies dropped the `core` rule source entirely, and all five export a
`LintRatchetPluginExport` type the authority deliberately keeps private. So the
fixtures — the closest thing the repo has to a worked adopter example, in a
package whose public copyability is an explicit repo goal — document an
obsolete authoring surface, and every future evolution of the config types asks
a contributor to find and hand-edit five scattered copies (four of them inside
shell heredocs) or, more likely, to skip them and widen the drift.

## Evidence

- `scripts/lint-ratchet/output.test.ts:155-243` — `writeFixtureRatchetConfig`
  emits a full private type preamble (`JsonPrimitive`/`JsonValue`, mode,
  metric, parser-profile, disposition, source, config-base, config union,
  allowlist-entry types) at `:165-223` before the two value exports at
  `:224-239`.
- `scripts/tests/test-lint-ratchet.sh` — four shell writers repeat the same
  preamble inside heredocs: `write_third_party_config` (`:3483`, emitting
  `:3509-3571`), `write_core_config` (`:3593`, emitting `:3601-3672`),
  `write_max_lines_config` (`:3691`, emitting `:3695-3757`),
  `write_type_assertion_config` (`:3774`, emitting `:3779-3841`).
- Measured at the pin: the emitted declaration blocks (each type preamble plus
  the allowlist declaration typed against it) total 321 lines — 60 + 63 + 72 +
  63 + 63 — versus the 83-line authority
  `tools/lint-ratchet/src/kernel/config-types.ts`.
- Divergence, authority side: `config-types.ts:18` — full metric union
  `"complexity-severity" | "effective-line-count" | "message-count"`; `:55` —
  `allowEmpty?: boolean`; `:62-77` — three-arm `LintRatchetConfig` union with
  `typeAwareProject`. No copy has any of the three.
- Divergence, copy side: the Vitest copy pins
  `LintRatchetMetric = "message-count"` (`output.test.ts:170`);
  `write_core_config` and `write_max_lines_config` each pin a different
  two-member metric subset (`test-lint-ratchet.sh:3606`, `:3700`);
  `write_third_party_config`'s copy drops `LintRatchetCoreSource` from the
  source union entirely (`:3538-3540`), as do `write_max_lines_config`
  (`:3724-3726`) and `write_type_assertion_config` (`:3808-3810`).
- All five copies `export type LintRatchetPluginExport` (`output.test.ts:172`,
  `test-lint-ratchet.sh:3516`, `:3608`, `:3702`, `:3786`); the authority keeps
  it private (`config-types.ts:20`).
- The real registry already shows the intended shape:
  `scripts/lint-ratchet/lint-ratchet-config.ts:1-4` is
  `import type { LintRatchetConfig, LintRatchetThirdPartyPluginAllowlistEntry } from "@musi/lint-ratchet/kernel/config-types.js"`.
- No new wiring is needed. The Vitest fixture already declares the
  `@musi/lint-ratchet` workspace dep (`output.test.ts:126-144`) and symlinks
  `tools/lint-ratchet` plus `node_modules` into the sandbox (`:297-307`); the
  shell `build_fixture` already creates `node_modules/@musi/lint-ratchet`
  (`test-lint-ratchet.sh:264-267`); and `./kernel/config-types.js` is on the
  package exports map (`tools/lint-ratchet/package.json`).
- Only the two value exports are consumed: every adapter import of
  `./lint-ratchet-config.js` names `lintRatchets` and/or
  `lintRatchetThirdPartyPluginAllowlist` (`scripts/lint-ratchet/default-mode.ts:22`,
  `check-registry.ts:24`, `engine-binding.ts:6`, `modes.ts:48`,
  `post-merge-baseline-preflight.ts:7`). Nothing imports the copied type names,
  so they can vanish without replacement.

## Proposed direction

In each of the five fixture writers — `writeFixtureRatchetConfig`
(`scripts/lint-ratchet/output.test.ts:155-243`) and
`write_third_party_config` (`scripts/tests/test-lint-ratchet.sh:3483`),
`write_core_config` (`:3593`), `write_max_lines_config` (`:3691`),
`write_type_assertion_config` (`:3774`) — delete the emitted private
type-declaration preamble and emit instead the exact header the real registry
uses, mirroring `scripts/lint-ratchet/lint-ratchet-config.ts:1-4`:

```ts
import type {
  LintRatchetConfig,
  LintRatchetThirdPartyPluginAllowlistEntry,
} from "@musi/lint-ratchet/kernel/config-types.js";
```

Keep only the value exports each writer parameterizes:
`lintRatchetThirdPartyPluginAllowlist` (typed
`readonly LintRatchetThirdPartyPluginAllowlistEntry[]`) and the `lintRatchets`
array with its existing `as const satisfies readonly LintRatchetConfig[]`
clause.

- No new wiring is needed (see Evidence): the Vitest sandbox and the shell
  `build_fixture` both already resolve `@musi/lint-ratchet` via symlinks, the
  subpath is already exported, and Bun erases type-only imports at runtime, so
  the engine's dynamic imports of fixture configs are unaffected.
- Both names the header needs are exported from `config-types.ts`. The copies'
  other exported type names (`JsonValue`, `LintRatchetRuleSource`, etc.) have
  no consumer, so they disappear without replacement. Do **not** add an export
  for `LintRatchetPluginExport` to the authority — it is deliberately private
  (`config-types.ts:20`); the allowlist-entry interface suffices, and the
  `zeroBaselineDisposition` object in `write_type_assertion_config`
  (`:3853-3857`) is structurally typed, so no named disposition import is
  needed either.
- All existing fixture values (core/local sources, `minimal-ts`/`type-aware-ts`
  profiles, all three metrics) conform to the real unions, so no value edits
  should be needed. If one ever fails `satisfies` under a future typecheck,
  that is a fixture bug — not a reason to widen the authority's types.
- Verification: for the Vitest side run the six suites that consume the writer,
  in one invocation so they exercise the same worker parallelism the gate does —
  `bun run test:scripts:file -- scripts/lint-ratchet/output-emission.test.ts scripts/lint-ratchet/output-warnings.test.ts scripts/lint-ratchet/output-diagnostics-file.test.ts scripts/lint-ratchet/output-propose.test.ts scripts/lint-ratchet/output-drift.test.ts scripts/lint-ratchet/output-update-collection.test.ts`
  (unit 068 replaced the single `output.test.ts` named at the audit pin);
  `bash scripts/tests/test-lint-ratchet.sh` for the shell
  suite (long-running; background it), plus a grep proving no `JsonPrimitive`
  emission remains in either writer file (10 matching lines across the two
  files at the pin; 0 after — the Vitest writer now lives in
  `scripts/lint-ratchet/output-fixture.test-helper.ts`).

## Scope / caveats

- **Explicitly out of scope:** consolidating the five writers into a shared
  config builder — the 2026-07-25 pack's standing ruling CQ25-113
  ([68-lint-ratchet-fixture-copy-closure.md](../code-quality-2026-07-25/68-lint-ratchet-fixture-copy-closure.md))
  forbids rebuilding shared sandbox/fixture infrastructure, so the writers stay
  independent. Also out of scope: changing any fixture ratchet values, and
  adding a typecheck pass over emitted fixture configs. CQ25-113 is a
  constraint, not a blocker, for this leaf: removing copies of an
  already-exported public type module keeps the sandbox builders independent
  and is outside the ruling's prohibition.
- **Shell heredoc interpolation is the main regression vector.**
  `write_third_party_config`, `write_core_config`, and `write_type_assertion_config` use unquoted heredocs
  (`<<TS`), so the shell interpolates `$` and backticks into the emitted TS.
  The new import line is inert, but any accidental reflow that introduces `$`
  into emitted code corrupts fixtures silently — keep edits to the heredoc
  bodies minimal and re-run the shell suite.
- **Do not claim compile enforcement** in commit or doc prose. Nothing
  type-checks the emitted fixture configs (the fixture tsconfig includes only
  `packages/**/*.ts`), so the win is that fixtures document the real authoring
  surface and type evolution needs zero fixture edits — after this change,
  drift manifests as nothing rather than as stale copies. Relatedly, if a
  future fixture path ever constructs a config without the `@musi` symlink,
  only a later-added typecheck would notice; runtime stays safe because Bun
  erases type-only imports.
- **Sequencing:**
  [068-one-lint-ratchet-acceptance-suite-serializes.md](068-one-lint-ratchet-acceptance-suite-serializes.md)
  reworks a distinct problem in the same `scripts/lint-ratchet/output.test.ts`
  file (32 serialized spawnSync runs). Land in either order, but expect merge
  conflicts in the fixture-writer region if worked concurrently.
- **068 landed first, so this leaf's Vitest-side coordinates have moved.**
  `scripts/lint-ratchet/output.test.ts` no longer exists: 068 split it into six
  `output-*.test.ts` files over a new sibling helper,
  `scripts/lint-ratchet/output-fixture.test-helper.ts`, and relocated
  `writeFixtureRatchetConfig` into that helper **byte-identically** — the
  content fix this leaf asks for was deliberately left undone so 067 could make
  it at the new location. Re-resolve every `output.test.ts:NNN` pin below by
  symbol name against `output-fixture.test-helper.ts`; the writer, the
  `LintRatchetMetric`/`LintRatchetPluginExport` pins, the workspace-dep
  declaration, and the sandbox symlinks all live there now. The four shell
  writers in `scripts/tests/test-lint-ratchet.sh` are untouched by 068.
