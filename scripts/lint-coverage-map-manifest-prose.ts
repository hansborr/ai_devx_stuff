// Static template text for `docs/generated/lint-coverage-map.md`: everything
// outside the generated tables. The document is rendered end to end from the
// manifest, so this prose is the only place its narrative sections live.

export const DOCUMENT_PREAMBLE = `# Lint Coverage Map

Status: Active inventory. Every tracked maintained code/tooling surface below resolves
to one of: \`linted\`, \`ratcheted\`, \`proposed\`, \`pending-leaf\`, \`excluded\`, or
\`not-code\`. No \`unknown\` rows remain; new surfaces appearing in future
\`git ls-files\` runs should be added under the closest section with a resolved
status before any ratchet/floor batch lands. The checker keeps the code,
tooling, fixture-data, metadata/dotfile, web asset, lockfile, binary reference,
and documentation-inventory families represented below in scope; generated,
vendored, build, cache, and dependency directories remain out of scope.

Source of truth: \`scripts/lint-coverage-map-manifest.ts\` and the
\`scripts/lint-coverage-map-manifest-<area>.ts\` entry modules it composes. This
whole document is generated output — do not hand-edit it. Coverage policy lives
in typed entries validated by \`lint-coverage-map-manifest-schema.ts\`, and each
entry's membership is a list of explicit repo-rooted globs resolved by
\`tools/lint-ratchet/src/kernel/ratchet-globs.ts\` — the same matcher, with the
same \`dot: true\` option, that ESLint flat config and the ratchet registry use.

## Status Values

- \`linted\` — file is covered by \`bun run lint\` under the strict project ESLint
  config.
- \`ratcheted\` — file is covered by at least one \`lint:ratchet\` entry. Where
  the only ratchet is \`ratchet/local-type-assertion-boundary\` and type
  assertions are *not* the meaningful risk for that family, the row also lists
  a \`proposed\` floor.
- \`proposed\` — a concrete policy gap remains. The \`Proposed rule/tool\` column
  names the candidate guard.
- \`pending-leaf\` — needs a separate tool/sensor infrastructure (ShellCheck,
  actionlint, taplo, etc.) and has a named implementation owner. The current
  row records the surface and that owner.
- \`excluded\` — intentionally not linted. The \`Blocker/follow-up\` column
  records the durable rationale.
- \`not-code\` — generated, vendored, binary, or documentation file that is
  not a lint target.

## Generation Method

\`\`\`
git ls-files                                # raw inventory
eslint.config.js → ignores + unignores      # normal-lint membership
eslint.config.js → per-files rule blocks    # parser profile and rule overlays
scripts/lint-ratchet/lint-ratchet-config.ts # ratchet membership
scripts/lint-coverage-map-manifest.ts       # asserted coverage policy
\`\`\`

Render this document with \`bun run docs:lint-coverage-map:generate\`; use
\`bun run docs:lint-coverage-map:generate:check\` for a read-only freshness check.
The \`scripts/drift-ai/*.ts\` row is fully derived: its file count and ratchet
membership are computed from the live tree at generation time, generation fails
closed if any direct-child candidate lacks ESLint reach, and the derived status
must match the status its manifest entry asserts. Every other cell is asserted
by the row's manifest entry and rendered verbatim.

Membership rules followed when filling in the table:

1. A file is \`linted\` iff ESLint's flat config resolves at least one *rule*
   for it: it survives the global \`ignores\` list (with the ordered \`!…\`
   re-includes applied) and matches a config block that turns rules on. Merely
   matching a block's \`files\` glob is not enough — \`calculateConfigForFile\`
   returns a config object for any known extension, ignored files included, so
   that weaker test would call an intentionally unlinted file reachable.
   \`docs:lint-coverage-map:audit\` checks this in both directions: a \`linted\`
   row whose files resolve no rules and a non-\`linted\` row whose files do both
   fail.
2. \`**/*.config.{js,mjs,ts}\` is in the global \`ignores\`, then maintained
   root/package config files, \`scripts/vitest.config.ts\`, and
   \`eslint-rules/vitest.config.ts\` are explicitly re-included for the
   config-file policy.
3. Maintained \`scripts/**/*.ts\` files are linted by default through
   \`tsconfig.scripts.json\`. Script fixture/generated snapshot paths stay
   globally ignored: \`scripts/codemods/fixtures/**\`,
   \`scripts/drift-ai/fixtures/**\`, \`scripts/fixtures/**\`,
   \`scripts/harness-audit/fixtures/**\`, and
   \`scripts/logs-audit/fixtures/**\`.
4. \`eslint-rules/*\` is in the global \`ignores\`; \`eslint-rules/*.js\` is
   re-included for rule implementations and rule tests and
   \`eslint-rules/*.json\` is re-included so generated JSON pins there stay on
   the \`@eslint/json\` track, while \`eslint-rules/vitest.config.ts\` is
   re-included by the config-file policy.
5. \`eslint-config/*.js\` is linted by the same dedicated JS config block as root
   JS config files. The standalone checkJs lane covers those support modules
   except the generated \`local-plugin.generated.js\`, whose aggregate plugin
   object exceeds the useful JSDoc inference boundary.
6. A file is \`ratcheted\` iff it matches at least one ratchet entry's \`files\`
   glob and is not pruned by that entry's \`ignores\`.
7. The \`local/type-assertion-boundary\` ratchet covers package, e2e, and
   maintained script TypeScript, but it ignores the same script fixture/config
   paths as normal lint. Rows keep a \`proposed\` marker only when a current
   broad-shallow floor is still missing; deeper normal-lint adoption and drain
   rules live in the follow-up column.
8. \`ratchet/local-no-commented-out-code\` covers maintained JS/TS globally with
   the normal fixture/generated exclusions. It is recorded here once rather
   than repeated in every row's \`Existing ratchet/floor\` cell.

## Maintaining This Map

The drift gate (\`scripts/lint-coverage-map-check.ts\`) fires for *any* tracked,
in-scope file that matches no manifest entry — including a single new \`.ts\` in
an existing directory. To add a file:

- **Edit the manifest, not this file.** Add the path to the matching entry in
  \`scripts/lint-coverage-map-manifest-<area>.ts\`, then run
  \`bun run docs:lint-coverage-map:generate\`. The \`:generate:check\` command
  checks only that this document matches the manifest; \`:check\` remains the
  semantic whole-map gate and \`:audit\` adds whole-map ESLint reach.
- **Entry fields:** \`id\`, \`globs\`, optional \`pathNote\`, then \`files\`,
  \`normalLint\`, \`ratchets\`, \`parser\`, \`proposed\`, \`status\`, and \`followUp\` —
  the eight rendered columns. \`id\` is stable identity: checker findings and
  \`--suggest\` output name it, so it must survive reordering and prose edits.
- **The \`Files\` count is checked, not trusted.** \`:check\` sums the leading
  \`N .ext\` groups of each \`files\` cell and compares them with the tracked files
  that row's globs match, so a count cannot quietly rot. A row whose count is
  deliberately not that total — a production-only count whose sibling test row
  owns the rest, or a narrative breakdown — says so in \`filesCountNote\` and is
  skipped. There is no third option: an unexplained mismatch fails the gate.
- **Globs are explicit and repo-rooted.** There is no base-directory shorthand
  and no implicit \`**/\` prefixing: a glob means exactly what minimatch says it
  means. A new file in a directory an existing entry already covers is added by
  appending its full path (or a covering glob) to that entry's \`globs\`.
- **Scaffold:** run \`bun run docs:lint-coverage-map:suggest\` to print
  ready-to-paste manifest entries for every unaccounted file, with
  \`normalLint\`/\`status\` pre-derived from ESLint reach and ratchet membership.
  The committing gate runs \`docs:lint-coverage-map:check\`; full
  \`verify\` runs \`docs:lint-coverage-map:audit\` (adds the ESLint-reach probe). A
  literal glob that "matched 0 tracked files" usually just needs \`git add\`.
- **Splitting a module:** each entry module stays under the shared \`max-lines\`
  cap. When one outgrows it, split it by area and register the new module in
  \`lint-coverage-map-manifest-sections.ts\` rather than raising the cap.
`;

export const DOCUMENT_POSTAMBLE = `## Current Cross-Cutting Policy

- **No broad-shallow gaps remain.** No tracked row has \`proposed\` or
  \`pending-leaf\` status. Deeper normal-lint adoption, ratchet drains, and
  rule-specific improvements follow the ordinary lint lifecycle.
- **Script lint is default.** The script families above are
  covered by \`tsconfig.scripts.json\` through the default \`scripts/**/*.ts\`
  ESLint project mapping, with targeted fixture/config exclusions. The
  root/package config block is normal-linted via \`tsconfig.configs.json\`.
- **Core ESLint rule support.** Core rules such as \`complexity\`, \`max-params\`,
  and \`no-nested-ternary\` can use \`source: { kind: "core" }\` ratchet
  entries. Use that support for future deeper-rule work without treating every
  core-rule candidate as a broad-shallow blocker.
- **Non-ESLint floors are active.** Shell/hook ShellCheck and the
  workflow/YAML/TOML/Dockerfile sensors run through full lint and the relevant
  changed/pre-commit paths.
`;
