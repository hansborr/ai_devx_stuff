# 178. Local lint-rule registration is hand-synchronized across plugin, activation, and manifest surfaces

Status: Landed on fix/cq-178
Theme: generated lint registration · Area: cross-cutting · Severity: medium · Size: L

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

Adding a local ESLint rule is still a multi-surface registration ritual. The author creates the rule, imports and keys it in a static plugin object, chooses normal-lint or ratchet activation, then repeats its identity, source path, and enforcement command in the harness manifest. Completeness checks catch some omissions after authoring, but there is no single path that derives all registration surfaces.

This is recurring contributor friction in a public harness reference. It has also produced live drift: one rule promoted to normal lint remains documented as ratchet-only because the current checker validates normal-lint claims in one direction but does not reject a ratchet invocation for a normally enabled rule.

A new typed hand-authored catalog would merely relocate the duplication. Rule identity and path already exist in the filesystem, while enforcement mode already exists in flat config and the ratchet registry; the missing piece is deterministic generation from those sources.

## Evidence

- `eslint-config/local-plugin.js:3-34` statically imports 32 rule modules, and `:36-70` manually repeats the same 32 filenames as plugin keys (32/32, re-derived at the audit pin).
- `harness.controls.json:38-58` shows the repeated lint-rule shape: `id`, `ruleName`, source file, and invocation. The manifest contains exactly 32 `kind: "lint-rule"` controls, matching the 32 plugin registrations.
- `harness.controls.json:2` says only documentation fields are re-projected from each rule’s `meta.docs`; identity, source, invocation, and activation mode remain authored in the manifest.
- `docs/guides/local-eslint-rules.md:274-292` still instructs contributors to import and register each new rule manually and relies on a later completeness test to catch omissions.
- `scripts/harness/local-rule-config.ts:61-73` already loads `eslint.config.js` and computes both registered and normally enabled local-rule names.
- `scripts/lint-ratchet/lint-ratchet-config.ts:97-130` exposes the second activation surface through `lintRatchets` and its `ruleId` fields.
- `harness.controls.json:183-189` gives `lint/local/no-plain-error-in-trpc` the invocation `bun run lint:ratchet`, although `eslint-config/package-boundary-configs.js:88-100` enables it as a normal-lint error and the ratchet registry contains no matching `ruleId`.
- `scripts/harness/registration-manifest-checks.ts:99-111` validates only invocations claiming normal lint; ratchet claims for rules already promoted to normal lint pass unchecked.
- `local/no-swallowed-errors` and `local/type-assertion-boundary` are both normally enabled (`eslint-config/code-quality-configs.js:125`, `eslint-config/script-configs.js:162`) and ratchet-registered (`scripts/lint-ratchet/lint-ratchet-config.ts:128-169`); their manifest controls correctly prefer `bun run lint` at `harness.controls.json:204-210` and `:274-280`.
- `scripts/harness/generate-restricted-disable-rules.ts:11-35` and `eslint-config/ratchet-restricted-disable-rules.generated.js:1-19` provide the existing committed, statically importable generated-module idiom.
- The required existing commands are declared in `package.json`: `lint` at `:71`, `lint:ratchet` at `:91`, `harness:check` at `:136`, and `verify:steps`/`:check` at `:155-156`.

## Proposed direction

Implement this as three ordered slices. Generate from existing truth; do not create a new typed hand-authored rule catalog.

1. **S1 — Generate the static plugin module.**

   Add a generator under `scripts/harness/` that scans top-level `eslint-rules/*.js`, excluding `*.test.js`, and classifies default exports by the ESLint rule shape (`meta` plus callable `create`). The existing classifier at `eslint-rules/all-local-rules.js:19-40` demonstrates how helper modules are distinguished from rule modules.

   Derive each rule id and import path from its filename, sort deterministically, and emit a committed `eslint-config/local-plugin.generated.js` containing static imports and the `localPlugin.rules` object. Replace `eslint-config/local-plugin.js`; update `eslint.config.js:17` and other consumers to import the generated module.

   The generated module must remain synchronously importable: no runtime filesystem discovery, top-level `await`, or config-load I/O. Unit tests should pin deterministic ordering, helper exclusion, rule-export shape validation, and id-to-module wiring.

   Add paired root refresh/check scripts for this generator; those scripts do not exist at the pin. Register the output through a `generatedSurface` facet in `harness.controls.json`, regenerate verify-step metadata, and make freshness part of `bun run harness:check`.

