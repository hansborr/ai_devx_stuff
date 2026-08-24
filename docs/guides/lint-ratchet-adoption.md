# Lint Ratchet Adoption

This guide is for projects outside this repository that want to copy and adapt
the lint ratchet. It presents two adoption tiers, explains the runtime copy
model for each, and names the ongoing ownership cost.

For the operator reference — commands, zero-baseline lifecycle, and adding a
ratchet — see [Lint Ratchet](lint-ratchet.md). For the internals — metrics,
baseline identity, parser profiles, CI parity, and the coverage map — see the
[Lint Ratchet Reference](lint-ratchet-reference.md).

For a ready-made worked copy to diff against,
[`examples/lint-ratchet-demo/`](../../examples/lint-ratchet-demo/) is a minimal
workspace consumer of the `@musi/lint-ratchet` package — a thin adapter binding
the engine to one rule — proving the engine copies and adopts cleanly.

## How the ratchet works

The ratchet has three pieces:

1. A **registry** of scoped rules. Each entry names the ESLint rule, source
   kind, parser profile, file globs, ignore globs, options, mode, metric, and
   principle. Local-rule repair guidance separately lives in
   `meta.docs.repairKind`; it is not a registry field.
2. A **committed per-file baseline**. `lint-ratchet.baseline.json` records each
   ratcheted file's current count or metric payload, plus config and rule-source
   hashes.
3. A **symmetric gate** that fails on both sides of drift. Regressions fail
   because current findings are above the committed floor; un-reflected
   improvements also fail because current findings are below the baseline and
   must be locked in with `lint:ratchet:update`.

The gate is the key property: debt cannot grow silently, and cleanup cannot go
unacknowledged.

### The grouped baseline kernel is reusable

The committed-baseline + symmetric-gate + three-way-merge machinery is not
ratchet-specific. Its shared kernel lives in the `@musi/lint-ratchet` package
(`tools/lint-ratchet/src/kernel/`). A
`GroupedBaselineSpec` injects the document family, versions, group metadata,
item codec, ordering, comparison, and merge policy; the kernel owns envelope
parsing, deterministic formatting, symmetric comparison, semantic-minimum
merge, and item lifecycle. `singleGroupSpec` adapts the same kernel to flat
entry documents without changing their bytes.

The ratchet is now one grouped-spec consumer, not a parallel parser/comparator/
merge stack. The knip unused-export sensor uses the flat adapter for an
**identity ledger** keyed by `(category, path, symbol)`, so swapping one unused
symbol for another — invisible to a count-only floor — fails the gate.
Max-lines and near-duplicates use the same flat compatibility surface. All
consumers use the package's `@musi/lint-ratchet/kernel/atomic-write.js`;
generated baseline and ESLint-config readers never observe a truncated
replacement.