2. **S2 — Generate lint-rule manifest controls.**

   Use the filesystem-derived rule set, `loadLocalRuleConfig`’s normally enabled names, and `lintRatchets[].ruleId` to derive:

   - `id = lint/local/<name>`;
   - `ruleName = local/<name>`;
   - `source = eslint-rules/<name>.js`; and
   - `invocation = "bun run lint"` when enabled in flat config, otherwise `"bun run lint:ratchet"` when any ratchet uses the rule.

   Prefer normal lint when both activation surfaces contain a rule. Fail generation when a discovered rule is activated nowhere.

   Choose a generated include rather than partially rewriting the 2,800-line authored manifest. Emit a committed lint-rule-controls JSON include and merge it in `readHarnessManifest`; remove only the 32 hand-authored `kind: "lint-rule"` entries from `harness.controls.json`. The include owns lint-rule controls exclusively, while the main manifest continues to own every other control kind and the generator’s `generatedSurface` record. This seam avoids reformatting or clobbering unrelated hand-authored controls.

   Prove migration parity against all 32 current plugin registrations and manifest controls. The parity diff must contain exactly one intentional data correction: `lint/local/no-plain-error-in-trpc` changes from `bun run lint:ratchet` to `bun run lint`. Treat any other difference as migration drift.

3. **S3 — Retire redundant drift machinery and update author guidance.**

   Convert the plugin-map completeness and manifest-registration assertions that generation makes redundant into generator tests. Preserve checks that still validate rule metadata, activation policy, generated-file freshness, and manifest schema.

   Refresh `docs/guides/local-eslint-rules.md:128-144`, `:185-202`, and `:274-292` so adding a rule means creating the shaped module, choosing normal or ratchet activation, and running the new refresh command. Keep the portable standalone example separate from Musi’s generated registration workflow.

   Regenerate the local-rule catalog, harness-control documentation, and verify-step outputs affected by the new ownership seam.

## Scope / caveats

The bootstrap order is load-bearing: generate `local-plugin.generated.js` before any control-generation phase that imports `eslint.config.js`, because flat-config activation discovery depends on that generated plugin.

Filesystem discovery intentionally changes explicitness. Exclude tests and accept only modules with the rule export shape so helper files are not registered; a stray valid rule module will be registered automatically and must then fail generation if it has no activation mode.

Merging a generated include in `readHarnessManifest` widens that reader’s fixture-copy closure. Its header at `scripts/harness/harness-manifest.ts:3-14` identifies two reduced-tree consumers, so the include and any new reader dependency must be added to both fixture manifests and their generated-surface trigger/fixture paths.

Per the agreed config-surface workflow, declare the new or renamed `eslint-config/` file in `eslint-config/config-surface-manifest.json`, run the existing `bun run harness:config-surfaces` generator, and register all new outputs through `generatedSurface` plus `bun run verify:steps`.

There are no hard sequencing edges. Serialize with [127-public-harness-manifest-has-no-versioned.md](./127-public-harness-manifest-has-no-versioned.md) because both change `harness.controls.json`, `package.json`, registration checks, and generated-surface freshness. If leaf 127 lands first, preserve its `$schema` pointer and schema freshness while introducing include ownership; if this leaf lands first, leaf 127 must publish and round-trip the assembled manifest, including this leaf's generated lint-rule-controls include. Coordinate with [124-ratchet-cli-has-no-authoritative-command.md](./124-ratchet-cli-has-no-authoritative-command.md) because both read `lintRatchets`; avoid concurrent restructuring of `lint-ratchet-config.ts` exports. Coordinate with [158-typescript-consumers-depend-hand-written.md](./158-typescript-consumers-depend-hand-written.md) if it lands concurrently because both touch `eslint-config/` and may churn the config-surface manifest.

The live 2026-07-25 pack’s [38-eslint-rule-helpers.md](../code-quality-2026-07-25/38-eslint-rule-helpers.md) already owns registry ordering and filesystem completeness. Preserve those guarantees by moving them into generator coverage. CQ25-119’s landed `meta.docs` projection remains authoritative and must not be reopened.

Out of scope are the lint-ratchet command catalog, ratchet CLI redesign, rule `meta.docs` projection, and every non-lint-rule control kind in `harness.controls.json`.