The exact kernel and Git-rail exports the package carries are listed in the
reference's
[Shared baseline kernel](lint-ratchet-reference.md#shared-baseline-kernel)
section. Copy `tools/lint-ratchet/` as a unit; do not rebuild a ratchet-only
baseline stack in the adopting repository.

## Tier 1 — Minimal ratchet

The minimal tier gives you the gate, baseline, and registry. No prescribed
agent envelope, no coverage map, no post-edit hooks, no CI reporting. The
package returns typed results; your adapter decides whether and how to render a
machine-readable result envelope. The demo deliberately renders its own small
JSON shape rather than Musi's `HarnessDiagnostics` envelope, proving that output
format stays outside the engine.

### What to copy

The engine is a self-contained package. Copy the **whole directory** — no manual
file selection, no copy manifest — and bind it with a thin adapter you write:

| Item | Role |
| --- | --- |
| `tools/lint-ratchet/` | The portable engine (kernel + git-rail + governance). Copy it verbatim into your repo, or add it as a dependency; it carries no `@musi/*` or repo-relative imports. Its `package.json#exports` map enumerates every supported entry point as an exact per-layer subpath key (`@musi/lint-ratchet/kernel/<module>.js`, `/git-rail/<module>.js`, `/governance/<module>.js` — no wildcards); that enumerated set is the whole API, and the package README's exports inventory is the authoritative list. |
| A thin adapter (you write it) | Construct a `LintRatchetEngineContext`/`LintRatchetEngineBinding` over your repo root, declare your registry (`LintRatchetConfig[]`), and render whatever result envelope your CI wants. The demo's `examples/lint-ratchet-demo/scripts/lint-ratchet.ts` + `examples/lint-ratchet-demo/scripts/lint-ratchet/adapter.ts` is a minimal, working template to diff against. |
| Merge driver (recommended): the package git-rail executable | Export `lintRatchetGitRailAdapter` from your adapter and copy the demo's git-rail package scripts. The package owns install/check, semantic merge, preflight, post-merge truth-up, and stage restore; adopters vendor no operational scripts. |
| `lint-ratchet.baseline.json` | Start with `{ "version": 2, "regenerate": "bun run lint:ratchet:update", "tests": {} }`, then `lint:ratchet:update` to populate it against your toolchain. |

The engine no longer ships a copy manifest or a demo sync-checker: because
`tools/lint-ratchet/` is a real package with an import boundary, "the portable
surface" is just the package directory. The `examples/lint-ratchet-demo/` consumer
is the worked template, and its `smoke.sh` proves the whole copy-and-run path in
isolation.

### Merge-driver wiring (recommended)

The package-owned merge driver needs repository wiring before Git will use it:

1. Add these rows to `.gitattributes`:

   ```gitattributes
   /lint-ratchet.baseline.json merge=lint-ratchet-baseline
   /lint-ratchet.debt-log.jsonl merge=union
   ```
2. Copy the demo's `lint:ratchet:install-merge-driver` and
   `lint:ratchet:merge-driver:check` package scripts, changing only the adapter
   module path if yours differs. Run the installer from `prepare`, or once for
   every clone and worktree: it generates a marked bootstrap in the Git common
   directory and records the fixed Git command.
3. Invoke the demo's `lint:ratchet:post-merge` package script from `post-merge`.
   Invoke it with `post-commit` from that hook too, so a marker left by a
   completed cherry-pick or rebase is validated and consumed.

See the [Lint Ratchet Merge Runbook](lint-ratchet-merges.md) for why a textual JSON
merge is unsafe and how the semantic minimum merge and truth-up check preserve
the stricter floor. The runtime's merge-driver advisory runs only during
`lint:ratchet:update` and `lint:ratchet:check-baseline`; bind it to the package's
`check` operation as the demo does, so an omitted local installation still
produces the repair command.

In a normal installed dependency, those scripts can call the package bin
directly. The in-repository demo uses the equivalent exported function because
Bun does not link workspace package bins; its fresh-install smoke asserts that
behavior so this longer workspace-only invocation cannot become stale folklore:

```json
{
  "scripts": {
    "lint:ratchet:install-merge-driver": "bun -e 'import(\"@musi/lint-ratchet/git-rail/executable-cli.js\").then(module => module.runLintRatchetGitRailCliMain(process.argv.slice(1)))' -- install --adapter scripts/lint-ratchet/adapter.ts --repair-command 'bun run lint:ratchet:install-merge-driver'",
    "lint:ratchet:merge-driver:check": "bun -e 'import(\"@musi/lint-ratchet/git-rail/executable-cli.js\").then(module => module.runLintRatchetGitRailCliMain(process.argv.slice(1)))' -- check --adapter scripts/lint-ratchet/adapter.ts --repair-command 'bun run lint:ratchet:install-merge-driver'",
    "lint:ratchet:post-merge": "bun -e 'import(\"@musi/lint-ratchet/git-rail/executable-cli.js\").then(module => module.runLintRatchetGitRailCliMain(process.argv.slice(1)))' -- post-merge --adapter scripts/lint-ratchet/adapter.ts --"
  }
}
```

### Runtime assumptions

The copied runner is portable, but not package-manager neutral internals. It
currently assumes:

- a Git repository, because registry preflight, collection, zero-baseline
  checks, and the coverage-map companion use `git ls-files`;
- intended ratchet files are tracked before you rely on empty-glob, collection,
  or lifecycle checks; untracked matching files are not counted by the ratchet
  gate;
- a classic `node_modules` layout for package-version reads and cache storage:
  the runner resolves ESLint's installed JavaScript entry and launches it with
  `process.execPath`, while plugin and ESLint versions are read from
  `node_modules/<package>/package.json` and generated configs/caches live under
  `node_modules/.cache/eslint-ratchet/`;
- a POSIX environment with Bash and util-linux `flock` for the optional
  merge-driver wiring. The generated bootstrap uses no Bash-4-only features,
  so stock macOS Bash 3.2 is sufficient; install `flock` with
  `brew install flock` (or util-linux). Native Windows is untested; use WSL as
  the expected adoption path;
- generated isolated ESLint configs, not the project's normal flat config with
  one extra rule enabled. A type-aware ratchet uses `projectService: true` by
  default; set its registry `typeAwareProject` to a repo-relative tsconfig for
  custom TypeScript project setup. Rules that need project `settings`, globals,
  processors, or import resolvers require changes to the generated-config
  kernel in `tools/lint-ratchet/src/kernel/eslint-config.ts`;
- relative `files` and `ignores` patterns evaluated by Minimatch with
  `{ dot: true }`, so normal minimatch syntax and dot-prefixed paths are
  supported. Registry preflight checks every `files` pattern against tracked
  files and reports a `dead-glob` when any one matches nothing, then checks the
  combined scope after ignores; `allowEmpty: true` waives both checks.

Yarn PnP, global ESLint installs, non-Git source trees, and unusual cache roots
are supportable, but they require adapter changes rather than only package
script changes.

When upgrading a pre-H23 copy that relied on the former scripts-only
type-aware default, set `typeAwareProject: "./tsconfig.scripts.json"` on those
entries and run the normal baseline update before replacing the kernel.
Otherwise their generated config switches to `projectService: true`. The old
implicit choice was not represented in `configHash`, so an unchanged finding
count—especially a zero floor—does not prove that the same TypeScript program
was checked.

### What to change

1. **Declare your registry.** In your adapter (see the demo's
   `scripts/lint-ratchet/adapter.ts`), import `LintRatchetConfig` from
   `@musi/lint-ratchet/kernel/config-types.js` and declare your own `lintRatchets`
   array — no Musi imports, no shared-policy globs — with one entry:

   ```ts
   export const lintRatchets = [
     {
       id: "ratchet/core-no-console-src",
       ruleId: "no-console",
       source: { kind: "core" },
       parserProfile: "minimal-ts",
       files: ["src/**/*.ts", "src/**/*.tsx"],
       ignores: ["src/**/*.test.ts", "src/**/*.test.tsx", "src/generated/**"],
       ruleOptions: [{ allow: ["warn", "error"] }],
       mode: "no-new",
       metric: "message-count",
       principle: "Keep console output from growing beyond today's intentional logging and debug debt.",
     },
   ] as const satisfies readonly LintRatchetConfig[];
   ```

   Use `mode: "no-new"` (the only mode) so the entry writes a committed floor
   and fails on unacknowledged drift. Before committing a new entry, you can run
   `bun run lint:ratchet -- --propose <ruleId> <glob...>` for a core,
   `local/<rule-name>`, or third-party rule to print current counts and the
   would-be baseline without editing the registry or committed baseline — the
   discovery use case the removed `report-only` mode once served. For a
   third-party namespace not yet in the adapter allowlist, pass
   `--plugin <package>` and optional `--plugin-export <default|plugin>`; the
   preview prints the allowlist entry that promotion requires. Add
   `--parser-profile type-aware-ts` only when the rule needs type information;
   project-service setup makes broad preview globs materially slower.

2. **Choose the adapter's third-party policy.** Set the binding's
   `thirdPartyPluginAllowlist` to `[]` unless you are ratcheting third-party
   plugin rules from the start. If you do need plugins, declare an adopter-owned
   allowlist beside your registry and pass it through the binding in step 3; do
   not copy or edit Musi's registry module.

3. **Build your repository adapter.** In `scripts/lint-ratchet/adapter.ts` (or
   your own equivalent), import `createLintRatchetEngineContext` plus the
   `LintRatchetEngineContext`, `LintRatchetEngineBinding`, and
   `LintRatchetWorkflowVocabulary` types from
   `@musi/lint-ratchet/kernel/engine-context.js`. Bind the repository root,
   baseline/debt-log paths, and the commands your repository actually exposes
   for update, accepted-debt update, merge-driver installation, baseline-side
   restoration, and complete trend history. Export that vocabulary with the
   context, binding, and `LintRatchetConfig[]` registry from step 1. The demo's
   `examples/lint-ratchet-demo/scripts/lint-ratchet/adapter.ts` is the complete
   working example.

   Do not copy, delete, or stub Musi's
   `scripts/lint-ratchet/registry-builders.ts` or
   `scripts/lib/lint-rule-docs.ts`: neither file is part of the package an
   adopter receives. They are conveniences and policy owned by Musi's adapter.
   If your adapter ratchets local rules, validate the local rule ids and any
   metadata policy you choose in that adapter; core-only and third-party-only
   adapters need no local-rule-docs stub.

4. **Write the entry CLI and its result format.** Compose the package's kernel
   and governance operations against the context, binding, and registry from
   step 3, then translate their typed results and errors into the exit codes and
   output shape your project needs. Start from
   `examples/lint-ratchet-demo/scripts/lint-ratchet.ts`, which wires gate,
   registry-check, baseline-check, update, and propose modes while rendering a
   demo-owned JSON envelope. A package-copy adopter does not receive Musi's
   `scripts/harness/harness-diagnostics-output.ts` emission-kernel writer or its
   `HarnessDiagnostics` schema and does not need to recreate either one — Tier 1
   has no prescribed agent envelope, and the demo's own small JSON shape proves
   that. Adopters who want Musi's envelope instead of their own shape can copy
   the portable `tools/harness-diagnostics` package (`@musi/harness-diagnostics`)
   directly; see Tier 2's agent-envelope row below and `docs/ai-harness.md`'s
   Portable Core map.

5. **Add package scripts:**

   ```json
   {
     "baseline:restore-stage": "<package git-rail executable> restore-stage --allow-baseline lint-ratchet.baseline.json --",
     "lint:ratchet": "bun scripts/lint-ratchet.ts",
     "lint:ratchet:check-baseline": "bun scripts/lint-ratchet.ts --check-baseline",
     "lint:ratchet:check-registry": "bun scripts/lint-ratchet.ts --check-registry",
     "lint:ratchet:install-merge-driver": "<package git-rail executable> install --adapter scripts/lint-ratchet/adapter.ts",
     "lint:ratchet:merge-driver:check": "<package git-rail executable> check --adapter scripts/lint-ratchet/adapter.ts",
     "lint:ratchet:post-merge": "<package git-rail executable> post-merge --adapter scripts/lint-ratchet/adapter.ts --",
     "lint:ratchet:update": "bun scripts/lint-ratchet.ts --update"
   }
   ```

   Replace `<package git-rail executable>` with the invocation used verbatim by
   the demo's `package.json`; the placeholder keeps this guide readable. Four
   scripts dispatch the adopter's TypeScript CLI (gate, baseline check, registry
   check, and update), while restore/install/check/post-merge dispatch the
   package rail. Invoke the post-merge script with `post-merge` or `post-commit`
   from the corresponding hook. The CLI also accepts
   `--propose <ruleId> <glob...>` directly, without a dedicated package-script
   alias. Musi's adapter additionally implements `report`,
   `summary`, `trend`, and `zero-baseline`, but copying those package-script
   names alone does not add the modes; extend the adopter's CLI and tests before
   registering any of them.

   The main runtime path uses plain TypeScript rather than Bun-only APIs, but
   the portability fixtures exercise only `bun`. Treat `npx tsx`,
   `pnpm exec tsx`, and other runners as untested substitutions.

6. **Run the adoption sequence.** Use a Git worktree with the intended files
   tracked:

   ```sh
   bun run lint:ratchet:check-registry   # prove the registry is valid
   bun run lint:ratchet:install-merge-driver # install the semantic Git driver
   bun run lint:ratchet:update           # generate the initial baseline
   bun run lint:ratchet                  # prove the gate passes
   ```

### What to copy for tests

The engine's own tests travel with the package: `tools/lint-ratchet/test/` and
the co-located `src/**/*.test.ts` cover baseline building/parsing/comparison,
update decisions, hashing, registry validation, the semantic merge, the
governance layer (debt-log schema/write/accounting, summary, trend,
zero-baseline, propose, retire, and the edit-time check's guard behavior), and
— in `test/boundary/` + `test/fixture-context.test.ts` — the structural proofs
that the package is self-contained and consumable with a non-Musi registry. You get all of
that by copying `tools/lint-ratchet/`; run them with the package's `vitest.config.ts`.

For your **adapter**, write one small end-to-end test like the demo's `smoke.sh`:
seed a fixture repo, run collect→compare→update through your registry/binding, and
assert the gate behaves. You are testing your wiring, not the engine.

### What you own afterward

- **Baseline maintenance.** Renames move baseline keys; improvements require
  `lint:ratchet:update`. Both are mechanical but must happen in the same commit
  or PR as the source change.
- **Zero-baseline decisions.** When a ratchet reaches zero findings, you decide
  whether to promote the rule into normal ESLint, keep the ratchet with a
  documented disposition, or narrow the scope. The package carries the
  zero-baseline governance operation, but the demo CLI does not expose it. Add
  and test an adapter mode before registering a `lint:ratchet:zero-baseline`
  gate; Musi's adapter is one complete implementation.
- **Registry coherence.** Adding, removing, or changing a ratchet entry requires
  `lint:ratchet:update` to refresh the baseline. The `check-registry` preflight
  catches structural problems before an ESLint run.
- **Dependency updates.** Rule-source hashes fold in dependency identity, so
  upgrades re-baseline explicitly instead of silently shifting counts. An ESLint
  upgrade re-keys every ratchet. A typescript-eslint upgrade also re-keys every
  ratchet (every generated config parses with `tseslint.parser`). A
  ratcheted third-party plugin upgrade re-keys that plugin's ratchets. A
  TypeScript upgrade re-keys type-aware (`type-aware-ts`) third-party ratchets. tsconfig
  edits are not hashed (see the "Baseline identity" section of
  `docs/guides/lint-ratchet-reference.md`): they shift type-aware findings and surface as a
  plain gate failure that `lint:ratchet:update` clears. The gate fails until you
  re-baseline, so every re-key is explicit.
- **Engine upkeep.** When you pull an upstream engine change, re-copy
  `tools/lint-ratchet/` wholesale — there is no per-file inventory to reconcile,
  because the package boundary is the portable surface.

### Staying in sync

Copy-paste adoption has no automatic upgrade path. That is the deliberate cost
of copying a reference instead of depending on a published package: you own a
fork, and upstream correctness fixes do not flow to you on their own.

The set of files you copied is one directory, `tools/lint-ratchet/`, plus your
own adapter and git-rail wrappers. Use the package directory as your sync anchor.

To pull upstream correctness fixes:

1. Watch this repo's history for changes under `tools/lint-ratchet/` —
   `git log -- tools/lint-ratchet` — and diff against your copy.
2. Re-copy the package wholesale, or cherry-pick the fixes, reconciling against
   any local edits you made. You own the reconciliation, because you own your
   fork. Your adapter is yours and rarely needs upstream changes.

If you re-copy the engine wholesale, regenerate the baseline afterward with
`lint:ratchet:update`, since renames, counts, or the rule-source identity may
have shifted upstream.

## Tier 2 — Full platform

The full tier adds the coverage map, agent envelope, post-edit hooks, CI
reporting, and custom guidance pipeline on top of Tier 1.

### Additional pieces

| Surface | Key files | What it does |
| --- | --- | --- |
| Coverage map | `scripts/lint-coverage-map-manifest.ts` (+ the `-manifest-<area>.ts` entry modules), `scripts/lint-coverage-map-manifest-schema.ts`, `scripts/lint-coverage-map-check.ts`, `scripts/lint-coverage-map-check-eslint-reach.ts`, `scripts/lint-coverage-map-gen.ts` | Proves every tracked maintained file is accounted for by a lint owner (normal lint, ratchet, exclusion, or named blocker). Policy is a Zod-validated typed manifest; `docs/generated/lint-coverage-map.md` is rendered from it. Catches stale globs, rotted file counts, unknown ratchet ids, and ESLint reach gaps in both directions. |
| Agent envelope | `scripts/lint-agent.ts`, `scripts/lint-agent-guidance.ts`, `scripts/lint-agent-changed.sh`, the `tools/harness-diagnostics` package (`@musi/harness-diagnostics`) | Emits structured `HarnessDiagnostics` JSON for `local/*`, selected core/plugin steering findings, and parser errors, scoped to changed files. Non-overlaid findings remain info disclosures. Agents and hooks consume this selected view alongside full lint output. |
| Musi custom-guidance adapter | `scripts/lib/lint-rule-docs.ts`, `scripts/generate-lint-guidance.ts`, `docs/generated/local-lint-rules.md` | Validates and publishes `meta.docs` metadata from local rules: description, principle, category, paired guide, repair kind. |
| Post-edit hooks | `scripts/ai-hooks/tidy-edited-file.sh`, `scripts/ai-hooks/common.sh`, `.claude/hooks/`, `.codex/hooks/` | Runs Prettier + `eslint --fix` on files an agent just edited. Non-blocking, bounded, skips unsafe paths. |
| CI report | `lint:ratchet:report` command, CI workflow steps | Renders the diagnostics envelope as a GitHub step summary and sticky PR comment with recovery instructions. |

### Additional ownership cost

Everything in Tier 1, plus:

- **Coverage map maintenance.** When you add files, directories, or ratchets,
  update the manifest entry that owns them and run the map gate; the Markdown
  document is generated output, never hand-edited. The checker validates the
  typed entries against the live tree — globs that match nothing, file counts
  that no longer add up, unknown ratchet ids, and reach disagreements.
- **Local rule metadata.** Each `local/*` rule needs `meta.docs` with
  `description`, `principle`, `category`, `pairedGuide`, and `repairKind`. The
  guidance generator and agent envelope depend on this vocabulary.
- **Hook compatibility.** The post-edit hook runs per-file Prettier and ESLint.
  Formatter or import-sort ownership changes (e.g., moving to Biome) require
  hook updates.
- **CI workflow wiring.** The sticky PR comment, step summary, and artifact
  upload need workflow maintenance when you change action versions, repository
  permissions, or the diagnostics envelope shape.

## Config-surface manifest adoption

Musi keeps unusual maintained configuration files in
`eslint-config/config-surface-manifest.json`. The useful pattern is not the JSON
file by itself; it is one authored inventory feeding every consumer that must
agree about ESLint reach, TypeScript parser ownership, coverage, and freshness.
Copying only the manifest creates an inert list and loses that property.

```mermaid
flowchart LR
    manifest["config-surface-manifest.json<br/>authored inventory"] --> loader["validate + derive groups<br/>essential"]
    loader --> eslint["ESLint re-includes + parser config<br/>essential"]
    loader --> tsfiles["TypeScript config paths"]
    tsfiles --> generator["config-surface generator"]
    generator --> tsconfig["tsconfig.configs.json<br/>generated; never hand-edit"]
    loader --> coverage["coverage/existence proof<br/>replaceable"]
    loader --> changed["changed-file path policy<br/>Musi-only adapter"]
    tsconfig --> freshness["freshness gate<br/>replaceable wiring"]
```

### Minimum viable manifest

Start with only the maintained config files that broad ignore patterns or normal
package TypeScript projects would otherwise miss. For example:

```json
{
  "schemaVersion": 1,
  "surfaces": [
    {
      "path": "eslint.config.js",
      "language": "js",
      "group": "root-js",
      "coverageStatus": "linted"
    },
    {
      "path": "vitest.config.ts",
      "language": "ts",
      "group": "root-package-ts",
      "coverageStatus": "linted"
    }
  ]
}
```

The field names and group vocabulary are Musi policy, not a portable schema.
Keep them if they fit, or replace them with the smallest vocabulary that can
derive your ESLint and TypeScript scopes. Validate repo-relative paths,
supported languages/groups, duplicate entries, and claimed coverage status at
load time; a malformed inventory must fail rather than silently narrow lint.

### Consumer and replacement checklist

| Consumer | Adoption status | What the adopter must preserve or replace |
| --- | --- | --- |
| `eslint-config/config-surfaces.js` | Essential pattern | Load and validate the manifest once, then derive named path groups. Replace Musi's four groups and language/status enums with repository-local ones. |
| `eslint-config/path-glob-policy.js`, `base-configs.js`, and `config-file-configs.js` | Essential enforcement | Re-include globally ignored config files, give TypeScript configs a parser project, and verify every entry resolves an ESLint config. Adapt the surrounding flat-config modules rather than copying Musi's package globs. |
| `scripts/harness/generate-config-surfaces.ts` → `tsconfig.configs.json` | Essential for type-aware TS config files; otherwise omit | Generate the dedicated TypeScript project from the manifest's TS entries, or point those entries at an existing checked project. Keep one check mode that fails when the committed output is stale. |
| `scripts/lint-coverage-map-check.ts` | Replaceable proof | Musi checks that each config-surface manifest path is tracked and is claimed by a coverage-manifest entry with the declared status. Use an equivalent inventory/reach check if the adopter has no coverage manifest. |
| `scripts/path-policy/path-policy.ts` | Musi-only adapter | It treats manifest entries as source-relevant changes for staged/changed gate routing. Map the inventory into the adopter's changed-file classifier, or omit this consumer when every gate is whole-tree. |
| `harness.controls.json`, `harness:check`, and pre-commit dependency-freshness tests | Musi-only wiring | Do not copy the control ids. Wire the generator's check command into the adopter's CI or commit gate and add a fixture proving a manifest edit selects that check. |

In Musi, only `tsconfig.configs.json` is generated by this chain. The manifest,
loader, ESLint policy, and consumer tests are authored. The coverage map is a
separate committed inventory that reads manifest entries during its check; it
is not emitted by the config-surface generator. Do not hand-edit the generated
tsconfig: change the manifest and run
`bun run harness:config-surfaces`, then require
`bun run harness:config-surfaces:check` in the freshness gate.

Before calling an adoption complete:

1. Add one JavaScript and, if applicable, one TypeScript config entry.
2. Prove `eslint --print-config <path>` succeeds for both and the intended rules
   are enabled.
3. Prove the TypeScript entry appears in the generated or replacement parser
   project.
4. Prove an absent, duplicate, unsupported, or unaccounted entry fails a check.
5. Prove changing the manifest makes the generated-output check fail until the
   output is refreshed.
6. Decide explicitly whether manifest edits select a changed-file gate; do not
   inherit Musi's path-policy machinery accidentally.

This solves one bounded inventory problem; it is not a repository-wide
configuration layer. Shell defaults, environment prefixes, runner assumptions,
and other copier-facing knobs remain separate. Musi keeps those knobs
discoverable with greppable `porting-knob:` source markers checked against a
"Porting This" checklist, so an undocumented knob fails the parity gate — a
convention an adopter can reuse for its own copier-facing assumptions.

## What is not portable

These pieces are intentionally Musi-specific and should not be copied verbatim:

- The `lintRatchets` array contents (Musi paths, dispositions, and
  builder-function indirection; the entry count shrinks as debt drains, so
  read the live registry rather than any snapshot).
- The `harness.controls.json` manifest and `missing-harness-ratchet` check
  (Musi's harness control inventory).
- The Biome adoption guide (`biome-lint-adoption.md`) — reference material for
  a future Biome adapter, not a current adoption path.
- Path-policy scripts (`scripts/path-policy/path-policy.ts`) and ESLint config
  internals (`eslint-config/`) — project-specific implementations. The
  [config-surface manifest pattern](#config-surface-manifest-adoption) is
  portable only when the adopter supplies the essential consumers and replaces
  or deliberately omits the Musi-only adapters above.

## Decision guide

Start with Tier 1 if:

- You have lint debt you want to freeze without a big-bang cleanup.
- You want pre-commit and CI enforcement that a specific rule is not getting
  worse.
- You do not have local ESLint rules or custom agent tooling.

Add Tier 2 when:

- You are writing local ESLint rules and want structured metadata and generated
  docs.
- You use AI coding agents and want them to receive lint findings as structured
  JSON with repair guidance.
- You want a committed inventory of which files are covered by which lint
  surface.
- You want CI to post a sticky PR comment with per-ratchet status and recovery
  commands.
